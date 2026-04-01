import { Link, useLocation } from 'react-router-dom'
import { useAppStore } from '../stores/appStore'

const NAV_ITEMS = [
  { path: '/', label: 'ダッシュボード', icon: '⊞' },
  { path: '/templates', label: 'テンプレート', icon: '⊟' },
  { path: '/settings', label: '設定', icon: '⊡' },
]

export default function Layout({ children }) {
  const location = useLocation()
  const toasts = useAppStore((s) => s.toasts)

  return (
    <div className="min-h-screen bg-gray-950 flex">
      {/* Sidebar */}
      <nav className="w-56 bg-gray-900 border-r border-gray-800 flex flex-col fixed h-full">
        <div className="p-4 border-b border-gray-800">
          <h1 className="text-lg font-bold text-white tracking-tight">VoiceScope</h1>
          <p className="text-xs text-gray-500 mt-0.5">音声文字起こし & AI要約</p>
        </div>
        <div className="flex-1 py-2">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className={`flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                location.pathname === item.path
                  ? 'bg-gray-800 text-white border-r-2 border-blue-500'
                  : 'text-gray-400 hover:text-white hover:bg-gray-800/50'
              }`}
            >
              <span className="text-base">{item.icon}</span>
              {item.label}
            </Link>
          ))}
        </div>
      </nav>

      {/* Main content */}
      <main className="flex-1 ml-56">
        {children}
      </main>

      {/* Toast notifications */}
      <div className="fixed bottom-4 right-4 flex flex-col gap-2 z-50">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`px-4 py-3 rounded-lg shadow-lg text-sm max-w-sm animate-in slide-in-from-right ${
              toast.type === 'error' ? 'bg-red-900/90 text-red-100' :
              toast.type === 'success' ? 'bg-green-900/90 text-green-100' :
              'bg-gray-800/90 text-gray-100'
            }`}
          >
            {toast.message}
          </div>
        ))}
      </div>
    </div>
  )
}
