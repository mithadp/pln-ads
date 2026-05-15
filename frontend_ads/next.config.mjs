/**
 * next.config.mjs must be ESM. CommonJS would throw
 *   ReferenceError: module is not defined in ES module scope
 * and Next.js would silently fall back to default config.
 */
/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      allowedOrigins: ['172.22.96.1', 'localhost:3002'],
    },
  },
  allowedDevOrigins: ['172.22.96.1', 'localhost:3002'],

  // Production security headers — applied to every route.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ]
  },
}

export default nextConfig
