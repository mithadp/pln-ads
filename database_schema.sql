-- ==========================================================================
-- PLN-ADS Supabase schema
-- Paste this whole file into the Supabase SQL Editor and run it once.
-- All statements are idempotent and forgiving: works on a fresh project AND
-- on a legacy project that already has partial / older versions of these
-- tables. Re-running is safe.
-- ==========================================================================

-- gen_random_uuid() lives in pgcrypto; Supabase has it pre-enabled but we
-- ensure it explicitly in case this script is run on a fresh project.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- --------------------------------------------------------------------------
-- 1. consumption_data
--    Raw rows extracted from PLN billing exports (Excel/HTML uploads).
--    Excel mapping: IDPEL→customer_id, UNITUP→unitup, PEMKWH→kwh, DAYA→daya,
--    RPTAG→rptag, BLTH REK→billing_period.
--    unitup is the ULP code (e.g. 51101 = INDRAPURA, 51104 = PERAK).
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.consumption_data (
    id              BIGSERIAL PRIMARY KEY,
    upload_id       UUID,
    customer_id     TEXT,
    unitup          TEXT,
    kwh             NUMERIC,
    daya            NUMERIC,
    rptag           NUMERIC,
    billing_period  TEXT,
    recorded_at     TIMESTAMPTZ DEFAULT NOW(),
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Legacy: rename zone → unitup if needed.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'consumption_data' AND column_name = 'zone'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'consumption_data' AND column_name = 'unitup'
    ) THEN
        EXECUTE 'ALTER TABLE public.consumption_data RENAME COLUMN zone TO unitup';
    END IF;
END $$;

