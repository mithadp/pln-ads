'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import axios from 'axios'
import {
  Upload, FileBox, Users, AlertTriangle, Clock,
  CheckCircle, AlertCircle, FileText, Loader2, XCircle, Circle,
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ULP_CODES, getULPColor, getULPName } from '@/lib/ulpConfig'
import { getApiBase } from '@/lib/api'

const API = getApiBase()

// ════════════════════════════════════════════════════════════════════════════
// Types — API response shapes
// ════════════════════════════════════════════════════════════════════════════
interface TopStats {
  total_files: number
  total_idpel: number
  total_anomalies: number
  last_upload: string
}

interface PerUlpRow {
  unitup: string
  ulp_name: string
  anomaly_count: number
  total_idpel: number
  file_count: number
}

interface RecentAnomalyRow {
  idpel: string
  unitup: string
  is_anomaly: boolean
  severity: string
}

// ── Multi-file upload queue (UNCHANGED — preserved verbatim) ────────────────
type FileStatus = 'waiting' | 'uploading' | 'done' | 'error'
interface QueueItem {
  id: string
  file: File
  status: FileStatus
  progress: number    // 0..100
  rows?: number
  error?: string
  uploadId?: string
}

interface UploadLogRow {
  id: string
  status: string
  rows_success: number | null
  rows_total: number | null
  error_message: string | null
}

interface UploadResponseShape {
  success: boolean
  message?: string
  data?: { uploadId?: string; jobId?: string; status?: string }
  hint?: string
  error?: string
}

function StatusIcon({ status }: { status: FileStatus }) {
  if (status === 'waiting') return <Circle size={16} className="text-slate-300 fill-slate-300" />
  if (status === 'uploading') return <Loader2 size={16} className="animate-spin text-blue-600" />
  if (status === 'done') return <CheckCircle size={16} className="text-green-600" />
  return <XCircle size={16} className="text-red-600" />
}

