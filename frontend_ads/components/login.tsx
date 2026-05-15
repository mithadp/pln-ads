'use client'

/**
 * FIX TS(71007) — "Props must be serializable for components in the 'use client' entry file"
 *
 * Masalah: prop `onLogin: (...) => Promise<void>` dianggap tidak serializable
 * oleh Next.js TypeScript plugin karena Login adalah "use client" entry.
 *
 * Solusi: Login SELF-CONTAINED — import supabase langsung, auth ditangani di sini,
 * hanya terima `onSuccess: () => void` (void callback tidak trigger ts71007).
 */

import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface LoginProps {
  /** Dipanggil setelah login BERHASIL. Void callback = tidak memicu ts(71007). */
  onSuccess: () => void
}

export function Login({ onSuccess }: LoginProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // Auth langsung di sini — tidak perlu prop fungsi kompleks dari parent
  const handleClick = async () => {
    setError('')

    if (!email || !password) {
      setError('Please enter both email and password')
      return
    }

    setLoading(true)
    try {
      const { data, error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      if (authError) {
        console.error('[Login] Auth error:', authError.message)
        setError(authError.message)
        return
      }

      if (!data.user || !data.session) {
        setError('No session returned — periksa pengaturan Email Confirmation di Supabase')
        return
      }

      console.log('[Login] ✅ Login success. userId:', data.user.id)
      onSuccess()

    } catch (err: any) {
      console.error('[Login] Unexpected error:', err)
      setError(err?.message ?? 'Unexpected error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4"
      style={{
        backgroundImage:
          "url('https://hebbkx1anhila5yf.public.blob.vercel-storage.com/gedung-pln-Fbo2KpcU173m135eTIbSeSrzp8wWyS.png')",
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundAttachment: 'fixed',
      }}
    >
      {/* Dark overlay */}
      <div className="absolute inset-0 bg-black/40" />

      <div className="w-full max-w-md relative z-10">
        <div className="bg-white border border-slate-200 rounded-lg p-8 space-y-8 shadow-lg">
          <div className="flex flex-col items-center gap-4">
            <img
              src="https://hebbkx1anhila5yf.public.blob.vercel-storage.com/logo%20pln%20vertica%3B-vacVLTjf63SniRmskFjoThxY53K0lk.png"
              alt="PLN Logo"
              className="h-24 w-auto"
            />
            <h1 className="text-2xl font-bold text-slate-900">PLN-ADS</h1>
            <p className="text-slate-600 text-sm">
              Energy Monitoring &amp; Anomaly Detection System
            </p>
          </div>

          {/*
           * FIX 1: noValidate + onSubmit preventDefault → tutup semua jalur native submit.
           * Tanpa preventDefault, tekan Enter di input bisa memicu implicit submit
           * (GET /?) walau tombol sudah type="button". Enter sekarang men-trigger login.
           */}
          <form
            noValidate
            onSubmit={(e) => {
              e.preventDefault()
              if (!loading) handleClick()
            }}
            className="space-y-5"
          >
            <div className="space-y-2">
              <label
                htmlFor="email"
                className="block text-sm font-semibold text-slate-900"
              >
                Email Address
              </label>
              <Input
                id="email"
                type="email"
                placeholder="you@pln.co.id"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-slate-50 text-slate-900 placeholder:text-slate-400 border border-slate-300 rounded-lg px-4 py-2"
              />
            </div>

            <div className="space-y-2">
              <label
                htmlFor="password"
                className="block text-sm font-semibold text-slate-900"
              >
                Password
              </label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-slate-50 text-slate-900 placeholder:text-slate-400 border border-slate-300 rounded-lg px-4 py-2"
              />
            </div>

            {error && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}

            {/*
             * FIX 1 — INTI PERBAIKAN:
             *   SEBELUM : type="submit"  → browser kirim GET /?
             *   SESUDAH : type="button"  → browser tidak trigger form submit
             *
             * Logic login dipindah ke onClick={handleClick}
             */}
            <Button
              type="button"
              onClick={handleClick}
              disabled={loading}
              className="w-full bg-blue-600 text-white hover:bg-blue-700 font-semibold py-2 rounded-lg transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {loading ? 'Signing in…' : 'Sign In'}
            </Button>
          </form>
        </div>
      </div>
    </div>
  )
}
