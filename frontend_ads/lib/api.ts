/**
 * Resolve the backend API base URL at request time.
 *
 * Three resolution modes, in priority order:
 *   1. NEXT_PUBLIC_API_URL is set AND looks like a real backend domain
 *      (https or non-localhost) → use it. This is the production path:
 *      Vercel sets it to https://pln-ads-backend.railway.app and every
 *      client uses that regardless of which Vercel preview/prod domain
 *      served the page.
 *   2. Running in a browser → mirror window.location.hostname on port 3001.
 *      This is the LAN dev path: laptop at http://localhost:3002 fetches
 *      from http://localhost:3001; phone at http://192.168.0.126:3002
 *      fetches from http://192.168.0.126:3001. Same bundle, host-aware.
 *   3. Running server-side without an env var → fall back to localhost:3001.
 */

const BACKEND_PORT = 3001

function isProductionApiUrl(value: string | undefined): value is string {
  if (!value) return false
  // Treat any explicit non-localhost URL as production-ish. localhost vals
  // are dev-only defaults from .env.example and should NOT override the
  // dynamic LAN resolver.
  return !/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(value)
}

export function getApiBase(): string {
  const envUrl = process.env.NEXT_PUBLIC_API_URL

  if (isProductionApiUrl(envUrl)) {
    return envUrl
  }

  if (typeof window !== 'undefined') {
    // Browser dev: follow the hostname the user typed.
    return `${window.location.protocol}//${window.location.hostname}:${BACKEND_PORT}`
  }

  // Server-side dev fallback.
  return envUrl || `http://localhost:${BACKEND_PORT}`
}
