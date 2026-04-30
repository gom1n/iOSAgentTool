import { useState, useEffect, useCallback } from 'react'
import { MdBarChart, MdChecklist, MdSettings, MdChangeHistory, MdRefresh } from 'react-icons/md'
import './Sidebar.css'

const navItems = [
  { id: 'monitoring', label: '모니터링', icon: MdBarChart },
  { id: 'tasks',      label: '작업 관리', icon: MdChecklist },
  { id: 'settings',   label: '설정',      icon: MdSettings },
]

const USAGE_LABELS = { five_hour: '5시간', seven_day: '7일', daily: '일간', monthly: '월간' }
const SHOW_KEYS = ['five_hour', 'seven_day']

function formatResetsAt(isoStr, key) {
  if (!isoStr) return null
  const d = new Date(isoStr)
  if (key === 'five_hour') {
    const diffMs = d - Date.now()
    if (diffMs <= 0) return '곧 리셋'
    const totalMin = Math.floor(diffMs / 60000)
    const h = Math.floor(totalMin / 60)
    const m = totalMin % 60
    return h > 0 ? `${h}시간 ${m}분 후 리셋` : `${m}분 후 리셋`
  }
  // seven_day: 몇월 몇일 몇시
  const mo = d.getMonth() + 1
  const dd = d.getDate()
  const hh = d.getHours()
  return `${mo}/${dd} ${hh}시 리셋`
}

export default function Sidebar({ activePage, onNavigate }) {
  const [systemOk, setSystemOk] = useState(true)
  const [usage, setUsage] = useState(null)
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    const interval = setInterval(() => {
      const tasks = JSON.parse(localStorage.getItem('acc_tasks') || '[]')
      setSystemOk(!tasks.some(t => t.status === 'error'))
    }, 3000)
    return () => clearInterval(interval)
  }, [])

  const fetchUsage = useCallback(async () => {
    try {
      const r = await fetch('/api/claude-usage')
      const data = await r.json()
      if (data.ok) setUsage(data.usage)
    } catch { /* silent */ }
  }, [])

  useEffect(() => {
    fetchUsage()
    const id = setInterval(fetchUsage, 60000)
    return () => clearInterval(id)
  }, [fetchUsage])

  const handleRefresh = async () => {
    setRefreshing(true)
    await fetchUsage()
    setRefreshing(false)
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <MdChangeHistory className="logo-icon" />
        <span className="logo-text">Agent System</span>
      </div>

      <nav className="sidebar-nav">
        {navItems.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            className={`nav-item ${activePage === id ? 'active' : ''}`}
            onClick={() => onNavigate(id)}
          >
            <Icon className="nav-icon" />
            <span className="nav-label">{label}</span>
          </button>
        ))}
      </nav>

      <div className="sidebar-footer">
        {usage && (
          <div className="sidebar-usage">
            <div className="sidebar-usage-title">
              Claude 사용량
              <button className={`sidebar-usage-refresh ${refreshing ? 'spinning' : ''}`} onClick={handleRefresh} title="새로고침">
                <MdRefresh size={12} />
              </button>
            </div>
            {SHOW_KEYS.map(key => {
              const val = usage[key]
              if (!val || typeof val !== 'object') return null
              const pct = Math.round(val.utilization ?? 0)
              const resetLabel = formatResetsAt(val.resets_at, key)
              return (
                <div key={key} className="sidebar-usage-row">
                  <div className="sidebar-usage-top">
                    <div className="sidebar-usage-left">
                      <span className="sidebar-usage-label">{USAGE_LABELS[key] ?? key}</span>
                      {resetLabel && <span className="sidebar-usage-reset">{resetLabel}</span>}
                    </div>
                    <span className="sidebar-usage-pct">{pct}%</span>
                  </div>
                  <div className="sidebar-usage-bar-bg">
                    <div
                      className={`sidebar-usage-bar-fill ${pct >= 80 ? 'danger' : pct >= 50 ? 'warn' : ''}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        )}
        <div className={`system-status ${systemOk ? 'ok' : 'error'}`}>
          <span className="status-dot" />
          <span className="status-text">{systemOk ? '시스템 정상' : '오류 감지'}</span>
        </div>
      </div>
    </aside>
  )
}
