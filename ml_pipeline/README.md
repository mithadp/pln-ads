---
title: PLN-ADS ML Pipeline
emoji: ⚡
colorFrom: blue
colorTo: green
sdk: docker
app_port: 7860
pinned: false
---

FastAPI service for PLN-ADS anomaly detection and consumption forecasting.

## Endpoints

- `GET /health` — service status + model load status
- `POST /api/predict` — KNN anomaly detection (12-month feature window)
- `POST /api/forecast` — Holt-Winters / LinearRegression time-series forecast
- `POST /api/detect` — RandomForest fraud quick-check (5 features)

## Models

- `best_anomaly_model.pkl` — KNN classifier, 17 features
- `fraud_detection_model.pkl` — RandomForest, 5 features
- Forecasting: statsmodels `ExponentialSmoothing` at request time
  (no pickled model — runs fresh per request, ~50ms for 24mo history).
