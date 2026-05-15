import { useState, useEffect } from 'react'
import TourOverlay from '../components/TourOverlay'
import usePageTour from '../hooks/usePageTour'
import TaskHistoryChart from '../components/TaskHistoryChart'
import TokenUsageChart from '../components/TokenUsageChart'
import './Monitoring.css'

const TOUR_STEPS = [
  { title: '모니터링', desc: '작업 현황을 실시간으로 확인하는 메인 화면입니다.\n3초마다 자동으로 갱신됩니다.', target: null },
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

function formatDuration(ms) {
  const totalMin = Math.round(ms / 60000)
  if (totalMin < 60) return `${totalMin}분`
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return m > 0 ? `${h}시간 ${m}분` : `${h}시간`
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

  const kpi = (() => {
    const done = tasks.filter(t => t.status === 'completed' && t.agentReports?.length > 0)
    if (done.length === 0) return null

    // 첫 시도 성공률: agentReports[0].success 필드가 있는 태스크 기준
    const firstTrySet  = done.filter(t => t.agentReports[0].success !== undefined)
    const firstSuccess = firstTrySet.length > 0
      ? Math.round(firstTrySet.filter(t => t.agentReports[0].success === true).length / firstTrySet.length * 100)
      : null

    // 재진행 비율: agentReports가 2개 이상인 태스크
    const retryRate = Math.round(done.filter(t => t.agentReports.length > 1).length / done.length * 100)

    // Xcode 빌드 성공률: iOS + buildSuccess 필드 있는 태스크의 마지막 report 기준
    const buildSet = done.filter(t => t.platform === 'iOS' && t.agentReports.some(r => r.buildSuccess !== undefined))
    const buildSuccessRate = buildSet.length > 0
      ? (() => {
          const lastReports = buildSet.map(t => [...t.agentReports].reverse().find(r => r.buildSuccess !== undefined))
          return Math.round(lastReports.filter(r => r.buildSuccess === true).length / lastReports.length * 100)
        })()
      : null

    // 평균 시도 횟수
    const avgTries = (done.reduce((s, t) => s + t.agentReports.length, 0) / done.length).toFixed(1)

    return { firstSuccess, retryRate, buildSuccessRate, avgTries, n: done.length, firstTryN: firstTrySet.length, buildN: buildSet.length }
  })()

  const recentTasks = [...tasks]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 5)

  return (
    <div className="monitoring">
      <div className="page-header">
        <h1 className="page-title">모니터링</h1>
        <div className="page-header-right">
          <div className="refresh-info">
            <span className="pulse-dot" />
            <span>Live</span>
          </div>
          <button className="page-tour-btn" onClick={startTour} title="페이지 투어">?</button>
        </div>
      </div>

      {/* History Chart */}
      <TaskHistoryChart />

      {/* Token Usage Chart */}
      <TokenUsageChart />

      {/* KPI Widget */}
      {kpi && (
        <div className="kpi-card">
          <div className="kpi-title">지표</div>
          <div className="kpi-grid">
            <div className="kpi-item">
              <div className={`kpi-value ${kpi.firstSuccess !== null ? (kpi.firstSuccess >= 70 ? 'good' : kpi.firstSuccess >= 40 ? 'warn' : 'bad') : 'na'}`}>
                {kpi.firstSuccess !== null ? `${kpi.firstSuccess}%` : '—'}
              </div>
              <div className="kpi-label">첫 시도 성공률</div>
              <div className="kpi-sub">{kpi.firstSuccess !== null ? `n=${kpi.firstTryN}` : '데이터 누적 중'}</div>
            </div>
            <div className="kpi-item">
              <div className={`kpi-value ${kpi.retryRate <= 20 ? 'good' : kpi.retryRate <= 50 ? 'warn' : 'bad'}`}>
                {kpi.retryRate}%
              </div>
              <div className="kpi-label">재진행 비율</div>
              <div className="kpi-sub">n={kpi.n}</div>
            </div>
            <div className="kpi-item">
              <div className={`kpi-value ${kpi.buildSuccessRate !== null ? (kpi.buildSuccessRate >= 80 ? 'good' : kpi.buildSuccessRate >= 50 ? 'warn' : 'bad') : 'na'}`}>
                {kpi.buildSuccessRate !== null ? `${kpi.buildSuccessRate}%` : '—'}
              </div>
              <div className="kpi-label">빌드 성공률</div>
              <div className="kpi-sub">{kpi.buildSuccessRate !== null ? `iOS n=${kpi.buildN}` : '데이터 누적 중'}</div>
            </div>
            <div className="kpi-item">
              <div className="kpi-value">{kpi.avgTries}</div>
              <div className="kpi-label">평균 시도 횟수</div>
              <div className="kpi-sub">n={kpi.n}</div>
            </div>
          </div>
        </div>
      )}

      {/* Efficiency Widget */}
      {(() => {
        const measured = tasks.filter(t => t.status === 'completed' && t.humanEstimateMinutes && t.started_at && t.updated_at)
        if (measured.length === 0) return null
        const totalAgentMs = measured.reduce((s, t) => s + (new Date(t.updated_at) - new Date(t.started_at || t.created_at)), 0)
        const totalHumanMs = measured.reduce((s, t) => s + t.humanEstimateMinutes * 60000, 0)
        const savedMs = totalHumanMs - totalAgentMs
        const avgRatio = totalAgentMs > 0 ? (totalHumanMs / totalAgentMs).toFixed(1) : '—'
        return (
          <div className="efficiency-card">
            <div className="efficiency-title">인간 대비 효율 분석 ({measured.length}건)</div>
            <div className="efficiency-stats">
              <div className="efficiency-stat">
                <div className="efficiency-stat-value highlight">{avgRatio}x</div>
                <div className="efficiency-stat-label">평균 속도</div>
              </div>
              <div className="efficiency-stat">
                <div className="efficiency-stat-value">{savedMs > 0 ? formatDuration(savedMs) : '-'}</div>
                <div className="efficiency-stat-label">총 절약 시간</div>
              </div>
              <div className="efficiency-stat">
                <div className="efficiency-stat-value">{formatDuration(totalAgentMs)}</div>
                <div className="efficiency-stat-label">에이전트 총 소요</div>
              </div>
              <div className="efficiency-stat">
                <div className="efficiency-stat-value">{formatDuration(totalHumanMs)}</div>
                <div className="efficiency-stat-label">인간 예상 총계</div>
              </div>
            </div>
          </div>
        )
      })()}

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
                        {(task.screenIds?.length ? task.screenIds : task.screenId ? [task.screenId] : []).map(id => (
                            <span key={id} className="screen-id">{id}</span>
                          ))}
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
