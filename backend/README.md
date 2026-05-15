# PLN-ADS Backend API

Backend service untuk PLN Anomaly Detection System. Dibangun dengan Node.js, Express, TypeScript, dan Supabase.

## 📋 Prasyarat

- Node.js 18+ dan npm 9+
- Redis 6.0+ (Docker)
- Supabase project (untuk database)

## 🚀 Instalasi & Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Konfigurasi Environment

Copy `.env.example` ke `.env.local` dan isi dengan kredensial Anda:

```bash
cp .env.example .env.local
```

Edit `.env.local`:

```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
REDIS_HOST=localhost
REDIS_PORT=6379
```

### 3. Start Redis (Docker)

Dari root project (`pln-ads`):

```bash
docker-compose up -d redis
```

Verifikasi Redis berjalan:

```bash
redis-cli ping
# Output: PONG
```

### 4. Run Development Server

```bash
npm run dev
```

Output yang diharapkan:

```
✅ Environment variables validated
✅ Supabase client initialized
✅ Redis client connected
🚀 Backend server running on http://localhost:3001
📡 Environment: development
```

## 📦 Available Scripts

```bash
# Development
npm run dev              # Start with ts-node (watch mode)
npm run watch           # Compile TypeScript with watch

# Production
npm run build           # Build to dist/
npm start              # Run compiled JavaScript

# Quality
npm run lint           # ESLint
npm test              # Jest
npm run format        # Prettier
```

## 📁 Folder Structure

```
src/
├── config/           # Configuration modules
│   ├── env.ts       # Environment validation
│   ├── database.ts  # Supabase client
│   └── redis.ts     # Redis client
├── middleware/       # Express middleware
│   └── errorHandler.ts
├── routes/          # API routes (to be implemented)
├── services/        # Business logic (to be implemented)
├── schemas/         # Zod schemas (to be implemented)
├── utils/          # Utilities
│   ├── logger.ts
│   └── errors.ts
├── constants/       # Constants
│   └── config.ts
├── app.ts          # Express app setup
└── index.ts        # Entry point
```

## 🔌 API Endpoints

### Health Check

```bash
GET http://localhost:3001/health
```

Response:

```json
{
  "status": "ok",
  "timestamp": "2026-05-03T14:35:22Z",
  "environment": "development"
}
```

## 🔧 Environment Variables

| Variable | Deskripsi | Required |
|----------|-----------|----------|
| `NODE_ENV` | Environment (development, staging, production) | No |
| `PORT` | Port server (default: 3001) | No |
| `SUPABASE_URL` | Supabase project URL | Yes |
| `SUPABASE_ANON_KEY` | Supabase anon key | Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (for admin operations) | Yes |
| `REDIS_HOST` | Redis host (default: localhost) | No |
| `REDIS_PORT` | Redis port (default: 6379) | No |
| `REDIS_PASSWORD` | Redis password (optional) | No |
| `ML_SERVICE_URL` | ML-Service URL (default: http://localhost:8000) | No |
| `CORS_ORIGIN` | CORS origin (default: http://localhost:3000) | No |
| `LOG_LEVEL` | Log level (debug, info, warn, error) | No |

## 📝 Development Guide

### Menambah Endpoint Baru

1. Buat file route di `src/routes/`
2. Buat handler logic di `src/services/`
3. Buat schema validation di `src/schemas/`
4. Import dan register route di `src/app.ts`

Contoh:

```typescript
// src/routes/example.ts
import { Router } from 'express'

const router = Router()

router.get('/', (req, res) => {
  res.json({ message: 'Hello' })
})

export default router

// src/app.ts
import exampleRoutes from './routes/example'
app.use('/api/example', exampleRoutes)
```

### Error Handling

Gunakan custom error classes:

```typescript
import { ValidationError, NotFoundError } from './utils/errors'

// Validation error
throw new ValidationError('Invalid input', { field: 'email' })

// Not found error
throw new NotFoundError('User')

// Auto-handled by errorHandler middleware
```

## 🧪 Testing

```bash
npm test
```

## 🐛 Troubleshooting

### Redis Connection Failed

```
Error: connect ECONNREFUSED 127.0.0.1:6379
```

**Solusi:** Pastikan Redis container berjalan:

```bash
docker-compose up -d redis
docker-compose ps  # Verify redis running
```

### Supabase Connection Failed

**Solusi:** Verifikasi `.env.local`:

```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=correct-key
```

### Port 3001 Already in Use

```bash
# Kill process using port 3001
netstat -ano | findstr :3001
taskkill /PID <PID> /F
```

## 📚 Dokumentasi Lebih Lanjut

- [Express.js Docs](https://expressjs.com/)
- [TypeScript Docs](https://www.typescriptlang.org/)
- [Supabase Docs](https://supabase.com/docs)
- [BullMQ Docs](https://docs.bullmq.io/)

## 📄 License

MIT
