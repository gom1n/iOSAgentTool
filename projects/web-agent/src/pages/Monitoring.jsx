import { useState, useEffect } from 'react'
import {
  MdCheckCircle, MdHourglassEmpty, MdSync, MdInventory2,
} from 'react-icons/md'
import TourOverlay from '../components/TourOverlay'
import usePageTour from '../hooks/usePageTour'
import TaskHistoryChart from '../components/TaskHistoryChart'
import './Monitoring.css'

const TOUR_STEPS = [
  { title: '모니터링', desc: '작업 현황을 실시간으로 확인하는 메인 화면입니다.\n3초마다 자동으로 갱신됩니다.', target: null },
  { title: '작업 현황 통계', desc: '전체·대기·진행·완료 작업 수를 한눈에 확인합니다.', target: '[data-tour="stats-row"]' },
  { title: '최근 작업', desc: '가장 최근에 추가된 작업 5개를 표시합니다.\n클릭하면 상세 화면으로 이동합니다.', target: '[data-tour="recent-tasks"]' },
  { title: '활동 로그', desc: '에이전트와 시스템의 활동 기록을 최신순으로 표시합니다.\n최대 30개까지 보관되며 초기화할 수 있습니다.', target: '[data-tour="activity-log"]' },
]

const INITIAL_LOGS = [
  { id: 1, time: new Date(Date.now() - 60000).toISOString(), agent: 'system', message: '공유 폴더 연결 확인', type: 'info' },
]

const MAX_LOGS = 30

function trimLogs(logs) {
  const seen = new Set()
  return [...logs]
    .sort((a, b) => new Date(b.time) - new Date(a.time))
    .filter(l => {
      if (seen.has(l.id)) return false
      seen.add(l.id)
      return true
    })
    .slice(0, MAX_LOGS)
}

