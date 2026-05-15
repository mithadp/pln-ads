'use client'

import { useState, useEffect } from 'react'
import axios from 'axios'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { AlertCircle, Inbox } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { IDPELDropdown } from '@/components/idpel-dropdown'
import { getULPColor, getULPName } from '@/lib/ulpConfig'
import type { IDPELItem } from '@/types/anomaly'

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

type Horizon = 3 | 6 | 9

interface ForecastPoint {
  date: string
  actual: number | null
  predicted: number | null
}

interface ModelMetrics {
  model: string
  mae: number
  mape: number
  r2: number
}

interface ForecastResponse {
  idpel: string | null
  unitup: string | null
  horizon: number
  chartData: ForecastPoint[]
  modelMetrics: ModelMetrics
}

const INDONESIAN_MONTH_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun',
  'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des',
]

/**
 * Format a period string to "Mei 2026". Handles the three formats that
 * appear in our pipeline:
 *   - "YYYY-MM"      → from older backend responses
 *   - "YYYY-MM-DD"   → ISO date prefix
 *   - "MM-YYYY"      → current backend response (new FastAPI shape)
 */
function formatMonthLabel(value: string): string {
  if (!value) return ''
  let monthIdx: number | null = null
  let year: string | null = null

  // "MM-YYYY" (e.g. "06-2026") — checked first because YYYY-MM also has '-'
  let m = value.match(/^(\d{1,2})-(\d{4})$/)
  if (m) {
    monthIdx = Number(m[1]) - 1
    year = m[2]
  } else {
    // "YYYY-MM" or "YYYY-MM-DD"
    m = value.match(/^(\d{4})-(\d{1,2})/)
    if (m) {
      year = m[1]
      monthIdx = Number(m[2]) - 1
    }
  }
  if (year == null || monthIdx == null || monthIdx < 0 || monthIdx > 11) return value
  return `${INDONESIAN_MONTH_SHORT[monthIdx]} ${year}`
}

const round1 = (n: number): number => Math.round(n * 10) / 10

