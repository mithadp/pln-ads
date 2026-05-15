'use client'

import { useState, useEffect } from 'react'
import { Navbar } from '@/components/navbar'
import { Sidebar } from '@/components/sidebar'
import { Login } from '@/components/login'
import { DashboardTab } from '@/components/dashboard-tab'
import { AnomaliesTab } from '@/components/anomalies-tab'
import { ForecastTab } from '@/components/forecast-tab'
import { UploadLogsTab } from '@/components/upload-logs-tab'
import { supabase } from '@/lib/supabase'

export default function Home() {
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [userId, setUserId] = useState<string>('demo-user')
  const [activeTab, setActiveTab] = useState('dashboard')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sessionChecked, setSessionChecked] = useState(false)

  // ── Restore session saat page load ─────────────────────────────────────────
  useEffect(() => {
    // Helper: a stale refresh token in localStorage will make getSession() /
    // auto-refresh throw AuthApiError("Invalid Refresh Token: ..."). The fix
    // is to wipe the broken session and put the UI back to logged-out cleanly.
    const handleAuthFailure = async (reason: string) => {
      console.warn(`[Auth] Clearing stale session: ${reason}`)
      try {
        await supabase.auth.signOut()
      } catch {
        /* signOut on an already-invalid session can throw; we don't care */
      }
      setIsLoggedIn(false)
      setUserId('demo-user')
    }

    supabase.auth
      .getSession()
      .then(({ data: { session }, error }) => {
        if (error) {
          // Includes AuthApiError("Invalid Refresh Token: Refresh Token Not Found")
          handleAuthFailure(error.message)
          setSessionChecked(true)
          return
        }
        console.log('[getSession] result:', session ? 'FOUND' : 'NONE')
        if (session?.user) {
          setUserId(session.user.id)
          setIsLoggedIn(true)
          console.log('STATE UPDATE: isLoggedIn is now true')
        }
        setSessionChecked(true)
      })
      .catch((err) => {
        // Network failure or unexpected exception — fail closed (logged out).
        handleAuthFailure(err?.message ?? 'unknown getSession error')
        setSessionChecked(true)
      })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      console.log('[onAuthStateChange]', event)

      if (session?.user) {
        setUserId(session.user.id)
        setIsLoggedIn(true)
        console.log('STATE UPDATE: isLoggedIn is now true')
        return
      }

      // No session AND it's a refresh / sign-out event → drop the UI back
      // to the login screen rather than leaving stale state.
      if (event === 'SIGNED_OUT' || event === 'TOKEN_REFRESHED') {
        setIsLoggedIn(false)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  // Login component sekarang self-contained.
  // onSuccess dipanggil setelah signInWithPassword berhasil di dalam Login.
  const handleLoginSuccess = async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (session?.user) {
      setUserId(session.user.id)
      setIsLoggedIn(true)
      console.log('STATE UPDATE: isLoggedIn is now true')
    }
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    setIsLoggedIn(false)
    setActiveTab('dashboard')
  }

  if (!sessionChecked) return null

  if (!isLoggedIn) {
    return <Login onSuccess={handleLoginSuccess} />
  }

  return (
    <div className="flex h-screen bg-white overflow-hidden">
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/20 lg:hidden z-30"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} sidebarOpen={sidebarOpen} />

      <div className="flex flex-col flex-1 overflow-hidden">
        <Navbar sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen} onLogout={handleLogout} />

        <main className="flex-1 overflow-auto bg-slate-50">
          <div className="p-6 lg:p-8 max-w-7xl mx-auto animate-in fade-in duration-500 bg-slate-50">
            <div className="mb-8 text-center animate-in fade-in slide-in-from-top-2 duration-700">
              <h2 className="text-2xl font-bold text-slate-900 tracking-tight">
                {activeTab === 'dashboard' && 'Dashboard'}
                {activeTab === 'anomalies' && 'Anomaly Detection'}
                {activeTab === 'forecast' && 'Forecasting'}
                {activeTab === 'upload-logs' && 'Upload Logs'}
              </h2>
              <p className="text-slate-500 mt-1.5 text-sm">
                {activeTab === 'dashboard' && 'Monitor energy consumption and upload new data'}
                {activeTab === 'anomalies' && 'Analyze detected anomalies in consumption patterns'}
                {activeTab === 'forecast' && 'View energy consumption predictions'}
                {activeTab === 'upload-logs' && 'View all uploaded files and their processing status'}
              </p>
              <div className="mt-3 mx-auto w-10 h-0.5 bg-blue-600 rounded-full" />
            </div>

            <div className="animate-in fade-in slide-in-from-bottom-2 duration-700 delay-100">
              {activeTab === 'dashboard' && <DashboardTab userId={userId} />}
              {activeTab === 'anomalies' && <AnomaliesTab />}
              {activeTab === 'forecast' && <ForecastTab />}
              {activeTab === 'upload-logs' && <UploadLogsTab />}
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}
