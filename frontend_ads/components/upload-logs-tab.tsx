'use client'

import { useState, useEffect, useMemo } from 'react'
import axios from 'axios'
import { Search, ChevronLeft, ChevronRight, RefreshCw, AlertCircle } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { getApiBase } from '@/lib/api'

const API = getApiBase()

interface UploadLog {
  id: string
  user_id: string | null
  file_name: string
  file_size_bytes: number | null
  status: 'processing' | 'completed' | 'failed' | string
  rows_total: number | null
  rows_success: number | null
  error_message: string | null
  created_at: string
}

const formatBytes = (n: number | null): string => {
  if (n == null) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

const formatDate = (iso: string): string => {
  try {
    const d = new Date(iso)
    return d.toLocaleString('id-ID', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

const getStatusColor = (status: string): string => {
  switch (status.toLowerCase()) {
    case 'completed':
      return 'bg-green-100 text-green-800 border-green-200'
    case 'processing':
      return 'bg-yellow-100 text-yellow-800 border-yellow-200'
    case 'failed':
      return 'bg-red-100 text-red-800 border-red-200'
    default:
      return 'bg-slate-100 text-slate-800 border-slate-200'
  }
}

const formatStatus = (status: string): string =>
  status.charAt(0).toUpperCase() + status.slice(1).toLowerCase()

export function UploadLogsTab() {
  const [logs, setLogs] = useState<UploadLog[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const itemsPerPage = 10

  useEffect(() => {
    const fetchLogs = async () => {
      setLoading(true)
      setFetchError(null)
      try {
        const res = await axios.get<UploadLog[]>(`${API}/api/upload-logs`)
        setLogs(res.data ?? [])
        console.log(`[UploadLogs] ✅ API Fetch Success /api/upload-logs (${res.data?.length ?? 0} records)`)
      } catch (err: any) {
        console.error('[UploadLogs] /api/upload-logs failed:', err?.message)
        setFetchError('Data Unavailable — backend offline on port 3001')
        setLogs([])
      } finally {
        setLoading(false)
      }
    }
    fetchLogs()
  }, [])

  const filteredLogs = useMemo(
    () =>
      logs.filter((log) =>
        log.file_name.toLowerCase().includes(searchTerm.toLowerCase())
      ),
    [logs, searchTerm]
  )

  const totalPages = Math.max(1, Math.ceil(filteredLogs.length / itemsPerPage))
  const paginatedLogs = useMemo(
    () => filteredLogs.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage),
    [filteredLogs, currentPage]
  )

  if (loading) {
    return (
      <Card className="bg-white border-slate-200 shadow-sm">
        <CardContent className="flex items-center justify-center py-20">
          <div className="flex flex-col items-center gap-3 text-slate-500">
            <RefreshCw className="animate-spin" size={28} />
            <p className="text-sm">Loading upload history…</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <Card className="bg-white border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle className="text-slate-900">Upload File Logs</CardTitle>
          <CardDescription className="text-slate-600">
            View all uploaded files and their processing status
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {fetchError && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm">
              <AlertCircle size={16} />
              <span>{fetchError}</span>
            </div>
          )}

          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400" size={18} />
            <Input
              placeholder="Search by file name..."
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value)
                setCurrentPage(1)
              }}
              className="pl-10 bg-slate-50 border-slate-300 text-slate-900 placeholder:text-slate-400"
            />
          </div>

          {logs.length === 0 && !fetchError && (
            <div className="text-center py-16 text-slate-400 text-sm">
              No uploads yet. Upload a file from the Dashboard tab to get started.
            </div>
          )}

          {logs.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-900">File Name</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-900">Uploaded</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-slate-900">Size</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-slate-900">Rows</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-slate-900">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedLogs.map((log) => (
                    <tr key={log.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3 text-sm text-slate-900 font-medium" title={log.error_message ?? ''}>
                        {log.file_name}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-600">{formatDate(log.created_at)}</td>
                      <td className="px-4 py-3 text-sm text-slate-600 text-right">{formatBytes(log.file_size_bytes)}</td>
                      <td className="px-4 py-3 text-sm text-slate-600 text-right">
                        {log.rows_success != null && log.rows_total != null
                          ? `${log.rows_success} / ${log.rows_total}`
                          : '—'}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span
                          className={`px-3 py-1 rounded-full text-xs font-semibold border ${getStatusColor(log.status)}`}
                        >
                          {formatStatus(log.status)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-4">
              <p className="text-sm text-slate-600">
                Showing {(currentPage - 1) * itemsPerPage + 1} to{' '}
                {Math.min(currentPage * itemsPerPage, filteredLogs.length)} of {filteredLogs.length}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="p-2 hover:bg-slate-100 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronLeft size={18} className="text-slate-600" />
                </button>
                {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                  <button
                    key={page}
                    onClick={() => setCurrentPage(page)}
                    className={`px-3 py-1 rounded-lg text-sm font-medium transition-colors ${
                      currentPage === page
                        ? 'bg-blue-600 text-white'
                        : 'hover:bg-slate-100 text-slate-900'
                    }`}
                  >
                    {page}
                  </button>
                ))}
                <button
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="p-2 hover:bg-slate-100 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronRight size={18} className="text-slate-600" />
                </button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