export function ForecastTab() {
  const [idpelList, setIdpelList] = useState<IDPELItem[]>([])
  const [selectedIDPEL, setSelectedIDPEL] = useState<string>('')
  const [horizon, setHorizon] = useState<Horizon>(3)
  const [loadingList, setLoadingList] = useState(true)
  const [chartData, setChartData] = useState<ForecastPoint[]>([])
  const [unitup, setUnitup] = useState<string | null>(null)
  const [modelMetrics, setModelMetrics] = useState<ModelMetrics | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // ── Fetch IDPEL list (mount + on Dashboard signal) ──────────────────────────
  useEffect(() => {
    let cancelled = false
    const fetchList = async () => {
      setLoadingList(true)
      try {
        const res = await axios.get<IDPELItem[]>(`${API}/api/idpel-list`)
        if (cancelled) return
        const list = res.data ?? []
        setIdpelList(list)
        if (list.length > 0 && !selectedIDPEL) {
          setSelectedIDPEL(list[0].idpel)
        }
      } catch (err: unknown) {
        if (cancelled) return
        const msg = axios.isAxiosError(err)
          ? err.response?.data?.message ?? err.message
          : 'Gagal memuat daftar IDPEL'
        console.error('[Forecast] /api/idpel-list failed:', msg)
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Fetch forecast on IDPEL OR horizon change ───────────────────────────────
  useEffect(() => {
    if (!selectedIDPEL) return
    let cancelled = false
    setLoading(true)
    setError(null)

    const fetchForecast = async () => {
      try {
        const res = await axios.get<ForecastResponse>(
          `${API}/api/forecast?idpel=${selectedIDPEL}&horizon=${horizon}`
        )
        if (cancelled) return
        const raw = res.data.chartData ?? []

        // ── Bridge point: make the predicted line start exactly where the
        //    actual line ends. Without this, Recharts draws two disconnected
        //    segments because the last actual point has predicted=null and
        //    the first predicted point has actual=null.
        const data = raw.map((d) => ({ ...d }))   // shallow copy so we mutate safely
        const lastActual = [...data]
          .reverse()
          .find((d) => d.actual !== null && d.actual !== undefined)
        const firstPredIdx = data.findIndex(
          (d) => d.predicted !== null && d.predicted !== undefined
        )
        if (lastActual && firstPredIdx > 0) {
          const bridgeIdx = data.findIndex((d) => d.date === lastActual.date)
          if (bridgeIdx !== -1) {
            data[bridgeIdx] = { ...data[bridgeIdx], predicted: lastActual.actual }
          }
        }

        setChartData(data)
        setUnitup(res.data.unitup)
        setModelMetrics(res.data.modelMetrics)
        console.log(
          `[Forecast] ✅ idpel=${selectedIDPEL} horizon=${horizon} (${data.length} points, unitup=${res.data.unitup ?? '?'})`
        )
      } catch (err: unknown) {
        if (cancelled) return
        const msg = axios.isAxiosError(err)
          ? err.response?.data?.message ?? err.message
          : 'Gagal memuat data forecast'
        setError(msg)
        setChartData([])
        setUnitup(null)
        setModelMetrics(null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    fetchForecast()
    return () => { cancelled = true }
  }, [selectedIDPEL, horizon])

  // Aggregate stats — rounded to 1dp.
  const actuals = chartData.map((d) => d.actual).filter((v): v is number => v !== null)
  const preds = chartData.map((d) => d.predicted).filter((v): v is number => v !== null)
  const avg = (arr: number[]): string =>
    arr.length === 0 ? '—' : round1(arr.reduce((a, b) => a + b, 0) / arr.length).toString()
  const avgActual = avg(actuals)
  const avgPredicted = avg(preds)

  // Empty state: no IDPELs yet.
  if (!loadingList && idpelList.length === 0) {
    return (
      <div className="space-y-6">
        <Card className="bg-white border border-slate-200 shadow-sm rounded-xl border-t-2 border-t-blue-500">
          <CardContent className="flex flex-col items-center justify-center py-20 gap-3">
            <Inbox size={32} className="text-slate-400" />
            <p className="text-sm font-medium text-slate-700">Upload file terlebih dahulu</p>
            <p className="text-xs text-slate-500 max-w-xs text-center">
              Forecast hanya tersedia setelah ada data konsumsi yang diunggah lewat tab Dashboard.
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  const ulpColor = unitup ? getULPColor(unitup) : null
  const ulpName = unitup ? getULPName(unitup) : null

  return (
    <div className="space-y-6">
      <Card className="bg-white border border-slate-200 shadow-sm rounded-xl border-t-2 border-t-blue-500">
        <CardHeader>
          <CardTitle className="text-slate-900">Energy Consumption Forecast</CardTitle>
          <CardDescription>
            {selectedIDPEL ? (
              <span className="inline-flex items-center gap-2 flex-wrap text-xs text-slate-500">
                <span>
                  IDPEL: <span className="font-mono font-medium text-slate-700">{selectedIDPEL}</span>
                </span>
                {ulpColor && ulpName && (
                  <span
                    className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold border"
                    style={{ color: ulpColor.text, backgroundColor: ulpColor.bg, borderColor: ulpColor.border }}
                  >
                    <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: ulpColor.text }} />
                    {ulpName}
                  </span>
                )}
                <span>· Prediksi <span className="font-semibold text-slate-700">{horizon} bulan</span> ke depan</span>
              </span>
            ) : (
              'Predicted vs. Actual consumption trends per customer'
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {error && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm">
              <AlertCircle size={16} />
              <span>{error}</span>
            </div>
          )}

          {/* Selector row — 2 columns */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-5">
            {/* IDPEL — searchable dropdown (filters by IDPEL or ULP name) */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                IDPEL Pelanggan
              </label>
              <IDPELDropdown
                items={idpelList}
                value={selectedIDPEL}
                onChange={setSelectedIDPEL}
                loading={loadingList}
                placeholder={idpelList.length === 0 ? 'Upload file terlebih dahulu' : undefined}
              />
              {!loadingList && (
                <p className="text-xs text-slate-400 mt-1">
                  {idpelList.length} pelanggan tersedia · diurutkan terbaru di atas
                </p>
              )}
            </div>

            {/* Horizon */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Horizon Forecast
              </label>
              <Select
                value={String(horizon)}
                onValueChange={(v) => setHorizon(Number(v) as Horizon)}
              >
                <SelectTrigger className="bg-slate-50 border-slate-200">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="3">3 Bulan ke Depan</SelectItem>
                  <SelectItem value="6">6 Bulan ke Depan</SelectItem>
                  <SelectItem value="9">9 Bulan ke Depan</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-slate-400 mt-1">
                Model menggunakan riwayat upload sebagai input · Prophet MAE 0.9 kWh
              </p>
            </div>
          </div>

          {/* Chart */}
          <div className="w-full h-80 bg-white rounded-lg p-4 border border-slate-200">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" opacity={0.3} />
                <XAxis
                  dataKey="date"
                  stroke="#64748b"
                  style={{ fontSize: '12px' }}
                  tickFormatter={formatMonthLabel}
                />
                <YAxis
                  stroke="#64748b"
                  style={{ fontSize: '12px' }}
                  label={{ value: 'kWh', angle: -90, position: 'insideLeft' }}
                  tickFormatter={(v: number) => v.toLocaleString('id-ID')}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#ffffff',
                    border: '1px solid #e2e8f0',
                    borderRadius: '8px',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                  }}
                  labelStyle={{ color: '#1e293b' }}
                  labelFormatter={(label: string) => formatMonthLabel(label)}
                  formatter={(value: number | string | Array<number | string>) => {
                    if (value == null) return 'N/A'
                    const n = Array.isArray(value) ? Number(value[0]) : Number(value)
                    return Number.isFinite(n) ? `${n.toLocaleString('id-ID')} kWh` : 'N/A'
                  }}
                />
                <Legend wrapperStyle={{ color: '#1e293b' }} />
                <Line
                  name="Actual"
                  type="monotone"
                  dataKey="actual"
                  stroke="#2563EB"
                  strokeWidth={2}
                  connectNulls={false}
                  activeDot={{ r: 6 }}
                  isAnimationActive={true}
                  dot={(props: { cx?: number; cy?: number; index?: number; payload?: ForecastPoint }) => {
                    const { cx, cy, index, payload } = props
                    if (cx == null || cy == null || payload == null) {
                      return <g key={index ?? 'na'} />
                    }
                    // The handoff dot is the row that carries BOTH a real
                    // actual and the bridge-injected predicted value.
                    const isHandoff =
                      payload.actual !== null &&
                      payload.actual !== undefined &&
                      payload.predicted !== null &&
                      payload.predicted !== undefined
                    return (
                      <circle
                        key={index ?? 'dot'}
                        cx={cx}
                        cy={cy}
                        r={isHandoff ? 5 : 3}
                        fill={isHandoff ? '#F59E0B' : '#2563EB'}
                        stroke="#fff"
                        strokeWidth={isHandoff ? 2 : 1}
                      />
                    )
                  }}
                />
                <Line
                  name="Predicted"
                  type="monotone"
                  dataKey="predicted"
                  stroke="#F59E0B"
                  strokeWidth={2}
                  strokeDasharray="6 3"
                  dot={{ r: 3, fill: '#F59E0B', stroke: '#fff', strokeWidth: 1.5 }}
                  activeDot={{ r: 6 }}
                  connectNulls={false}
                  isAnimationActive={true}
                />
              </LineChart>
            </ResponsiveContainer>
            {loading && (
              <p className="text-xs text-slate-500 text-center mt-2">Memuat forecast…</p>
            )}
          </div>

          {/* Statistics */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
              <p className="text-xs font-medium text-blue-600 mb-1">Average Actual</p>
              <p className="text-2xl font-bold text-blue-700 tabular-nums">{avgActual} kWh</p>
              <p className="text-xs text-blue-400 mt-1">Across historical data</p>
            </div>
            <div className="bg-orange-50 border border-orange-100 rounded-xl p-4">
              <p className="text-xs font-medium text-orange-600 mb-1">Average Predicted</p>
              <p className="text-2xl font-bold text-orange-700 tabular-nums">{avgPredicted} kWh</p>
              <p className="text-xs text-orange-400 mt-1">Next {horizon} months</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
