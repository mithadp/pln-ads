'use client'

import { BarChart3, AlertTriangle, TrendingUp, FileText } from 'lucide-react'

interface SidebarProps {
  activeTab: string
  setActiveTab: (tab: string) => void
  sidebarOpen: boolean
}

const tabs = [
  { id: 'dashboard', label: 'Dashboard', icon: BarChart3 },
  { id: 'anomalies', label: 'Anomalies', icon: AlertTriangle },
  { id: 'forecast', label: 'Forecast', icon: TrendingUp },
  { id: 'upload-logs', label: 'Upload Logs', icon: FileText },
]

export function Sidebar({ activeTab, setActiveTab, sidebarOpen }: SidebarProps) {
  return (
    <aside
      className={`${
        sidebarOpen ? 'translate-x-0' : '-translate-x-full'
      } lg:translate-x-0 fixed lg:relative w-64 h-screen bg-white border-r border-slate-200 transition-transform duration-300 z-40 flex flex-col p-6 gap-8 shadow-sm`}
    >
      <div className="space-y-2">
        {tabs.map((tab) => {
          const Icon = tab.icon
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg font-medium transition-all duration-200 ${
                activeTab === tab.id
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              <Icon size={20} className="transition-transform duration-300" />
              <span>{tab.label}</span>
            </button>
          )
        })}
      </div>
    </aside>
  )
}
