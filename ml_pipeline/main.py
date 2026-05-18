"""
PLN-ADS ML Pipeline — FastAPI
Menggunakan model .pkl asli untuk semua prediksi.
"""

import sys
import os
import math
import joblib
import logging
import io
from pathlib import Path
from typing import List, Optional

# Windows default console codepage (cp1252) cannot encode emoji — force UTF-8
try:
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')
except (AttributeError, io.UnsupportedOperation):
    pass

# Python 3.11 site-packages fallback for the ML wheels (only applied when the
# interpreter actually IS 3.11 — injecting 3.11-compiled C extensions into a
# 3.14 process crashes on first import).
PY = sys.version_info[:2]
_py311_site = r'C:\Users\ASUS\AppData\Local\Programs\Python\Python311\Lib\site-packages'
if PY == (3, 11) and os.path.isdir(_py311_site) and _py311_site not in sys.path:
    sys.path.insert(0, _py311_site)

import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from statsmodels.tsa.holtwinters import ExponentialSmoothing
from sklearn.linear_model import LinearRegression
from sklearn.metrics import mean_absolute_error, r2_score

# ── Logging ─────────────────────────────────────────────────
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger(__name__)

app = FastAPI(title="PLN-ADS ML Pipeline", version="2.0.0")

# CORS origins read from ML_ALLOWED_ORIGINS env var (comma-separated). The
# default covers local dev (3001/3002 on localhost and the WSL bridge IP);
# Render adds the deployed backend + frontend domains via dashboard env vars.
_default_origins = (
    "http://localhost:3001,http://localhost:3002,"
    "http://172.22.96.1:3001,http://172.22.96.1:3002"
)
allow_origins = [
    o.strip() for o in os.environ.get("ML_ALLOWED_ORIGINS", _default_origins).split(",")
    if o.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Load models sekali saat startup ─────────────────────────
BASE = Path(__file__).parent
ANOMALY_PKL = BASE / "best_anomaly_model.pkl"
FRAUD_PKL = BASE / "fraud_detection_model.pkl"

# Forecasting now runs entirely on statsmodels/sklearn at request time
# (see /api/forecast below), so we no longer load forecasting_model_ts.pkl.
# That bundle referenced skforecast/statsforecast which don't have wheels
# for Python 3.14 on Windows and weren't worth the install dance.

anomaly_bundle = None
fraud_bundle = None


@app.on_event("startup")
def load_models():
    global anomaly_bundle, fraud_bundle
    try:
        anomaly_bundle = joblib.load(ANOMALY_PKL)
        log.info(
            f"✅ Anomaly model loaded: KNN k={anomaly_bundle['model'].n_neighbors}, "
            f"features={len(anomaly_bundle['feature_cols'])}"
        )
    except Exception as e:
        log.error(f"❌ Failed to load anomaly model: {e}")

    try:
        fraud_bundle = joblib.load(FRAUD_PKL)
        log.info(
            f"✅ Fraud model loaded: {type(fraud_bundle['model']).__name__}, "
            f"threshold={fraud_bundle['threshold']}, features={fraud_bundle['features']}"
        )
    except Exception as e:
        log.error(f"❌ Fraud model load failed: {e}")


# ── Health check ─────────────────────────────────────────────
@app.get("/health")
def health():
    return {
        "status": "ok",
        "python": f"{PY[0]}.{PY[1]}",
        "anomaly_model": "loaded" if anomaly_bundle else "not loaded",
        "forecast_model": "statsmodels (Holt-Winters)",
        "fraud_model": "loaded" if fraud_bundle else "not loaded",
    }


# ════════════════════════════════════════════════════════════
# ENDPOINT 1 — POST /api/predict  — KNN anomaly detection
# ════════════════════════════════════════════════════════════

class MonthlyRecord(BaseModel):
    blth_rek: str            # "MM-YYYY"
    pemkwh: float
    rptag: Optional[float] = None
    daya: Optional[int] = None


class PredictRequest(BaseModel):
    idpel: str
    records: List[MonthlyRecord]


class MonthResult(BaseModel):
    blth_rek: str
    pemkwh: float
    predicted: float
    deviation: float
    is_anomaly: bool
    confidence: float        # prob class=1 (0..1)
    severity: str            # critical | medium | low | normal


class Signal(BaseModel):
    name: str
    severity: str


class PredictResponse(BaseModel):
    # Pydantic v2 reserves the "model_" namespace for its own meta fields;
    # silencing the warning since we intentionally expose model_used.
    model_config = {"protected_namespaces": ()}

    idpel: str
    is_anomaly: bool
    risk_score: int          # 0..100
    monthly: List[MonthResult]
    signals: List[Signal]
    model_used: str


def _sort_key(r: MonthlyRecord) -> int:
    mm, yyyy = r.blth_rek.split("-")
    return int(yyyy) * 12 + int(mm)


def build_features(records: List[MonthlyRecord]) -> pd.DataFrame:
    """Bangun 17 fitur sesuai feature_cols di best_anomaly_model.pkl."""
    recs = sorted(records, key=_sort_key)

    kwhs = [r.pemkwh for r in recs]
    tags = [r.rptag if r.rptag is not None else 0.0 for r in recs]
    dayas = [r.daya if r.daya is not None else 1300 for r in recs]

    mean_kwh = float(np.mean(kwhs)) if kwhs else 1.0
    mean_tag = float(np.mean(tags)) if tags else 1.0

    rows = []
    for i, rec in enumerate(recs):
        mm = int(rec.blth_rek.split("-")[0])

        past3 = kwhs[max(0, i - 3):i]
        past6 = kwhs[max(0, i - 6):i]

        roll_mean_3 = float(np.mean(past3)) if past3 else kwhs[i]
        roll_std_3 = float(np.std(past3)) if len(past3) > 1 else 0.0
        roll_mean_6 = float(np.mean(past6)) if past6 else kwhs[i]
        roll_std_6 = float(np.std(past6)) if len(past6) > 1 else 0.0

        delta = kwhs[i] - kwhs[i - 1] if i > 0 else 0.0
        daya_v = dayas[i] if dayas[i] and dayas[i] > 0 else 1300
        tag_v = tags[i] if tags[i] and tags[i] > 0 else 0.0

        rows.append({
            "pemkwh": kwhs[i],
            "delta_pemkwh": delta,
            "kwh_per_daya": kwhs[i] / daya_v,
            "tagihan_per_kwh": (tag_v / kwhs[i]) if kwhs[i] > 0 else 0.0,
            "rasio_wbp": 0.0,
            "pemkwh_rolling_mean_3": roll_mean_3,
            "pemkwh_rolling_std_3": roll_std_3,
            "pemkwh_rolling_mean_6": roll_mean_6,
            "pemkwh_rolling_std_6": roll_std_6,
            "pemkwh_vs_mean": kwhs[i] - mean_kwh,
            "tagihan_vs_mean": tag_v - mean_tag,
            "pemkwh_consistency": (roll_std_3 / roll_mean_3) if roll_mean_3 > 0 else 0.0,
            "zero_usage": 1 if kwhs[i] == 0 else 0,
            "extreme_high_usage": 1 if kwhs[i] > mean_kwh * 2 else 0,
            "extreme_low_usage": 1 if kwhs[i] < mean_kwh * 0.3 else 0,
            "month_sin": math.sin(2 * math.pi * mm / 12),
            "month_cos": math.cos(2 * math.pi * mm / 12),
        })

    return pd.DataFrame(rows)


def severity_from_prob(prob: float) -> str:
    if prob >= 0.80:
        return "critical"
    if prob >= 0.60:
        return "medium"
    if prob >= 0.40:
        return "low"
    return "normal"


@app.post("/api/predict", response_model=PredictResponse)
def predict_anomaly(req: PredictRequest):
    if anomaly_bundle is None:
        raise HTTPException(503, "Anomaly model not loaded. Check best_anomaly_model.pkl")

    if len(req.records) < 3:
        raise HTTPException(400, "Minimal 3 bulan data diperlukan untuk prediksi")

    model = anomaly_bundle["model"]
    scaler = anomaly_bundle["scaler"]
    feat_cols = anomaly_bundle["feature_cols"]

    df = build_features(req.records)
    X = df[feat_cols].values
    X_scaled = scaler.transform(X)

    preds = model.predict(X_scaled)
    probs = model.predict_proba(X_scaled)[:, 1]  # prob class=1

    recs = sorted(req.records, key=_sort_key)
    kwhs = [r.pemkwh for r in recs]

    monthly_results: List[MonthResult] = []
    for i, rec in enumerate(recs):
        past = kwhs[max(0, i - 3):i]
        pred_kwh = float(np.mean(past)) if past else kwhs[i]
        deviation = ((kwhs[i] - pred_kwh) / pred_kwh * 100) if pred_kwh > 0 else 0.0
        monthly_results.append(MonthResult(
            blth_rek=rec.blth_rek,
            pemkwh=kwhs[i],
            predicted=round(pred_kwh, 1),
            deviation=round(deviation, 1),
            is_anomaly=bool(preds[i] == 1),
            confidence=round(float(probs[i]), 3),
            severity=severity_from_prob(float(probs[i])) if preds[i] == 1 else "normal",
        ))

    n_anomaly = sum(1 for m in monthly_results if m.is_anomaly)
    avg_prob = float(np.mean(probs))
    anomaly_ratio = n_anomaly / len(monthly_results) if monthly_results else 0.0
    risk_score = min(100, int(avg_prob * 80 + anomaly_ratio * 20))
    is_anomaly = n_anomaly > 0 and anomaly_ratio > 0.1

    signals: List[Signal] = []
    n_crit = sum(1 for m in monthly_results if m.severity == "critical")
    n_med = sum(1 for m in monthly_results if m.severity == "medium")
    if n_crit > 0:
        signals.append(Signal(name=f"{n_crit} bulan dengan anomali kritis dari model KNN", severity="critical"))
    if n_med > 0:
        signals.append(Signal(name=f"{n_med} bulan dengan anomali medium dari model KNN", severity="medium"))
    if not signals and is_anomaly:
        signals.append(Signal(name="Pola konsumsi mencurigakan terdeteksi model", severity="low"))

    log.info(
        f"[predict] idpel={req.idpel} anomaly={is_anomaly} risk={risk_score} "
        f"n_anomaly={n_anomaly}/{len(monthly_results)}"
    )

    return PredictResponse(
        idpel=req.idpel,
        is_anomaly=is_anomaly,
        risk_score=risk_score,
        monthly=monthly_results,
        signals=signals,
        model_used=f"KNN k={model.n_neighbors} Manhattan",
    )


# ════════════════════════════════════════════════════════════
# ENDPOINT 2 — POST /api/forecast — Holt-Winters / Linear fallback
#
# Replaces Prophet, which can't build on Windows without C++ Build Tools
# and has no Python 3.14 wheels. statsmodels' ExponentialSmoothing
# (Holt-Winters) gives a comparable seasonal trend forecast with zero
# build-step. For very short histories we fall back to a simple
# LinearRegression on the time index so the chart always renders.
# ════════════════════════════════════════════════════════════

class HistoryPoint(BaseModel):
    date: str          # "MM-YYYY"
    actual: float


class ForecastRequest(BaseModel):
    idpel: str
    history: List[HistoryPoint]
    horizon: int = 3   # 3 | 6 | 9


class ForecastPrediction(BaseModel):
    date: str
    predicted_kwh: float


class ForecastMetrics(BaseModel):
    model: str
    mae: float
    mape: float
    r2: float


class ForecastResponse(BaseModel):
    idpel: str
    horizon: int
    predictions: List[ForecastPrediction]
    metrics: ForecastMetrics


def _parse_mm_yyyy(s: str) -> pd.Timestamp:
    mm, yyyy = s.split("-")
    return pd.Timestamp(year=int(yyyy), month=int(mm), day=1)


def _format_mm_yyyy(ts: pd.Timestamp) -> str:
    return f"{ts.month:02d}-{ts.year}"


def _safe_mape(actual: np.ndarray, predicted: np.ndarray) -> float:
    """MAPE that skips zeros to avoid division-by-zero blow-ups."""
    mask = actual != 0
    if not np.any(mask):
        return 0.0
    return float(np.mean(np.abs((actual[mask] - predicted[mask]) / actual[mask])))


def _holt_winters_forecast(y: np.ndarray, horizon: int) -> tuple[np.ndarray, np.ndarray]:
    """Fit Holt-Winters and return (fitted_in_sample, forecast).

    Uses additive trend; seasonal component only if ≥24 months are available
    (two full periods, which Holt-Winters needs to estimate seasonality).
    """
    seasonal = "add" if len(y) >= 24 else None
    seasonal_periods = 12 if seasonal else None

    model = ExponentialSmoothing(
        y,
        trend="add",
        seasonal=seasonal,
        seasonal_periods=seasonal_periods,
        initialization_method="estimated",
    )
    fit = model.fit(optimized=True)
    return np.asarray(fit.fittedvalues), np.asarray(fit.forecast(horizon))


def _linear_forecast(y: np.ndarray, horizon: int) -> tuple[np.ndarray, np.ndarray, str]:
    """Cheap LinearRegression on a 0..n-1 index — used when y is too short
    for Holt-Winters to converge."""
    n = len(y)
    X = np.arange(n).reshape(-1, 1)
    lr = LinearRegression().fit(X, y)
    fitted = lr.predict(X)
    future_X = np.arange(n, n + horizon).reshape(-1, 1)
    forecast_vals = lr.predict(future_X)
    return fitted, forecast_vals, "LinearRegression"


@app.post("/api/forecast", response_model=ForecastResponse)
def forecast(req: ForecastRequest):
    # Allow short histories — Holt-Winters with seasonality needs ≥24, but we
    # fall back to a non-seasonal HW or LinearRegression below.
    if len(req.history) < 3:
        raise HTTPException(400, f"Minimal 3 bulan histori diperlukan (ada {len(req.history)})")

    horizon = max(1, min(12, req.horizon))

    history_sorted = sorted(req.history, key=lambda h: _parse_mm_yyyy(h.date))
    dates = [_parse_mm_yyyy(h.date) for h in history_sorted]
    y = np.array([h.actual for h in history_sorted], dtype=float)

    model_name: str
    try:
        if len(y) < 6:
            # Holt-Winters with trend needs at least ~4 points; linear is
            # safer and more predictable on tiny series.
            fitted, forecast_vals, model_name = _linear_forecast(y, horizon)
        else:
            fitted, forecast_vals = _holt_winters_forecast(y, horizon)
            model_name = "Holt-Winters" if len(y) >= 24 else "Holt-Winters (no-season)"
    except Exception as e:
        log.warning(f"[forecast] Holt-Winters failed ({type(e).__name__}: {e}); falling back to LinearRegression")
        fitted, forecast_vals, model_name = _linear_forecast(y, horizon)

    # Build future month timestamps from the last observed month, stepping
    # monthly. Uses pd.DateOffset to handle year roll-overs cleanly.
    last_date = dates[-1]
    future_dates = [last_date + pd.DateOffset(months=i + 1) for i in range(horizon)]

    predictions = [
        ForecastPrediction(
            date=_format_mm_yyyy(fd),
            predicted_kwh=round(max(0.0, float(v)), 1),
        )
        for fd, v in zip(future_dates, forecast_vals)
    ]

    # Compute in-sample metrics so the frontend's accuracy card has real
    # numbers instead of the hard-coded Prophet placeholders.
    try:
        mae = float(mean_absolute_error(y, fitted))
        mape = _safe_mape(y, np.asarray(fitted))
        r2 = float(r2_score(y, fitted)) if len(y) >= 2 else 0.0
    except Exception:
        mae, mape, r2 = 0.0, 0.0, 0.0

    log.info(
        f"[forecast] idpel={req.idpel} horizon={horizon} predictions={len(predictions)} "
        f"model={model_name} mae={mae:.2f} mape={mape:.3f} r2={r2:.3f}"
    )

    return ForecastResponse(
        idpel=req.idpel,
        horizon=horizon,
        predictions=predictions,
        metrics=ForecastMetrics(
            model=model_name,
            mae=round(mae, 3),
            mape=round(mape, 4),
            r2=round(r2, 4),
        ),
    )


# ════════════════════════════════════════════════════════════
# ENDPOINT 3 — POST /api/detect — RandomForest fraud quick-check
# ════════════════════════════════════════════════════════════

class DetectRequest(BaseModel):
    idpel: str
    records: List[MonthlyRecord]


class DetectResponse(BaseModel):
    idpel: str
    is_anomaly: bool
    confidence: float        # probability 0.0..1.0


@app.post("/api/detect", response_model=DetectResponse)
def detect(req: DetectRequest):
    if fraud_bundle is None:
        raise HTTPException(503, "fraud_detection_model.pkl not loaded")
    if len(req.records) < 3:
        raise HTTPException(400, "Minimal 3 bulan data diperlukan")

    model = fraud_bundle["model"]
    threshold = float(fraud_bundle.get("threshold", 0.4))
    feat_order: List[str] = fraud_bundle["features"]  # ['cost_per_kwh','std_rptag','wbp_ratio','mean_rpwbp','daya']

    # ── Compute the 5 features from raw monthly records ────────────────────
    kwhs = [float(r.pemkwh) for r in req.records]
    tags = [float(r.rptag) if r.rptag is not None else 0.0 for r in req.records]
    dayas = [int(r.daya) if r.daya is not None else 1300 for r in req.records]

    import statistics
    mean_kwh = statistics.mean(kwhs) if kwhs else 1.0

    feature_values = {
        "cost_per_kwh": (statistics.mean(tags) / mean_kwh) if mean_kwh > 0 else 0.0,
        "std_rptag": statistics.stdev(tags) if len(tags) > 1 else 0.0,
        "wbp_ratio": 0.0,    # WBP column not exported by PLN — zero by design
        "mean_rpwbp": 0.0,   # idem
        "daya": float(dayas[0]) if dayas else 1300.0,
    }

    # Project in the exact order the model was trained on.
    X = [[feature_values[c] for c in feat_order]]

    prob = float(model.predict_proba(X)[0][1])  # P(class=1 = anomaly)
    is_anomaly = prob >= threshold

    log.info(f"[detect] idpel={req.idpel} prob={prob:.3f} threshold={threshold} anomaly={is_anomaly}")

    return DetectResponse(
        idpel=req.idpel,
        is_anomaly=is_anomaly,
        confidence=round(prob, 3),
    )
