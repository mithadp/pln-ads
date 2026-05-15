# 🚀 PLN-ADS (PLN Anomaly Detection System) - Core Features & Blueprint

> **Project Context:** A full-stack web application built for PLN (Perusahaan Listrik Negara / Indonesian State Electricity Company) to monitor energy consumption data, detect anomalies, and forecast future consumption patterns using machine learning models.

---

## 1. 🏗️ System Architecture Overview

The system follows a **decoupled, microservices-inspired architecture** with an asynchronous background processing pipeline:

```
┌─────────────────────────────────────────────────────────────────────┐
│                         USER BROWSER                                │
│              Next.js 16 Frontend (Port 3000)                        │
└────────────────────────────┬────────────────────────────────────────┘
                             │ HTTP REST (JSON)
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│              Node.js / Express Backend API (Port 3001)              │
│         [Auth · Upload · Jobs · Anomalies · Stats routes]           │
└───────┬─────────────────────────────────────────┬───────────────────┘
        │ Enqueue Job                             │ Read/Write Data
        ▼                                         ▼
┌───────────────────┐                 ┌───────────────────────────────┐
│  BullMQ Queue     │                 │   Supabase (PostgreSQL)        │
│  (Redis :6379)    │                 │   [uploads · anomalies ·       │
│                   │                 │    jobs · users tables]        │
│  ml-prediction    │                 └───────────────────────────────┘
│  -queue           │
└───────┬───────────┘
        │ Worker polls queue
        ▼
┌───────────────────────────────────────────────────────────────────┐
│          BullMQ Worker (runs inside Backend process)              │
│   Reads CSV rows in batches of 10,000 · calls ML-Service via HTTP │
└───────────────────────────┬───────────────────────────────────────┘
                            │ HTTP POST /predict (JSON payload)
                            ▼
┌───────────────────────────────────────────────────────────────────┐
│          Python ML-Service (FastAPI — Port 8000)  [PLANNED]       │
│   Loads .pkl model (Isolation Forest / Random Forest)             │
│   Returns anomaly scores, labels, forecasts per row               │
└───────────────────────────────────────────────────────────────────┘
```

**Flow Summary:**
1. Admin logs in → Frontend renders protected dashboard.
2. Admin uploads a CSV/XLSX energy data file via the Dashboard tab.
3. Backend receives the file, saves metadata to Supabase, then **enqueues an async job** into the BullMQ `ml-prediction-queue` (backed by Redis).
4. The **BullMQ Worker** picks up the job, reads the file in configurable batches (10,000 rows), and sends each batch as an HTTP POST to the **Python ML-Service**.
5. The ML-Service loads the persisted `.pkl` model (Isolation Forest or Random Forest), runs inference, and returns anomaly predictions + scores.
6. Results are written back to Supabase, and the job status is updated (`PENDING → PROCESSING → COMPLETED / FAILED`).
7. The Frontend polls or reads from Supabase to display anomalies, forecasts, and job logs in real-time.

---

## 2. 💻 Tech Stack & Dependencies

### Frontend
| Technology | Version | Purpose |
|---|---|---|
| **Next.js** | 16.2.4 | React meta-framework (App Router) |
| **React** | 19 | UI library |
| **TypeScript** | 5.7.3 | Type safety |
| **Tailwind CSS** | 4.2.0 | Utility-first styling |
| **shadcn/ui** | (Radix UI primitives) | Accessible component library |
| **Recharts** | 2.15.0 | Data visualization / line charts |
| **React Hook Form** | 7.54.1 | Form state management |
| **Zod** | 3.24.1 | Client-side schema validation |
| **Lucide React** | 0.564.0 | Icon library |
| **Sonner** | 1.7.1 | Toast notifications |
| **next-themes** | 0.4.6 | Theme (light/dark) management |
| **@vercel/analytics** | 1.6.1 | Production analytics |

