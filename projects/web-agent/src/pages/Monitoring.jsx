import { useState, useEffect, Fragment } from 'react'
import {
  MdCheckCircle, MdHourglassEmpty, MdSync,
  MdInventory2, MdCircle, MdRadioButtonUnchecked,
} from 'react-icons/md'
import './Monitoring.css'

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

const PIPELINE_STAGES = ['대기', '진행', '완료']

function getStageIndex(status) {
  if (status === 'pending')     return 0
  if (status === 'in-progress') return 1
  if (status === 'completed')   return 2
  return 0
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

function Pipeline({ tasks, onOpenTask }) {
  const task = [...tasks]
    .sort((a, b) => new Date(b.updated_at ?? b.created_at) - new Date(a.updated_at ?? a.created_at))[0]

  if (!task) {
    return <div className="pipeline-empty">배정된 작업 없음</div>
  }

  const stageIdx = getStageIndex(task.status)

  return (
    <div className="pipeline-single" onClick={(e) => { e.stopPropagation(); onOpenTask?.(task) }} style={{ cursor: 'pointer' }}>
      <div className="pipeline-task-title">
        <span className="pipeline-title-text">[{task.title}]</span>
        <span className="pipeline-task-time">{formatRelative(task.updated_at ?? task.created_at)}</span>
      </div>
      <div className="pipeline-stages">
        {PIPELINE_STAGES.map((stage, i) => {
          const isDone           = i < stageIdx
          const isCurrent        = i === stageIdx
          const isCompletedFinal = isCurrent && task.status === 'completed'
          return (
            <Fragment key={stage}>
              {i > 0 && (
                <div className={`pipeline-connector ${isDone || isCompletedFinal ? 'done' : isCurrent ? 'active' : ''}`} />
              )}
              <div className={`pipeline-stage ${isDone || isCompletedFinal ? 'done' : isCurrent ? 'current' : 'pending'}`}>
                <div className="pipeline-stage-dot">
                  {(isDone || isCompletedFinal) && <MdCheckCircle size={14} />}
                  {isCurrent && !isCompletedFinal && (
                    task.status === 'in-progress'
                      ? <span className="pipeline-pulse" />
                      : <MdRadioButtonUnchecked size={14} />
                  )}
                  {!isDone && !isCurrent && <MdRadioButtonUnchecked size={14} />}
                </div>
                <span className="pipeline-stage-label">{stage}</span>
              </div>
            </Fragment>
          )
        })}
      </div>
    </div>
  )
}

async function launchAgent(type, e) {
  e?.stopPropagation()
  try {
    await fetch('http://localhost:3001/api/launch-agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type }),
    })
  } catch {
    alert('런처 서버가 실행되지 않았습니다.\n터미널에서: cd launcher && node server.js')
  }
}

async function stopIosAgent() {
  try {
    const r = await fetch('/api/stop-agent', { method: 'POST' })
    const data = await r.json()
    if (!data.ok) alert(`중단 실패: ${data.error}`)
  } catch {
    alert('워처 서버에 연결할 수 없습니다.\nios-watcher.js가 실행 중인지 확인하세요.')
  }
}

export default function Monitoring({ onOpenTask, onOpenPlatform }) {
  const [tasks, setTasks] = useState([])
  const [logs, setLogs]   = useState(INITIAL_LOGS)
  const [agentRunning, setAgentRunning] = useState(false)

  useEffect(() => {
    const refresh = () => setTasks(JSON.parse(localStorage.getItem('acc_tasks') || '[]'))
    refresh()
    const id = setInterval(refresh, 3000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    const checkStatus = async () => {
      try {
        const r = await fetch('/api/agent-status')
        if (r.ok) {
          const data = await r.json()
          setAgentRunning(data.running ?? false)
        }
      } catch {
        setAgentRunning(false)
      }
    }
    checkStatus()
    const id = setInterval(checkStatus, 3000)
    return () => clearInterval(id)
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

  const iosTasks = tasks.filter(t => t.platform === 'iOS')

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
        </div>
      </div>

      {/* Agent Cards */}
      <div className="agent-grid">
        {/* iOS 에이전트: 파이프라인 */}
        <div className="agent-card clickable" onClick={() => onOpenPlatform?.('iOS')}>
          <div className="agent-header">
            <div className="agent-info">
              <span className="agent-badge ios">iOS</span>
              <h3>iOS 에이전트</h3>
            </div>
            <div className="agent-header-right">
              {agentRunning && (
                <button
                  className="stop-agent-btn"
                  onClick={(e) => { e.stopPropagation(); stopIosAgent() }}
                  title="iOS 에이전트 강제 중단"
                >
                  중단
                </button>
              )}
              <div
                className={`agent-status ${agentRunning ? 'online' : 'idle'}`}
                onClick={(e) => launchAgent('ios', e)}
                title="클릭하여 iOS 에이전트 터미널 열기"
                style={{ cursor: 'pointer' }}
              >
                <MdCircle size={8} />
                <span>{agentRunning ? '작업 중' : '대기 중'}</span>
              </div>
            </div>
          </div>
          <Pipeline tasks={iosTasks} onOpenTask={(task) => { onOpenTask?.(task) }} />
          <div className="agent-role">실제 iOS 앱을 개발합니다.</div>
        </div>
      </div>

      {/* Stats Row */}
      <div className="stats-row">
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

      {/* Bottom: Recent Tasks + Activity Log */}
      <div className="bottom-grid">
        <div className="card recent-tasks">
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
                        <span className={`platform-tag ${task.platform?.toLowerCase()}`}>{task.platform}</span>
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

        <div className="card activity-log">
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
    </div>
  )
}