function formatTime(iso) {
  const d = new Date(iso)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  const mo = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${mo}/${dd} ${hh}:${mm}:${ss}`
}

function formatRelative(iso) {
  const diff = Math.floor((Date.now() - new Date(iso)) / 1000)
  if (diff < 60) return `${diff}초 전`
  if (diff < 3600) return `${Math.floor(diff / 60)}분 전`
  return `${Math.floor(diff / 3600)}시간 전`
}


function loadProjectColorMap() {
  try {
    return Object.fromEntries(
      JSON.parse(localStorage.getItem('acc_projects') || '[]').map(p => [p.label, p.color || '#6b7280'])
    )
  } catch { return {} }
}

export default function Monitoring({ onOpenTask, onOpenPlatform }) {
  const [tasks, setTasks] = useState([])
  const [logs, setLogs]   = useState(INITIAL_LOGS)
  const [projectColors, setProjectColors] = useState(loadProjectColorMap)
  const { showTour, startTour, closeTour } = usePageTour('monitoring')

  useEffect(() => {
    const refresh = () => setTasks(JSON.parse(localStorage.getItem('acc_tasks') || '[]'))
    refresh()
    const id = setInterval(refresh, 3000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    const handler = () => setProjectColors(loadProjectColorMap())
    window.addEventListener('storage', handler)
    return () => window.removeEventListener('storage', handler)
  }, [])

  useEffect(() => {
    const storedLogs = JSON.parse(localStorage.getItem('acc_logs') || '[]')
    if (storedLogs.length) setLogs(trimLogs([...INITIAL_LOGS, ...storedLogs]))
    const handler = () => {
      const localLogs = JSON.parse(localStorage.getItem('acc_logs') || '[]')
      setLogs(trimLogs([...INITIAL_LOGS, ...localLogs]))
    }
    window.addEventListener('storage', handler)
    return () => window.removeEventListener('storage', handler)
  }, [])

  useEffect(() => {
    const fetchServerLogs = async () => {
      try {
        const r = await fetch('/api/activity-logs')
        const serverLogs = await r.json()
        const localLogs = JSON.parse(localStorage.getItem('acc_logs') || '[]')
        const combined = trimLogs([...INITIAL_LOGS, ...localLogs, ...serverLogs])
        setLogs(combined)
        const trimmedLocal = combined.filter(l => !INITIAL_LOGS.find(il => il.id === l.id) && !serverLogs.find(sl => sl.id === l.id))
        if (trimmedLocal.length < localLogs.length) {
          localStorage.setItem('acc_logs', JSON.stringify(trimmedLocal))
        }
      } catch {
        // 서버 연결 실패 시 로컬 로그만 표시
        const localLogs = JSON.parse(localStorage.getItem('acc_logs') || '[]')
        if (localLogs.length) setLogs(trimLogs([...INITIAL_LOGS, ...localLogs]))
      }
    }
    fetchServerLogs()
    const id = setInterval(fetchServerLogs, 3000)
    return () => clearInterval(id)
  }, [])

  const pending    = tasks.filter(t => t.status === 'pending').length
  const inProgress = tasks.filter(t => t.status === 'in-progress').length
  const completed  = tasks.filter(t => t.status === 'completed').length
  const total      = tasks.length

  const recentTasks = [...tasks]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 5)

  return (
    <div className="monitoring">
      <div className="page-header">
        <h1 className="page-title">모니터링</h1>
        <div className="refresh-info">
          <span className="pulse-dot" />
          <span>3초마다 자동 갱신</span>
          <button className="page-tour-btn" onClick={startTour} title="페이지 투어">?</button>
        </div>
      </div>

      {/* Stats Row */}
      <div className="stats-row" data-tour="stats-row">
        <div className="stat-card">
          <div className="stat-card-value">{total}</div>
          <div className="stat-card-label">전체 작업</div>
          <MdInventory2 className="stat-card-icon" />
        </div>
        <div className="stat-card pending-card">
          <div className="stat-card-value">{pending}</div>
          <div className="stat-card-label">대기 중</div>
          <MdHourglassEmpty className="stat-card-icon" />
        </div>
        <div className="stat-card inprogress-card">
          <div className="stat-card-value">{inProgress}</div>
          <div className="stat-card-label">진행 중</div>
          <MdSync className="stat-card-icon" />
        </div>
        <div className="stat-card completed-card">
          <div className="stat-card-value">{completed}</div>
          <div className="stat-card-label">완료</div>
          <MdCheckCircle className="stat-card-icon" />
        </div>
      </div>

      {/* History Chart */}
      <TaskHistoryChart />

      {/* Bottom: Recent Tasks + Activity Log */}
      <div className="bottom-grid">
        <div className="card recent-tasks" data-tour="recent-tasks">
          <div className="card-header"><h2>최근 작업</h2></div>
          {recentTasks.length === 0 ? (
            <div className="empty-state">
              <span>작업이 없습니다</span>
              <p>작업 관리에서 새 작업을 추가하세요</p>
            </div>
          ) : (
            <div className="task-list-mini">
              {recentTasks.map(task => (
                <div key={task.id} className="task-mini-item" onClick={() => onOpenTask?.(task)} style={{ cursor: 'pointer' }}>
                  <div className="task-mini-left">
                    <span className={`task-status-dot ${task.status}`}>
                      {task.status === 'pending' ? '대기' : task.status === 'in-progress' ? '진행' : '완료'}
                    </span>
                    <div className="task-mini-info">
                      <span className="task-mini-title">{task.title}</span>
                      <span className="task-mini-meta">
                        {task.projectKey && (() => {
                          const color = projectColors[task.projectKey] || '#6b7280'
                          return (
                            <span
                              className="project-key-badge"
                              style={{ background: color + '22', color, borderColor: color + '55' }}
                            >
                              {task.projectKey}
                            </span>
                          )
                        })()}
                        {task.screenId && <span className="screen-id">{task.screenId}</span>}
                      </span>
                    </div>
                  </div>
                  <span className="task-mini-time">{formatRelative(task.created_at)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card activity-log" data-tour="activity-log">
          <div className="card-header">
            <h2>활동 로그</h2>
            <button
              className="log-clear-btn"
              onClick={async () => {
                if (window.confirm('활동 로그를 모두 삭제하시겠습니까?')) {
                  localStorage.setItem('acc_logs', '[]')
                  await fetch('/api/activity-logs', { method: 'DELETE' }).catch(() => {})
                  setLogs(INITIAL_LOGS)
                }
              }}
            >
              초기화
            </button>
          </div>
          <p className="log-limit-notice">최신 순으로 최대 {MAX_LOGS}개까지 표시됩니다.</p>
          <div className="log-list">
            {logs.map(log => (
              <div key={log.id} className={`log-item ${log.type}`}>
                <span className="log-time">{formatTime(log.time)}</span>
                <span className={`log-agent ${log.agent}`}>[{log.agent?.toUpperCase()}]</span>
                <span className="log-message">{log.message}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      {showTour && <TourOverlay steps={TOUR_STEPS} onClose={closeTour} />}
    </div>
  )
}