### Backend Main API
| Technology | Version | Purpose |
|---|---|---|
| **Node.js** | ≥18.0.0 | Runtime |
| **Express** | 4.18.2 | HTTP framework |
| **TypeScript** | 5.2.2 | Type safety |
| **Multer** | 1.4.5 | Multipart file upload handling |
| **Axios** | 1.6.0 | HTTP client (calls ML-Service) |
| **Zod** | 3.22.4 | Runtime env/request validation |
| **Winston + Pino** | 3.11 / 8.16 | Structured logging (custom logger wrapper) |

### Worker / Queue
| Technology | Version | Purpose |
|---|---|---|
| **BullMQ** | 5.1.0 | Job queue & worker framework |
| **ioredis** | 5.3.2 | Redis client |
| **Redis** | 7-alpine (Docker) | Queue broker & persistence |

### ML Service *(Planned — not yet in workspace)*
| Technology | Version | Purpose |
|---|---|---|
| **FastAPI** | TBD | High-performance Python REST API |
| **Python** | ≥3.10 | ML runtime |
| **Scikit-Learn** | TBD | Model framework (Isolation Forest, Random Forest) |
| **Pandas** | TBD | CSV data manipulation |
| **Joblib / Pickle** | TBD | `.pkl` model serialization & loading |

### Database & Auth
| Technology | Purpose |
|---|---|
| **Supabase** | Managed PostgreSQL, Auth (JWT), Realtime subscriptions |
| **Supabase Anon Key** | Frontend client-safe queries |
| **Supabase Service Role Key** | Backend admin operations (bypasses RLS) |

---

## 3. 📂 Project Structure

```
pln-ads/                              # ← Monorepo Root
│
├── docker-compose.yml                # Redis service definition (port 6379)
├── CORE_FEATURES.md                  # ← This file
│
├── backend/                          # Node.js / Express API
│   ├── package.json                  # Dependencies (BullMQ, Express, Supabase...)
│   ├── tsconfig.json                 # TypeScript config
│   ├── .env / .env.example           # Environment variables
│   ├── README.md                     # Backend-specific dev guide
│   └── src/
│       ├── index.ts                  # 🚪 Entry point — starts server, validates env
│       ├── app.ts                    # Express app: middleware, routes, error handler
│       ├── config/
│       │   ├── env.ts                # Zod-validated env schema (all config in one place)
│       │   ├── database.ts           # Supabase client factory (anon + service role)
│       │   └── redis.ts              # ioredis client factory with retry strategy
│       ├── middleware/
│       │   └── errorHandler.ts       # Global Express error handler
│       ├── utils/
│       │   ├── logger.ts             # Custom color-coded logger (debug/info/warn/error)
│       │   └── errors.ts             # Custom AppError hierarchy (Validation, Auth, NotFound...)
│       ├── constants/
│       │   └── config.ts             # 🔑 Key business constants (queue name, thresholds, CSV headers)
│       │
│       │   ── [TO BE BUILT] ──────────────────────────────────────────
│       ├── routes/                   # API route handlers (auth, upload, anomalies, jobs, stats)
│       ├── services/                 # Business logic layer
│       ├── schemas/                  # Zod request/response schemas
│       └── workers/                  # BullMQ worker definitions (ml-prediction-queue)
│
├── frontend_ads/                     # Next.js 16 App Router frontend
│   ├── package.json                  # Dependencies (React 19, Recharts, shadcn...)
│   ├── next.config.mjs               # Next.js config (TS errors ignored in build)
│   ├── tsconfig.json                 # TypeScript config
│   ├── postcss.config.mjs            # PostCSS (Tailwind v4)
│   ├── components.json               # shadcn/ui config
│   ├── app/
│   │   ├── layout.tsx                # Root layout: Geist font, metadata, Vercel Analytics
│   │   ├── page.tsx                  # 🚪 Main page: auth gate → dashboard shell
│   │   └── globals.css               # Global Tailwind + CSS variables
│   ├── components/
│   │   ├── login.tsx                 # Login form (demo auth only)
│   │   ├── navbar.tsx                # Top navigation bar (logout button)
│   │   ├── sidebar.tsx               # Left navigation: Dashboard, Anomalies, Forecast, Upload Logs
│   │   ├── dashboard-tab.tsx         # KPI cards + CSV drag-and-drop upload widget
│   │   ├── anomalies-tab.tsx         # Anomalies table (search + pagination) — MOCK DATA
│   │   ├── forecast-tab.tsx          # Forecast line chart (Recharts) — MOCK DATA
│   │   ├── upload-logs-tab.tsx       # File upload history table — MOCK DATA
│   │   └── ui/                       # shadcn/ui primitive components (Button, Input, Card...)
│   ├── hooks/
│   │   ├── use-mobile.ts             # Responsive breakpoint hook
│   │   └── use-toast.ts              # Toast notification hook
│   └── lib/
│       └── utils.ts                  # cn() utility (clsx + tailwind-merge)
│
└── ml-service/                       # [DOES NOT EXIST YET — To Be Created]
    # Python FastAPI service
    # requirements.txt
    # main.py (FastAPI app)
    # models/
    #   └── model.pkl (trained .pkl file)
    # routers/
    #   └── predict.py
```