function QueueRow({ item }: { item: QueueItem }) {
  return (
    <div className="border border-slate-200 rounded-lg bg-white">
      <div className="flex items-center gap-3 p-3">
        <StatusIcon status={item.status} />
        <span
          className="flex-1 truncate text-sm font-medium text-slate-900"
          title={item.file.name}
        >
          {item.file.name}
        </span>

        {item.status === 'waiting' && (
          <span className="text-xs text-slate-500">Menunggu…</span>
        )}

        {item.status === 'uploading' && (
          <div className="w-40 flex items-center gap-2">
            <div className="flex-1 h-2 bg-slate-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-600 transition-all duration-200 ease-out"
                style={{ width: `${item.progress}%` }}
              />
            </div>
            <span className="text-xs text-slate-600 tabular-nums w-10 text-right">
              {item.progress}%
            </span>
          </div>
        )}

        {item.status === 'done' && (
          <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold border bg-green-100 text-green-800 border-green-200 tabular-nums">
            <CheckCircle size={12} />
            {(item.rows ?? 0).toLocaleString('id-ID')} baris
          </span>
        )}

        {item.status === 'error' && (
          <span
            className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold border bg-red-100 text-red-800 border-red-200 max-w-xs truncate"
            title={item.error}
          >
            <XCircle size={12} />
            {(item.error ?? 'Error').slice(0, 40)}
          </span>
        )}
      </div>

      {item.status === 'done' && (
        <div className="px-3 pb-2 text-xs text-slate-400">
          Data tersimpan · Analisis ML diproses di background
        </div>
      )}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// Small presentational helpers for the new stats sections
// ════════════════════════════════════════════════════════════════════════════
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

export function DashboardTab({ userId }: { userId: string }) {
  const [dragActive, setDragActive] = useState(false)

  // ── New stats state ────────────────────────────────────────────────────────
  const [selectedUlp, setSelectedUlp] = useState<string>('')   // '' = all ULPs
  const [topStats, setTopStats] = useState<TopStats | null>(null)
  const [perUlp, setPerUlp] = useState<PerUlpRow[]>([])
  const [recentAnomalies, setRecentAnomalies] = useState<RecentAnomalyRow[]>([])
  const [loadingStats, setLoadingStats] = useState(true)
  const [statsError, setStatsError] = useState<string | null>(null)

  // ── Upload queue state (UNCHANGED — preserved verbatim) ────────────────────
  const [queue, setQueue] = useState<QueueItem[]>([])
  const queueRef = useRef<QueueItem[]>([])
  const processingRef = useRef(false)
  const [pulse, setPulse] = useState<'success' | 'error' | null>(null)

  // ── Stats fetcher (reruns on filter change and on upload completion) ───────
  const fetchStats = useCallback(async () => {
    setLoadingStats(true)
    setStatsError(null)
    // Resolve API base inside the call so window.location is guaranteed
    // current — module-level evaluation can race with hydration.
    const apiBase = getApiBase()
    console.log('[Dashboard] fetching from API base:', apiBase)
    try {
      const params = selectedUlp ? { unitup: selectedUlp } : {}
      const [topRes, perRes, recentRes] = await Promise.all([
        axios.get<TopStats>(`${apiBase}/api/stats`, { params }),
        axios.get<PerUlpRow[]>(`${apiBase}/api/stats/per-ulp`),
        axios.get<RecentAnomalyRow[]>(`${apiBase}/api/stats/recent-anomalies`, { params: { limit: 5 } }),
      ])
      setTopStats(topRes.data)
      setPerUlp(perRes.data ?? [])
      setRecentAnomalies(recentRes.data ?? [])
      console.log('[Dashboard] ✅ stats fetched', { ulp: selectedUlp || 'ALL' })
    } catch (err: unknown) {
      const msg = axios.isAxiosError(err)
        ? err.response?.data?.message ?? err.message
        : 'Data Unavailable — backend offline or /api/stats failing'
      console.error('[Dashboard] stats fetch failed:', msg, 'API base was:', apiBase)
      setStatsError(msg)
    } finally {
      setLoadingStats(false)
    }
  }, [selectedUlp])

  useEffect(() => {
    let cancelled = false
    fetchStats().catch(() => { /* errors already handled */ })
    // Auto-refresh when an upload completes (queue drain dispatches this).
    const onRefresh = () => { if (!cancelled) fetchStats() }
    window.addEventListener('pln-idpel-refresh', onRefresh)
    return () => {
      cancelled = true
      window.removeEventListener('pln-idpel-refresh', onRefresh)
    }
  }, [fetchStats])

  // ════════════════════════════════════════════════════════════════════════
  // UPLOAD LOGIC — UNCHANGED FROM THIS LINE TO `enqueueFiles` END
  // (per instructions: do not touch any upload-related code)
  // ════════════════════════════════════════════════════════════════════════

  const setQueueState = (updater: (prev: QueueItem[]) => QueueItem[]) => {
    queueRef.current = updater(queueRef.current)
    setQueue([...queueRef.current])
  }

  const updateItem = (id: string, patch: Partial<QueueItem>) => {
    setQueueState((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)))
  }

  const flashPulse = (kind: 'success' | 'error') => {
    setPulse(kind)
    setTimeout(() => setPulse(null), 2000)
  }

  // Poll /api/upload-logs for the final row count + status. Worker is async
  // (BullMQ), so the synchronous POST /api/upload only returns 'processing'.
  const waitForWorker = async (uploadId: string): Promise<{
    status: 'completed' | 'failed'
    rows: number
    error?: string
  }> => {
    const maxAttempts = 15
    for (let attempts = 0; attempts < maxAttempts; attempts++) {
      await new Promise((r) => setTimeout(r, 2000))
      try {
        const res = await axios.get<UploadLogRow[]>(`${API}/api/upload-logs`, { params: { limit: 20 } })
        const match = (res.data ?? []).find((log) => log.id === uploadId)
        if (match && match.status && match.status !== 'processing') {
          return {
            status: match.status === 'completed' ? 'completed' : 'failed',
            rows: match.rows_success ?? match.rows_total ?? 0,
            error: match.error_message ?? undefined,
          }
        }
      } catch {
        /* swallow polling errors — keep trying */
      }
    }
    // Polling timeout: optimistic completion so the UI doesn't hang forever.
    return { status: 'completed', rows: 0 }
  }

  // Single-file upload that updates a specific queue item. Returns a Promise
  // so the queue drain loop can await it (sequential processing).
  const uploadOne = (item: QueueItem): Promise<void> => {
    return new Promise<void>((resolve) => {
      updateItem(item.id, { status: 'uploading', progress: 0 })

      const xhr = new XMLHttpRequest()
      xhr.open('POST', `${API}/api/upload`)

      xhr.upload.onprogress = (e: ProgressEvent) => {
        if (e.lengthComputable) {
          updateItem(item.id, { progress: Math.round((e.loaded / e.total) * 100) })
        }
      }

      xhr.onload = async () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const res = JSON.parse(xhr.responseText) as UploadResponseShape
            const uploadId = res?.data?.uploadId
            console.log('[Dashboard] ✅ Upload accepted', res)
            updateItem(item.id, { progress: 100, uploadId })
            if (uploadId) {
              const final = await waitForWorker(uploadId)
              updateItem(item.id, {
                status: final.status === 'completed' ? 'done' : 'error',
                rows: final.rows,
                error: final.status === 'failed' ? (final.error ?? 'Processing failed') : undefined,
              })
              flashPulse(final.status === 'completed' ? 'success' : 'error')
            } else {
              updateItem(item.id, { status: 'done' })
              flashPulse('success')
            }
          } catch {
            updateItem(item.id, { status: 'error', error: 'Invalid response from server' })
            flashPulse('error')
          }
        } else {
          let message = `HTTP ${xhr.status}`
          try {
            const errResp = JSON.parse(xhr.responseText) as UploadResponseShape
            message = errResp.message ?? errResp.hint ?? errResp.error ?? message
          } catch {
            /* response wasn't JSON */
          }
          console.error('[Dashboard] Upload failed:', message)
          updateItem(item.id, { status: 'error', error: message })
          flashPulse('error')
        }
        resolve()
      }

      xhr.onerror = () => {
        console.error('[Dashboard] Upload network error')
        updateItem(item.id, { status: 'error', error: 'Network error — backend offline?' })
        flashPulse('error')
        resolve()
      }

      const form = new FormData()
      form.append('file', item.file)
      form.append('userId', userId)
      xhr.send(form)
    })
  }

  /**
   * Enqueue one or more files and start sequential processing if idle.
   * Sequential (one xhr at a time) protects the backend from getting hit
   * with multiple concurrent ML pipeline runs. Errors on one file don't
   * stop the queue from continuing with the next.
   */
  const enqueueFiles = async (files: File[]) => {
    if (files.length === 0) return
    const newItems: QueueItem[] = files.map((file, i) => ({
      id: `${Date.now()}-${i}-${file.name}`,
      file,
      status: 'waiting',
      progress: 0,
    }))
    setQueueState((prev) => [...prev, ...newItems])

    if (processingRef.current) return
    processingRef.current = true
    try {
      // Drain whatever is in `waiting` — handles new pushes mid-process too.
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const next = queueRef.current.find((it) => it.status === 'waiting')
        if (!next) break
        await uploadOne(next)
      }
    } finally {
      processingRef.current = false
      // Notify other tabs (Forecast) that the IDPEL list might have grown.
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('pln-idpel-refresh'))
      }
    }
  }

  // ── Drag/drop + file input — both feed the queue ────────────────────────────
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault()
    setDragActive(true)
  }
  const handleDragLeave = () => setDragActive(false)

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragActive(false)
    const files = Array.from(e.dataTransfer.files)
    if (files.length > 0) void enqueueFiles(files)
  }

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : []
    if (files.length > 0) void enqueueFiles(files)
    e.currentTarget.value = ''
  }

  // ── Aggregate queue stats for top-of-queue summary ──────────────────────────
  const activeCount = queue.filter((q) => q.status === 'uploading' || q.status === 'waiting').length
  const doneCount = queue.filter((q) => q.status === 'done').length
  const errorCount = queue.filter((q) => q.status === 'error').length

  // ════════════════════════════════════════════════════════════════════════
  // END UPLOAD LOGIC — start of render
  // ════════════════════════════════════════════════════════════════════════

  // Anomali per ULP — max value for the progress-bar normalization
  const maxAnomalyCount = perUlp.reduce((m, r) => Math.max(m, r.anomaly_count), 0) || 1

  return (
    <div className="space-y-8">
      {statsError && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm">
          <AlertCircle size={16} />
          <span>{statsError}</span>
        </div>
      )}

      {/* ── 1. ULP filter dropdown ─────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="ulp-filter" className="text-sm font-semibold text-slate-700">
          Filter ULP:
        </label>
        <select
          id="ulp-filter"
          value={selectedUlp}
          onChange={(e) => setSelectedUlp(e.target.value)}
          className="px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[14rem]"
        >
          <option value="">Semua ULP</option>
          {ULP_CODES.map((code) => (
            <option key={code} value={code}>{getULPName(code)}</option>
          ))}
        </select>
        {loadingStats && <Loader2 size={16} className="animate-spin text-slate-400" />}
        <span className="text-xs text-slate-400">
          {selectedUlp ? `Menampilkan data untuk ${getULPName(selectedUlp)}` : 'Menampilkan semua ULP'}
        </span>
      </div>

      {/* ── 2. Stat cards — 4 columns ──────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-white border-slate-200 shadow-sm hover:shadow-md transition-shadow">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-slate-900 flex items-center gap-2">
              <FileBox size={16} className="text-blue-600" />
              Total File Masuk
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-slate-900 tabular-nums">
              {loadingStats ? '…' : (topStats?.total_files ?? 0).toLocaleString('id-ID')}
            </div>
            <p className="text-xs text-slate-500 mt-1">File terupload</p>
          </CardContent>
        </Card>

        <Card className="bg-white border-slate-200 shadow-sm hover:shadow-md transition-shadow">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-slate-900 flex items-center gap-2">
              <Users size={16} className="text-emerald-600" />
              Total Pelanggan
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-slate-900 tabular-nums">
              {loadingStats ? '…' : (topStats?.total_idpel ?? 0).toLocaleString('id-ID')}
            </div>
            <p className="text-xs text-slate-500 mt-1">IDPEL unik</p>
          </CardContent>
        </Card>

        <Card className="bg-white border-slate-200 shadow-sm hover:shadow-md transition-shadow">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-slate-900 flex items-center gap-2">
              <AlertTriangle size={16} className="text-red-600" />
              Anomali Terdeteksi
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-red-600 tabular-nums">
              {loadingStats ? '…' : (topStats?.total_anomalies ?? 0).toLocaleString('id-ID')}
            </div>
            <p className="text-xs text-slate-500 mt-1">Pelanggan terflag</p>
          </CardContent>
        </Card>

        <Card className="bg-white border-slate-200 shadow-sm hover:shadow-md transition-shadow">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-slate-900 flex items-center gap-2">
              <Clock size={16} className="text-amber-500" />
              Upload Terakhir
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-sm font-bold text-slate-900">
              {loadingStats ? '…' : (topStats?.last_upload ?? '—')}
            </div>
            <p className="text-xs text-slate-500 mt-1">Tanggal & waktu</p>
          </CardContent>
        </Card>
      </div>

      {/* ── 3. Two-column grid: Anomali per ULP | File & Pelanggan per ULP ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* LEFT — Anomali per ULP */}
        <Card className="bg-white border-slate-200 shadow-sm">
          <CardHeader>
            <CardTitle className="text-slate-900 text-base">Anomali per ULP</CardTitle>
            <CardDescription className="text-slate-500 text-xs">
              Distribusi pelanggan anomali per Unit Layanan
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {perUlp.length === 0 && !loadingStats && (
              <p className="text-xs text-slate-400 text-center py-8">
                Belum ada data anomali untuk ditampilkan.
              </p>
            )}
            {perUlp.map((row) => {
              const color = getULPColor(row.unitup)
              const widthPct = Math.round((row.anomaly_count / maxAnomalyCount) * 100)
              return (
                <div key={row.unitup} className="flex items-center gap-3">
                  <div className="flex items-center gap-2 min-w-[10rem]">
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: color.text }} />
                    <span className="text-sm text-slate-700 truncate">{row.ulp_name}</span>
                  </div>
                  <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-300"
                      style={{ width: `${widthPct}%`, background: color.text }}
                    />
                  </div>
                  <span
                    className="text-xs font-semibold tabular-nums px-2 py-0.5 rounded-full min-w-[2.5rem] text-center"
                    style={{ color: color.text, background: color.bg, border: `1px solid ${color.border}` }}
                  >
                    {row.anomaly_count}
                  </span>
                </div>
              )
            })}
          </CardContent>
        </Card>

        {/* RIGHT — File & Pelanggan per ULP */}
        <Card className="bg-white border-slate-200 shadow-sm">
          <CardHeader>
            <CardTitle className="text-slate-900 text-base">File & Pelanggan per ULP</CardTitle>
            <CardDescription className="text-slate-500 text-xs">
              Cakupan unggahan per Unit Layanan
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {perUlp.length === 0 && !loadingStats && (
                <p className="text-xs text-slate-400 text-center py-8">
                  Belum ada upload tercatat.
                </p>
              )}
              {perUlp.map((row) => (
                <div
                  key={row.unitup}
                  className="flex items-center justify-between px-3 py-2 rounded-lg border border-slate-100 hover:bg-slate-50 transition-colors"
                >
                  <ULPBadge unitup={row.unitup} />
                  <div className="flex items-center gap-3 text-xs">
                    <span className="text-slate-500 tabular-nums">
                      <span className="font-semibold text-slate-700">{row.file_count}</span> file
                    </span>
                    <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 font-semibold tabular-nums">
                      {row.total_idpel} pelanggan
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── 4. Recent anomalies table — one row per anomalous IDPEL ────────── */}
      <Card className="bg-white border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle className="text-slate-900 text-base">Anomali Terbaru</CardTitle>
          <CardDescription className="text-slate-500 text-xs">
            Pelanggan yang terdeteksi anomali oleh model RandomForest
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loadingStats ? (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-12 bg-slate-100 rounded-lg animate-pulse" />
              ))}
            </div>
          ) : recentAnomalies.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-8">
              Tidak ada anomali terdeteksi dari seluruh pelanggan
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">
                      IDPEL
                    </th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">
                      ULP
                    </th>
                    <th className="px-3 py-2.5 text-center text-xs font-semibold text-slate-500 uppercase tracking-wide">
                      Severity
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {recentAnomalies.map((a) => (
                    <tr key={a.idpel} className="hover:bg-slate-50/80 transition-colors">
                      <td className="px-3 py-2.5 text-slate-900 font-mono">
                        {a.idpel}
                      </td>
                      <td className="px-3 py-2.5">
                        {a.unitup
                          ? <ULPBadge unitup={a.unitup} />
                          : <span className="text-slate-400 text-xs">—</span>}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <SeverityBadge level={a.severity} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ════════════════════════════════════════════════════════════════════
           Upload section — UNCHANGED from previous file (per instructions).
           Only the inner "File Requirements" bullet list was replaced with a
           single line per the task spec.
           ════════════════════════════════════════════════════════════════════ */}
      <Card className="bg-white border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle className="text-slate-900">Upload Data</CardTitle>
          <CardDescription className="text-slate-600">
            Drag and drop one or more energy consumption files — they upload sequentially
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`border-2 border-dashed rounded-lg p-12 text-center transition-all duration-500 cursor-pointer ${
              dragActive
                ? 'border-blue-400 bg-blue-50'
                : pulse === 'success'
                ? 'border-green-500 bg-green-50 animate-pulse'
                : pulse === 'error'
                ? 'border-red-500 bg-red-50 animate-pulse'
                : activeCount > 0
                ? 'border-blue-400 bg-blue-50'
                : 'border-slate-300 hover:border-slate-400 bg-slate-50'
            }`}
          >
            <Upload className={`mx-auto mb-3 ${dragActive ? 'text-blue-600' : 'text-slate-400'}`} size={32} />
            <p className="text-lg font-semibold text-slate-900 mb-1">
              {dragActive ? 'Drop files here' : 'Drag files here or click to select'}
            </p>
            <p className="text-sm text-slate-600 mb-4">CSV, XLS, XLSX formats — multiple files supported</p>
            <input
              type="file"
              multiple
              accept=".xls,.xlsx,.csv"
              onChange={handleFileInput}
              className="hidden"
              id="file-input"
            />
            <label
              htmlFor="file-input"
              className="inline-block px-6 py-2 bg-blue-600 text-white rounded-lg font-medium cursor-pointer hover:bg-blue-700 transition-colors"
            >
              Select Files
            </label>
          </div>

          {/* Single-line requirements note (replaces the old bullet list) */}
          <p className="mt-4 text-xs text-slate-500">
            Mendukung CSV, XLS, XLSX — multiple files diproses berurutan
          </p>

          {/* Upload Queue */}
          {queue.length > 0 && (
            <div className="mt-8">
              <h3 className="font-semibold text-slate-900 mb-4 flex items-center gap-2">
                <FileText size={16} className="text-slate-600" />
                Antrian Upload
                <span className="text-xs font-normal text-slate-500 tabular-nums">
                  {doneCount} selesai · {activeCount} aktif{errorCount > 0 ? ` · ${errorCount} gagal` : ''}
                </span>
              </h3>
              <div className="space-y-2">
                {queue.map((item) => (
                  <QueueRow key={item.id} item={item} />
                ))}
              </div>

              {/* All-done banner — pointer to where to view results */}
              {activeCount === 0 && doneCount > 0 && (
                <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                  <p className="text-sm text-blue-700 font-medium">
                    Upload selesai — data siap dianalisis
                  </p>
                  <p className="text-xs text-blue-500 mt-0.5">
                    Buka halaman Anomalies atau Forecast untuk melihat hasil
                  </p>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
