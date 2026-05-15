'use client'

import { Menu, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface NavbarProps {
  sidebarOpen: boolean
  setSidebarOpen: (open: boolean) => void
  onLogout: () => void
}

export function Navbar({ sidebarOpen, setSidebarOpen, onLogout }: NavbarProps) {
  return (
    <nav className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between shadow-sm">
      <div className="flex items-center gap-4">
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="lg:hidden text-slate-900 hover:text-blue-600 transition-colors"
        >
          {sidebarOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
        <div className="flex items-center gap-3">
          <img 
            src="https://hebbkx1anhila5yf.public.blob.vercel-storage.com/Logo_PLN%20%28horisontal%29-9J0yhssP8pdYVBSzJ93xFTk0ZDk8dc.png" 
            alt="PLN Logo" 
            className="h-8 w-auto"
          />
        </div>
      </div>
      <Button
        onClick={onLogout}
        className="bg-slate-100 text-slate-900 hover:bg-slate-200 transition-colors font-medium"
      >
        Logout
      </Button>
    </nav>
  )
}