---

## 4. ⚙️ Core Features & User Journeys

### Feature 1: 🔐 Authentication
- **Current State:** Demo-only front-end auth. Any non-empty email/password combination grants access (`page.tsx` L17-22).
- **Planned:** Full Supabase Auth integration (JWT tokens, RLS policies, session management).
- **User Journey:** User visits the app → Login page with PLN branding → Enters credentials → Supabase validates JWT → Session stored → Dashboard unlocked.

---

### Feature 2: 📤 CSV/XLSX File Upload (Main ML Feature)
**User Journey (End-to-End Target Flow):**
1. Admin navigates to **Dashboard** tab.
2. Drags & drops (or clicks to select) an energy data CSV/XLSX file (max 100 MB).
3. Frontend validates file type/size client-side, then sends a `multipart/form-data` POST to `POST /api/upload`.
4. Backend (Multer) receives the file, stores it to the `UPLOAD_DIR`, writes an upload record to Supabase (`status: PENDING`), and **enqueues a job** in the `ml-prediction-queue` BullMQ queue.
5. The API immediately returns `{ jobId, uploadId, status: "PENDING" }` to the frontend.
6. The **BullMQ Worker** picks up the job and:
   - Streams/reads the CSV file in **10,000-row batches** (`JOB_CONFIG.BATCH_SIZE`).
   - Updates Supabase upload record to `PROCESSING`.
   - For each batch, sends `POST http://localhost:8000/predict` to the ML-Service.
7. ML-Service loads the `.pkl` model, runs Isolation Forest anomaly scoring, returns results.
8. Worker writes anomaly records to Supabase and updates status to `COMPLETED` (or `FAILED` on error, retrying up to 3 times with 5s backoff).
9. Frontend displays updated status in the **Upload Logs** tab and populates **Anomalies** / **Forecast** tabs with live data.

**Expected CSV Format:**
```
date, customer_id, customer_name, kwh_usage
```

---

### Feature 3: 🚨 Anomaly Detection Table
- Displays all anomalies detected by the ML model.
- **Severity Levels:** LOW (< 0.3), MEDIUM (< 0.6), HIGH (< 0.8), CRITICAL (≥ 0.8) — based on anomaly score thresholds defined in `constants/config.ts`.
- **Status Lifecycle:** `PENDING → CONFIRMED / REJECTED` (manual review by admin).
- Table shows: ID, Location, Date & Time, Actual kWh, Expected kWh, Deviation %, Severity badge.
- Includes client-side search by location/date/ID and pagination (5 items/page).
- **Current State:** All data is **hardcoded mock data** in `anomalies-tab.tsx`. Real data fetch from Supabase not yet wired up.

---

### Feature 4: 📈 Energy Consumption Forecasting
- Line chart (Recharts) showing Actual vs. Predicted kWh over time.
- Filterable by **PLN zone/ULP location** (Indrapura, Ploso, Tandes, Perak, Kenjeran, Embong Wungu) and **time range** (7d / 30d / 90d).
- Shows statistics: Average Actual kWh, Average Predicted kWh, Model Accuracy (MAE-based).
- Future dates display only the predicted line; past dates show both.
- **Current State:** All data is **hardcoded mock data** in `forecast-tab.tsx`. Real forecast API call not yet implemented.

