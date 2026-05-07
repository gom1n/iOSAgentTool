import { useState, useEffect, useCallback, useRef } from 'react'
import { MdBarChart, MdChecklist, MdSettings, MdChangeHistory, MdRefresh, MdSmartToy, MdRocketLaunch, MdAutoAwesome, MdPets, MdBolt, MdLocalFireDepartment, MdCelebration, MdEmojiEmotions } from 'react-icons/md'
import './Sidebar.css'

const navItems = [
  { id: 'monitoring', label: '모니터링', icon: MdBarChart },
  { id: 'tasks',      label: '작업 관리', icon: MdChecklist },
  { id: 'agents',     label: '에이전트', icon: MdSmartToy },
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

const LOGO_STORAGE_KEY = 'acc_logo_title'
const LOGO_ICON_KEY = 'acc_logo_icon'
const DEFAULT_TITLE = 'Agent System'
const DEFAULT_ICON = 'MdChangeHistory'

const ICON_OPTIONS = [
  { key: 'MdChangeHistory',       Icon: MdChangeHistory,       label: '기본' },
  { key: 'MdRocketLaunch',        Icon: MdRocketLaunch,        label: '로켓' },
  { key: 'MdAutoAwesome',         Icon: MdAutoAwesome,         label: '반짝이' },
  { key: 'MdPets',                Icon: MdPets,                label: '발바닥' },
  { key: 'MdBolt',                Icon: MdBolt,                label: '번개' },
  { key: 'MdLocalFireDepartment', Icon: MdLocalFireDepartment, label: '불꽃' },
  { key: 'MdSmartToy',            Icon: MdSmartToy,            label: '로봇' },
  { key: 'MdCelebration',         Icon: MdCelebration,         label: '파티' },
  { key: 'MdEmojiEmotions',       Icon: MdEmojiEmotions,       label: '이모지' },
]
const SIDEBAR_WIDTH_KEY = 'acc_sidebar_width'
const DEFAULT_WIDTH = 220
const MIN_WIDTH = 160
const MAX_WIDTH = 400

export default function Sidebar({ activePage, onNavigate, onStartTour }) {
  const [systemOk, setSystemOk] = useState(true)
  const [usage, setUsage] = useState(null)
  const [refreshing, setRefreshing] = useState(false)
  const [logoTitle, setLogoTitle] = useState(() => localStorage.getItem(LOGO_STORAGE_KEY) || DEFAULT_TITLE)
  const [logoIconKey, setLogoIconKey] = useState(() => localStorage.getItem(LOGO_ICON_KEY) || DEFAULT_ICON)
  const [editingLogo, setEditingLogo] = useState(false)
  const [showIconPicker, setShowIconPicker] = useState(false)
  const [logoInput, setLogoInput] = useState('')
  const logoInputRef = useRef(null)
  const clickTimerRef = useRef(null)

  const LogoIcon = ICON_OPTIONS.find(o => o.key === logoIconKey)?.Icon ?? MdChangeHistory

  const handleIconSelect = (key) => {
    setLogoIconKey(key)
    localStorage.setItem(LOGO_ICON_KEY, key)
    setShowIconPicker(false)
  }

  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = parseInt(localStorage.getItem(SIDEBAR_WIDTH_KEY))
    return isNaN(saved) ? DEFAULT_WIDTH : saved
  })
  const isResizing = useRef(false)
  const startX = useRef(0)
  const startWidth = useRef(0)
  const currentWidthRef = useRef(sidebarWidth)

  useEffect(() => { currentWidthRef.current = sidebarWidth }, [sidebarWidth])

  const handleResizerMouseDown = (e) => {
    isResizing.current = true
    startX.current = e.clientX
    startWidth.current = currentWidthRef.current
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    e.preventDefault()
  }

  useEffect(() => {
    const onMouseMove = (e) => {
      if (!isResizing.current) return
      const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth.current + e.clientX - startX.current))
      setSidebarWidth(newWidth)
    }
    const onMouseUp = () => {
      if (!isResizing.current) return
      isResizing.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      localStorage.setItem(SIDEBAR_WIDTH_KEY, String(currentWidthRef.current))
    }
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
    return () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }
  }, [])

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

  const handleLogoClick = () => {
    if (clickTimerRef.current) return
    clickTimerRef.current = setTimeout(() => {
      clickTimerRef.current = null
      onNavigate('monitoring')
      window.location.reload()
    }, 220)
  }

  const startLogoEdit = (e) => {
    e.stopPropagation()
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current)
      clickTimerRef.current = null
    }
    setLogoInput(logoTitle)
    setEditingLogo(true)
    setTimeout(() => logoInputRef.current?.select(), 0)
  }

  const saveLogo = () => {
    const trimmed = logoInput.trim() || DEFAULT_TITLE
    setLogoTitle(trimmed)
    localStorage.setItem(LOGO_STORAGE_KEY, trimmed)
    setEditingLogo(false)
  }

  const handleLogoKeyDown = (e) => {
    if (e.key === 'Enter') saveLogo()
    if (e.key === 'Escape') setEditingLogo(false)
  }

  return (
    <aside className="sidebar" style={{ width: sidebarWidth }}>
      <div className="sidebar-logo" onClick={handleLogoClick} style={{ cursor: 'pointer' }}>
        <div className="logo-icon-wrap" onClick={e => { e.stopPropagation(); setShowIconPicker(v => !v) }} title="아이콘 변경">
          <LogoIcon className="logo-icon" />
          {showIconPicker && (
            <div className="logo-icon-picker">
              {ICON_OPTIONS.map(({ key, Icon, label }) => (
                <button
                  key={key}
                  className={`logo-icon-option ${logoIconKey === key ? 'active' : ''}`}
                  onClick={e => { e.stopPropagation(); handleIconSelect(key) }}
                  title={label}
                >
                  <Icon size={18} />
                </button>
              ))}
            </div>
          )}
        </div>
        {editingLogo ? (
          <input
            ref={logoInputRef}
            className="logo-edit-input"
            value={logoInput}
            onChange={e => setLogoInput(e.target.value)}
            onBlur={saveLogo}
            onKeyDown={handleLogoKeyDown}
            onClick={e => e.stopPropagation()}
          />
        ) : (
          <span className="logo-text" onDoubleClick={startLogoEdit} title="더블클릭해서 이름 변경">{logoTitle}</span>
        )}
      </div>

      <nav className="sidebar-nav">
        {navItems.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            data-tour={`nav-${id}`}
            className={`nav-item ${activePage === id ? 'active' : ''}`}
            onClick={() => onNavigate(id)}
          >
            <Icon className="nav-icon" />
            <span className="nav-label">{label}</span>
          </button>
        ))}
      </nav>

      <div className="sidebar-footer" data-tour="sidebar-footer">
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
        <div className="sidebar-footer-bottom">
          <div className={`system-status ${systemOk ? 'ok' : 'error'}`}>
            <span className="status-dot" />
            <span className="status-text">{systemOk ? '시스템 정상' : '오류 감지'}</span>
          </div>
          <button className="tour-trigger-btn" onClick={onStartTour} title="투어 다시 보기">?</button>
        </div>
      </div>
      <div className="sidebar-resizer" onMouseDown={handleResizerMouseDown} />
    </aside>
  )
}