-- Backfill any columns missing on legacy tables.
ALTER TABLE public.consumption_data ADD COLUMN IF NOT EXISTS upload_id      UUID;
ALTER TABLE public.consumption_data ADD COLUMN IF NOT EXISTS customer_id    TEXT;
ALTER TABLE public.consumption_data ADD COLUMN IF NOT EXISTS idpel          TEXT;
ALTER TABLE public.consumption_data ADD COLUMN IF NOT EXISTS unitup         TEXT;
ALTER TABLE public.consumption_data ADD COLUMN IF NOT EXISTS kwh            NUMERIC;
ALTER TABLE public.consumption_data ADD COLUMN IF NOT EXISTS pemkwh         NUMERIC;
ALTER TABLE public.consumption_data ADD COLUMN IF NOT EXISTS daya           NUMERIC;
ALTER TABLE public.consumption_data ADD COLUMN IF NOT EXISTS rptag          NUMERIC;
ALTER TABLE public.consumption_data ADD COLUMN IF NOT EXISTS rpbk           NUMERIC;
ALTER TABLE public.consumption_data ADD COLUMN IF NOT EXISTS trf            TEXT;
ALTER TABLE public.consumption_data ADD COLUMN IF NOT EXISTS slalwbp        NUMERIC;
ALTER TABLE public.consumption_data ADD COLUMN IF NOT EXISTS sahlwbp        NUMERIC;
ALTER TABLE public.consumption_data ADD COLUMN IF NOT EXISTS slawbp         NUMERIC;
ALTER TABLE public.consumption_data ADD COLUMN IF NOT EXISTS sahwbp         NUMERIC;
ALTER TABLE public.consumption_data ADD COLUMN IF NOT EXISTS billing_period TEXT;
ALTER TABLE public.consumption_data ADD COLUMN IF NOT EXISTS blth_rek       TEXT;
ALTER TABLE public.consumption_data ADD COLUMN IF NOT EXISTS recorded_at    TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE public.consumption_data ADD COLUMN IF NOT EXISTS created_at     TIMESTAMPTZ DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_consumption_recorded_at ON public.consumption_data (recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_consumption_unitup      ON public.consumption_data (unitup);
CREATE INDEX IF NOT EXISTS idx_consumption_customer    ON public.consumption_data (customer_id);
CREATE INDEX IF NOT EXISTS idx_consumption_idpel       ON public.consumption_data (idpel);

-- --------------------------------------------------------------------------
-- 2. upload_logs
--    One row per file upload. Lifecycle: processing → completed | failed.
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.upload_logs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID,
    file_name       TEXT NOT NULL,
    file_path       TEXT,
    file_size_bytes BIGINT,
    status          TEXT NOT NULL DEFAULT 'processing',
    rows_total      INT,
    rows_success    INT,
    error_message   TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.upload_logs ADD COLUMN IF NOT EXISTS user_id         UUID;
ALTER TABLE public.upload_logs ADD COLUMN IF NOT EXISTS file_name       TEXT;
ALTER TABLE public.upload_logs ADD COLUMN IF NOT EXISTS file_path       TEXT;
ALTER TABLE public.upload_logs ADD COLUMN IF NOT EXISTS file_size_bytes BIGINT;
ALTER TABLE public.upload_logs ADD COLUMN IF NOT EXISTS status          TEXT DEFAULT 'processing';
ALTER TABLE public.upload_logs ADD COLUMN IF NOT EXISTS rows_total      INT;
ALTER TABLE public.upload_logs ADD COLUMN IF NOT EXISTS rows_success    INT;
ALTER TABLE public.upload_logs ADD COLUMN IF NOT EXISTS error_message   TEXT;
ALTER TABLE public.upload_logs ADD COLUMN IF NOT EXISTS created_at      TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE public.upload_logs ADD COLUMN IF NOT EXISTS updated_at      TIMESTAMPTZ DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_upload_logs_user_id    ON public.upload_logs (user_id);
CREATE INDEX IF NOT EXISTS idx_upload_logs_created_at ON public.upload_logs (created_at DESC);

-- --------------------------------------------------------------------------
-- 3. anomalies
--    Output of the ML anomaly detector (KNN). One row per flagged record.
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.anomalies (
    id             BIGSERIAL PRIMARY KEY,
    upload_id      UUID,
    user_id        UUID,
    location       TEXT,
    unitup         TEXT,
    idpel          TEXT,
    blth_rek       TEXT,
    detected_at    TIMESTAMPTZ DEFAULT NOW(),
    actual_kwh     NUMERIC,
    expected_kwh   NUMERIC,
    deviation_pct  NUMERIC,
    severity       TEXT
);

ALTER TABLE public.anomalies ADD COLUMN IF NOT EXISTS upload_id     UUID;
ALTER TABLE public.anomalies ADD COLUMN IF NOT EXISTS user_id       UUID;
ALTER TABLE public.anomalies ADD COLUMN IF NOT EXISTS location      TEXT;
ALTER TABLE public.anomalies ADD COLUMN IF NOT EXISTS unitup        TEXT;
ALTER TABLE public.anomalies ADD COLUMN IF NOT EXISTS idpel         TEXT;
ALTER TABLE public.anomalies ADD COLUMN IF NOT EXISTS blth_rek      TEXT;
ALTER TABLE public.anomalies ADD COLUMN IF NOT EXISTS detected_at   TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE public.anomalies ADD COLUMN IF NOT EXISTS actual_kwh    NUMERIC;
ALTER TABLE public.anomalies ADD COLUMN IF NOT EXISTS expected_kwh  NUMERIC;
ALTER TABLE public.anomalies ADD COLUMN IF NOT EXISTS deviation_pct NUMERIC;
ALTER TABLE public.anomalies ADD COLUMN IF NOT EXISTS severity      TEXT;

CREATE INDEX IF NOT EXISTS idx_anomalies_detected_at ON public.anomalies (detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_anomalies_user_id     ON public.anomalies (user_id);
CREATE INDEX IF NOT EXISTS idx_anomalies_unitup      ON public.anomalies (unitup);
CREATE INDEX IF NOT EXISTS idx_anomalies_idpel       ON public.anomalies (idpel);

-- --------------------------------------------------------------------------
-- 4. forecast_results
--    Output of the ML forecaster (Prophet/StatsForecast/skforecast ensemble).
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.forecast_results (
    id             BIGSERIAL PRIMARY KEY,
    upload_id      UUID,
    user_id        UUID,
    unitup         TEXT,
    forecast_date  DATE,
    predicted_kwh  NUMERIC,
    accuracy       NUMERIC,
    created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- Legacy: rename zone → unitup if needed.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'forecast_results' AND column_name = 'zone'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'forecast_results' AND column_name = 'unitup'
    ) THEN
        EXECUTE 'ALTER TABLE public.forecast_results RENAME COLUMN zone TO unitup';
    END IF;
END $$;

ALTER TABLE public.forecast_results ADD COLUMN IF NOT EXISTS upload_id     UUID;
ALTER TABLE public.forecast_results ADD COLUMN IF NOT EXISTS user_id       UUID;
ALTER TABLE public.forecast_results ADD COLUMN IF NOT EXISTS unitup        TEXT;
ALTER TABLE public.forecast_results ADD COLUMN IF NOT EXISTS forecast_date DATE;
ALTER TABLE public.forecast_results ADD COLUMN IF NOT EXISTS predicted_kwh NUMERIC;
ALTER TABLE public.forecast_results ADD COLUMN IF NOT EXISTS accuracy      NUMERIC;
ALTER TABLE public.forecast_results ADD COLUMN IF NOT EXISTS created_at    TIMESTAMPTZ DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_forecast_unitup_date ON public.forecast_results (unitup, forecast_date);

-- --------------------------------------------------------------------------
-- 5. customers   (referenced by the upload worker — included so the worker
--                 stops crashing on first upload)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.customers (
    id                  BIGSERIAL PRIMARY KEY,
    upload_id           UUID,
    customer_id         TEXT UNIQUE,
    full_name           TEXT,
    tariff              TEXT,
    contract_power_va   INT,
    region              TEXT,
    meter_type          TEXT DEFAULT 'UNKNOWN',
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS upload_id         UUID;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS customer_id       TEXT;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS full_name         TEXT;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS tariff            TEXT;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS contract_power_va INT;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS region            TEXT;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS meter_type        TEXT DEFAULT 'UNKNOWN';
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS created_at        TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS updated_at        TIMESTAMPTZ DEFAULT NOW();

-- --------------------------------------------------------------------------
-- 6. jobs   (BullMQ job audit trail written by routes/upload.ts)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.jobs (
    id          BIGSERIAL PRIMARY KEY,
    upload_id   UUID,
    type        TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'pending',
    data        JSONB,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS upload_id  UUID;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS type       TEXT;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS status     TEXT DEFAULT 'pending';
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS data       JSONB;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

-- --------------------------------------------------------------------------
-- RLS notice
-- --------------------------------------------------------------------------
-- The backend uses SUPABASE_SERVICE_ROLE_KEY which bypasses Row Level
-- Security. For per-user reads from the browser (anon key) you would need
-- ENABLE ROW LEVEL SECURITY plus per-table policies. Left disabled for now
-- so the worker can write freely. Add policies before exposing the anon key
-- to read these tables directly.