---

### Feature 5: 📋 Upload Logs & Job Monitoring
- Table showing all file upload history with: File Name, Upload Timestamp, File Size, Uploader Name, Status badge.
- Status badges: `Completed` (green), `Processing` (yellow), `Failed` (red).
- Includes client-side search by filename and pagination (5 items/page).
- **Current State:** All data is **hardcoded mock data** in `upload-logs-tab.tsx`. Real Supabase query not yet connected.

---

## 5. 🔌 API & Integration Map

### Backend REST API (Port 3001)

| Method | Endpoint | Status | Description |
|--------|----------|--------|-------------|
| `GET` | `/health` | ✅ Live | Health check — returns `{ status, timestamp, environment }` |
| `GET` | `/api/version` | ✅ Live | API version info |
| `POST` | `/api/auth/login` | 🔲 Planned | Supabase Auth sign-in, returns JWT |
| `POST` | `/api/auth/logout` | 🔲 Planned | Invalidate session |
| `POST` | `/api/upload` | 🔲 Planned | Multipart file upload, enqueue BullMQ job |
| `GET` | `/api/upload/logs` | 🔲 Planned | Paginated list of upload records from Supabase |
| `GET` | `/api/jobs/:jobId` | 🔲 Planned | Poll single job status from BullMQ |
| `GET` | `/api/anomalies` | 🔲 Planned | Paginated anomaly records, filterable |
| `PATCH` | `/api/anomalies/:id` | 🔲 Planned | Update anomaly status (CONFIRM/REJECT) |
| `GET` | `/api/stats/dashboard` | 🔲 Planned | Aggregate KPIs (total kWh, anomaly count, etc.) |
| `GET` | `/api/forecast` | 🔲 Planned | Forecast data by zone & time range |

### ML-Service REST API (Port 8000 — FastAPI, Planned)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | ML-Service health + model status |
| `POST` | `/predict` | Send batch of CSV rows, receive anomaly scores + labels |
| `GET` | `/models` | List loaded models and their metadata |

### Service-to-Service Communication

```
Frontend (3000) ──────────────────────────► Backend API (3001)
                   REST (CORS allowed)

Backend API (3001) ───────────────────────► Supabase (cloud)
                   @supabase/supabase-js

Backend API (3001) ───────────────────────► Redis (6379)
                   ioredis + BullMQ

BullMQ Worker ────────────────────────────► ML-Service (8000)
                   axios HTTP POST /predict

BullMQ Worker ────────────────────────────► Supabase (cloud)
                   @supabase/supabase-js (service role key)
```

### Key Business Constants (`backend/src/constants/config.ts`)

```typescript
UPLOAD_QUEUE_NAME = 'ml-prediction-queue'

ANOMALY_THRESHOLDS = { LOW: 0.3, MEDIUM: 0.6, HIGH: 0.8 }
// Score >= 0.8 → CRITICAL, >= 0.6 → HIGH, >= 0.3 → MEDIUM, else LOW

CSV_HEADERS = ['date', 'customer_id', 'customer_name', 'kwh_usage']

JOB_CONFIG = {
  MAX_ATTEMPTS: 3,         // retries on failure
  BACKOFF_DELAY: 5000ms,   // 5 seconds between retries
  TIMEOUT: 300000ms,       // 5 minute job timeout
  BATCH_SIZE: 10000,       // rows sent per ML-Service call
}
```

---

## 6. 🚦 Current State & Next Steps

### ✅ What Is Already Built & Working

