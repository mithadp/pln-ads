'use client'

/**
 * Searchable IDPEL dropdown.
 *
 * Replaces the native <select> on Anomaly & Forecast tabs. Lets users filter
 * by IDPEL number OR human-readable ULP name simultaneously. Closes on
 * outside click or item selection. The list is rendered in the order the
 * backend returns it — caller controls sorting (newest-first by default).
 */

import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Search } from 'lucide-react'
import type { IDPELItem } from '@/types/anomaly'
import { ULP_MAP, getULPColor, getULPName } from '@/lib/ulpConfig'

interface IDPELDropdownProps {
  items: IDPELItem[]
  value: string
  onChange: (idpel: string) => void
  loading?: boolean
  placeholder?: string
}

export function IDPELDropdown({
  items,
  value,
  onChange,
  loading = false,
  placeholder,
}: IDPELDropdownProps) {
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)

  // Close on outside click. We attach a single document-level mousedown
  // listener and check whether the click landed inside our wrapper.
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as Element | null
      if (!target) return
      // Use both the ref AND the class fallback so this works even if React
      // hasn't attached the ref yet on first render.
      if (rootRef.current && rootRef.current.contains(target)) return
      if (target.closest('.idpel-dropdown')) return
      setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const filtered = items.filter((item) => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    const ulpName = (getULPName(item.unitup) ?? '').toLowerCase()
    return item.idpel.includes(search) || ulpName.includes(q)
  })

  const selectedItem = items.find((i) => i.idpel === value)
  const triggerLabel = selectedItem
    ? `${selectedItem.idpel}${
        selectedItem.unitup ? ' · ' + (ULP_MAP[selectedItem.unitup] ?? selectedItem.unitup) : ''
      }`
    : loading
      ? 'Memuat daftar...'
      : (placeholder ?? '-- Pilih IDPEL Pelanggan --')

  return (
    <div ref={rootRef} className="idpel-dropdown relative">
      {/* Trigger button — shows selected IDPEL */}
      <button
        type="button"
        onClick={() => !loading && setOpen(!open)}
        disabled={loading}
        className="w-full flex items-center justify-between px-3 py-2.5
                   bg-slate-50 border border-slate-200 rounded-lg text-sm
                   text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500
                   disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <span className="truncate">{triggerLabel}</span>
        <ChevronDown size={16} className="text-slate-400 flex-shrink-0 ml-2" />
      </button>

      {/* Dropdown panel */}
      {open && (
        <div
          className="absolute z-50 w-full mt-1 bg-white border border-slate-200
                     rounded-lg shadow-lg max-h-72 overflow-hidden flex flex-col"
        >
          {/* Search input inside dropdown */}
          <div className="p-2 border-b border-slate-100">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Cari IDPEL atau nama ULP..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                autoFocus
                className="w-full pl-8 pr-3 py-1.5 text-sm bg-slate-50 border
                           border-slate-200 rounded-md focus:outline-none focus:ring-1
                           focus:ring-blue-500"
              />
            </div>
          </div>

          {/* Scrollable list */}
          <div className="overflow-y-auto max-h-56">
            {filtered.length === 0 ? (
              <p className="px-3 py-4 text-sm text-slate-400 text-center">
                IDPEL tidak ditemukan
              </p>
            ) : (
              filtered.map((item) => (
                <button
                  key={item.idpel}
                  type="button"
                  onClick={() => {
                    onChange(item.idpel)
                    setOpen(false)
                    setSearch('')
                  }}
                  className={`w-full text-left px-3 py-2.5 text-sm hover:bg-slate-50
                              flex items-center justify-between transition-colors ${
                                value === item.idpel ? 'bg-blue-50 text-blue-700' : 'text-slate-900'
                              }`}
                >
                  <span className="font-mono">{item.idpel}</span>
                  {item.unitup && (
                    <span
                      className="text-xs"
                      style={{ color: getULPColor(item.unitup).text }}
                    >
                      {ULP_MAP[item.unitup] ?? item.unitup}
                    </span>
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
