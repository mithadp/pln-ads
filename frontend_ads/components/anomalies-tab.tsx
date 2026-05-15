'use client'

import { useState, useEffect } from 'react'
import axios from 'axios'
import { getULPName, getULPColor } from '@/lib/ulpConfig'
import type { AnomalyAnalysis, IDPELItem } from '@/types/anomaly'
import { IDPELDropdown } from '@/components/idpel-dropdown'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

// ── Severity badge ──────────────────────────────────────────
function SeverityBadge({ level }: { level: string }) {
  const styles: Record<string, string> = {
    critical: 'bg-red-50 text-red-700 border border-red-200',
    high: 'bg-red-50 text-red-700 border border-red-200',
    medium: 'bg-amber-50 text-amber-700 border border-amber-200',
    low: 'bg-blue-50 text-blue-700 border border-blue-200',
    normal: 'bg-green-50 text-green-700 border border-green-200',
  }
  const labels: Record<string, string> = {
    critical: 'Kritis', high: 'Tinggi', medium: 'Medium', low: 'Rendah', normal: 'Normal',
  }
  return (
    <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${styles[level] ?? styles.low}`}>
      {labels[level] ?? level}
    </span>
  )
}

// ── ULP badge ───────────────────────────────────────────────
function ULPBadge({ unitup }: { unitup: string }) {
  const c = getULPColor(unitup)
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold border"
      style={{ color: c.text, background: c.bg, borderColor: c.border }}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: c.text }} />
      {getULPName(unitup)}
    </span>
  )
}

// ── Main component ──────────────────────────────────────────
export function AnomaliesTab() {
  const [idpelList, setIdpelList] = useState<IDPELItem[]>([])
  const [selectedIDPEL, setSelectedIDPEL] = useState<string>('')
  const [result, setResult] = useState<AnomalyAnalysis | null>(null)
  const [loadingList, setLoadingList] = useState(true)
  const [loadingAnalysis, setLoadingAnalysis] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Fetch IDPEL list on mount + re-fetch when Dashboard signals new uploads.
  useEffect(() => {
    let cancelled = false
    const fetchList = async () => {
      setLoadingList(true)
      try {
        const res = await axios.get<IDPELItem[]>(`${API}/api/idpel-list`)
        if (cancelled) return
        setIdpelList(res.data ?? [])
      } catch (err: unknown) {
        if (cancelled) return
        const msg = axios.isAxiosError(err)
          ? err.response?.data?.message ?? err.message
          : 'Gagal memuat daftar IDPEL. Pastikan backend aktif di port 3001.'
        setError(msg)
      } finally {
        if (!cancelled) setLoadingList(false)
      }
    }
    fetchList()
    const onRefresh = () => fetchList()
    window.addEventListener('pln-idpel-refresh', onRefresh)
    return () => {
      cancelled = true
      window.removeEventListener('pln-idpel-refresh', onRefresh)
    }
  }, [])

  const handleAnalyze = async () => {
    if (!selectedIDPEL) return
    setLoadingAnalysis(true)
    setError(null)
    setResult(null)
    try {
      const res = await axios.get<AnomalyAnalysis>(
        `${API}/api/anomaly-analysis?idpel=${selectedIDPEL}`
      )
      setResult(res.data)
    } catch (err: unknown) {
      const msg = axios.isAxiosError(err)
        ? err.response?.data?.message ?? err.message
        : 'Terjadi kesalahan yang tidak diketahui'
      setError(msg)
    } finally {
      setLoadingAnalysis(false)
    }
  }

  return (
    <div className="space-y-5">
      <Card className="bg-white border border-slate-200 shadow-sm rounded-xl border-t-2 border-t-red-500">
        <CardHeader className="pb-4">
          <CardTitle className="text-slate-900">Anomaly Detection</CardTitle>
          <CardDescription>
            Pilih IDPEL pelanggan untuk melihat analisis anomali konsumsi listrik
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-5">

          {/* ── IDPEL Selector — searchable dropdown inline with Analisis button ── */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              IDPEL Pelanggan
            </label>
            <div className="flex gap-3 items-start">
              <div className="flex-1">
                <IDPELDropdown
                  items={idpelList}
                  value={selectedIDPEL}
                  onChange={setSelectedIDPEL}
                  loading={loadingList}
                />
              </div>
              <button
                onClick={handleAnalyze}
                disabled={!selectedIDPEL || loadingAnalysis}
                className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300
                           text-white text-sm font-semibold rounded-lg transition-colors
                           disabled:cursor-not-allowed whitespace-nowrap"
              >
                {loadingAnalysis ? 'Menganalisis...' : 'Analisis'}
              </button>
            </div>
            {!loadingList && (
              <p className="text-xs text-slate-400 mt-1">
                {idpelList.length} pelanggan tersedia · diurutkan terbaru di atas
              </p>
            )}
          </div>

          {/* ── Error state ── */}
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              {error}
            </div>
          )}

          {/* ── Loading skeleton ── */}
          {loadingAnalysis && (
            <div className="space-y-3 animate-pulse">
              <div className="h-16 bg-slate-100 rounded-xl" />
              <div className="grid grid-cols-3 gap-3">
                {[0, 1, 2].map((i) => <div key={i} className="h-20 bg-slate-100 rounded-xl" />)}
              </div>
              <div className="h-32 bg-slate-100 rounded-xl" />
            </div>
          )}

          {/* ── Empty state ── */}
          {!result && !loadingAnalysis && !error && (
            <div className="flex flex-col items-center justify-center py-16 text-slate-400">
              <svg className="w-12 h-12 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1}
                  d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586
                     a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <p className="text-sm font-medium">Pilih IDPEL dan klik Analisis</p>
              <p className="text-xs mt-1">Sistem akan mengevaluasi pola konsumsi pelanggan</p>
            </div>
          )}

          {/* ── Analysis result ── */}
          {result && !loadingAnalysis && (
            <>
              {/* Customer info bar */}
              <div className={`flex items-center gap-3 p-3 rounded-xl border ${
                result.is_anomaly
                  ? 'bg-red-50 border-red-200'
                  : 'bg-green-50 border-green-200'
              }`}>
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${
                  result.is_anomaly ? 'bg-red-600' : 'bg-green-600'
                }`}>
                  <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-slate-900 font-mono">{result.idpel}</p>
                  <div className="flex items-center gap-2 flex-wrap mt-0.5">
                    <ULPBadge unitup={result.unitup} />
                    <span className="text-xs text-slate-500">
                      Tarif {result.tarif || '—'} · Daya {result.daya.toLocaleString('id-ID')} VA
                    </span>
                  </div>
                  {result.model_used && (
                    <p className="text-xs text-slate-400 mt-0.5">
                      Model: <span className="font-mono">{result.model_used}</span>
                    </p>
                  )}
                </div>
                <span className={`px-3 py-1 rounded-full text-xs font-bold border ${
                  result.is_anomaly
                    ? 'bg-red-100 text-red-700 border-red-300'
                    : 'bg-green-100 text-green-700 border-green-300'
                }`}>
                  {result.is_anomaly ? 'Anomali Terdeteksi' : 'Normal'}
                </span>
              </div>

              {/* Summary cards — 3 cards, all read from the SAME top-level
                  fields that drove the customer-info badge. Single source of
                  truth: result.is_anomaly + result.confidence. */}
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-blue-50 border border-blue-100 rounded-xl p-3">
                  <p className="text-xs font-medium text-blue-600 mb-1">Confidence</p>
                  <p className="text-2xl font-bold text-blue-700 tabular-nums">
                    {result.confidence !== undefined
                      ? `${(result.confidence * 100).toFixed(0)}%`
                      : '—'}
                  </p>
                  <p className="text-xs text-blue-400 mt-0.5">Tingkat keyakinan model</p>
                </div>
                <div className={`${
                  result.is_anomaly
                    ? 'bg-red-50 border-red-100'
                    : 'bg-green-50 border-green-100'
                } border rounded-xl p-3`}>
                  <p className={`text-xs font-medium mb-1 ${
                    result.is_anomaly ? 'text-red-600' : 'text-green-600'
                  }`}>Status</p>
                  <p className={`text-2xl font-bold ${result.is_anomaly ? 'text-red-700' : 'text-green-700'}`}>
                    {result.is_anomaly ? 'Anomali' : 'Normal'}
                  </p>
                  <p className={`text-xs mt-0.5 ${
                    result.is_anomaly ? 'text-red-400' : 'text-green-400'
                  }`}>Hasil model RF</p>
                </div>
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
                  <p className="text-xs font-medium text-slate-600 mb-1">Total Data</p>
                  <p className="text-2xl font-bold text-slate-700 tabular-nums">
                    {result.summary.total_months}
                    <span className="text-sm font-normal text-slate-400"> bulan</span>
                  </p>
                  <p className="text-xs text-slate-400 mt-0.5">Riwayat yang dianalisis</p>
                </div>
              </div>

              {/* Signal list — single entry from RF verdict */}
              {result.signals.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                    Sinyal Model
                  </p>
                  <div className="space-y-1.5">
                    {result.signals.map((s, i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between px-3 py-2.5 bg-slate-50 rounded-lg border border-slate-100"
                      >
                        <span className="text-sm text-slate-700">{s.name}</span>
                        <SeverityBadge level={s.severity} />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Monthly table — display-only history (no ML decisions per-row) */}
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                  Riwayat Bulanan
                </p>
                <div className="overflow-x-auto rounded-lg border border-slate-200">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200">
                        <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">
                          Periode
                        </th>
                        <th className="px-3 py-2.5 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">
                          Aktual kWh
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {result.monthly.map((m, i) => (
                        <tr key={i} className="hover:bg-slate-50/80 transition-colors duration-100">
                          <td className="px-3 py-2.5 text-slate-700 font-medium">{m.periode}</td>
                          <td className="px-3 py-2.5 text-right text-slate-900 font-semibold tabular-nums">
                            {m.actual.toFixed(1)} kWh
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

        </CardContent>
      </Card>
    </div>
  )
}