| Component | Status | Details |
|-----------|--------|---------|
| **Frontend Shell** | ✅ Complete | Full SPA layout: Login, Navbar, Sidebar, 4-tab navigation |
| **Login UI** | ✅ (Demo only) | Form renders correctly; accepts any non-empty credentials |
| **Dashboard Tab** | ✅ (Static UI) | KPI cards with hardcoded values; drag-and-drop file input wired to UI only |
| **Anomalies Tab** | ✅ (Static UI) | Table with search, pagination, severity badges — all mock data |
| **Forecast Tab** | ✅ (Static UI) | Recharts line chart with Actual/Predicted lines — all mock data |
| **Upload Logs Tab** | ✅ (Static UI) | Table with search, pagination, status badges — all mock data |
| **Backend Scaffold** | ✅ Complete | Express app, global error handler, 404 handler |
| **Backend Config** | ✅ Complete | Zod env validation, Supabase client factory, Redis client factory |
| **Backend Utilities** | ✅ Complete | Custom logger, full AppError class hierarchy |
| **Business Constants** | ✅ Complete | Queue name, thresholds, CSV headers, job config |
| **Redis (Docker)** | ✅ Ready | `docker-compose.yml` defines Redis 7-alpine with AOF persistence |
| **BullMQ Dependency** | ✅ Installed | `bullmq@5.1.0` and `ioredis@5.3.2` in `package.json` |

---

### 🔲 What Needs To Be Built Next (Priority Order)

#### Phase 1 — Backend API Routes (Critical Path)
1. **`src/routes/auth.ts`** — Supabase Auth: login, logout, session refresh
2. **`src/routes/upload.ts`** — Multer file handler: validate CSV headers → save to disk → write Supabase record → enqueue BullMQ job
3. **`src/workers/mlWorker.ts`** — BullMQ worker: read file in batches → POST to ML-Service → write results to Supabase → update job status
4. **`src/routes/jobs.ts`** — Job status polling endpoint for frontend
5. **`src/routes/anomalies.ts`** — CRUD for anomaly records with filtering/pagination
6. **`src/routes/stats.ts`** — Dashboard KPI aggregations
7. **`src/routes/forecast.ts`** — Forecast data retrieval by zone + time range

#### Phase 2 — Database Schema (Supabase/PostgreSQL) - ✅ ALREADY DEPLOYED
The database is already deployed with the following tables (along with RLS policies and Realtime subscriptions):
- `profiles` — User profiles linked to Supabase Auth (`id, full_name, role, is_active`)
- `upload_logs` — Upload records (`id, user_id, file_name, status, rows_total, rows_success, rows_failed`)
- `customers` — Customer master data from uploads (`customer_id, full_name, tariff, contract_power_va, meter_type, region`)
- `customer_kwh_history` — 12-month historical consumption (`customer_id, month_1 ... month_12`)
- `anomaly_scores` — ML results (`id, customer_id, upload_id, anomaly_score, category, confidence, flags`)
- `forecast_results` — Forecast predictions (`customer_id, month_offset, predicted_kwh, confidence, model_type`)
- `jobs` — Background job queue (`upload_id, type, status, data, error_message`)
- `audit_logs` — Immutable activity log (`user_id, action, module, status`)

#### Phase 3 — Python ML-Service (New Service)
Create the `ml-service/` directory:
- `main.py` — FastAPI application setup
- `routers/predict.py` — `POST /predict` endpoint that loads `.pkl` and runs inference
- `models/` — Place trained `.pkl` model file(s) here
- `requirements.txt` — fastapi, uvicorn, scikit-learn, pandas, joblib
- `Dockerfile` — Containerize the service

#### Phase 4 — Frontend API Integration
Replace all **mock/hardcoded data** with real API calls:
- Wire up `login.tsx` → `POST /api/auth/login` (Supabase JWT)
- Wire up `dashboard-tab.tsx` file upload → `POST /api/upload`
- Wire up `upload-logs-tab.tsx` → `GET /api/upload/logs` with real-time job status polling
- Wire up `anomalies-tab.tsx` → `GET /api/anomalies` (server-side search/filter/pagination)
- Wire up `forecast-tab.tsx` → `GET /api/forecast?zone=...&range=...`
- Wire up KPI cards in `dashboard-tab.tsx` → `GET /api/stats/dashboard`

#### Phase 5 — Production Hardening
- Add Supabase Row Level Security (RLS) policies
- Add JWT authentication middleware in Express (`src/middleware/auth.ts`)
- Implement rate limiting
- Complete Docker Compose with all services (backend, frontend, ml-service, Redis)
- Add environment-specific `.env` files for staging/production
- Set up BullMQ dashboard (Bull Board) for job monitoring
