import { useState, useEffect, useRef } from 'react'
import { MdCircle, MdStop, MdRefresh, MdExpandMore, MdExpandLess } from 'react-icons/md'
import TourOverlay from '../components/TourOverlay'
import usePageTour from '../hooks/usePageTour'
import './Agents.css'

const TOUR_STEPS = [
  { title: '에이전트', desc: '등록된 프로젝트별로 Claude 에이전트가 할당됩니다.\n작업이 pending 상태가 되면 해당 에이전트가 자동으로 실행합니다.', target: null },
  { title: '에이전트 카드', desc: '각 카드는 하나의 프로젝트 에이전트를 나타냅니다.\n작업 중/대기 중 상태와 세션 정보를 실시간으로 확인합니다.', target: '[data-tour="agent-card"]' },
  { title: '세션 & 턴 정보', desc: 'Claude Code의 --resume 기능으로 세션이 유지됩니다.\n이전 대화 맥락을 기억해 연속적인 작업이 가능합니다.', target: '[data-tour="agent-session"]' },
  { title: '에이전트 출력', desc: '실행 중인 에이전트의 터미널 출력을 실시간으로 확인합니다.\nLIVE 표시가 있으면 현재 작동 중입니다.', target: '[data-tour="agent-log-toggle"]' },
  { title: '중단 & 세션 초기화', desc: '실행 중인 에이전트를 강제 중단하거나\n누적된 대화 세션을 초기화해 새 대화로 시작할 수 있습니다.', target: '[data-tour="agent-actions"]' },
]

function formatRelative(iso) {
  if (!iso) return ''
  const diff = Math.floor((Date.now() - new Date(iso)) / 1000)
  if (diff < 60) return `${diff}초 전 시작`
  if (diff < 3600) return `${Math.floor(diff / 60)}분 전 시작`
  return `${Math.floor(diff / 3600)}시간 전 시작`
}

function AgentCard({ project, onOpenTask }) {
  const [status, setStatus]       = useState(null)  // { running, pid, sessionId, turns, startTime, status }
  const [logs, setLogs]           = useState([])
  const [logsOpen, setLogsOpen]   = useState(false)
  const [resetting, setResetting] = useState(false)
  const [stopping, setStopping]   = useState(false)
  const logRef = useRef(null)

  // 상태 폴링
  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const r = await fetch('/api/agent-status')
        if (!r.ok) return
        const data = await r.json()
        const proj = (data.projects || []).find(p => p.key === project.label)
        if (proj) setStatus(proj)
      } catch {}
    }
    fetchStatus()
    const id = setInterval(fetchStatus, 3000)
    return () => clearInterval(id)
  }, [project.label])

  // 로그 폴링 (실행 중이고 로그 패널 열려있을 때)
  useEffect(() => {
    if (!status?.running) return
    const fetchLogs = async () => {
      try {
        const r = await fetch(`/api/agent-logs?project=${encodeURIComponent(project.label)}`)
        const data = await r.json()
        setLogs(data.logs || [])
      } catch {}
    }
    fetchLogs()
    const id = setInterval(fetchLogs, 2000)
    return () => clearInterval(id)
  }, [status?.running, project.label])

  // 로그 자동 스크롤
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [logs])

  // 에이전트 완료 시 마지막 로그 한 번 더 가져옴
  useEffect(() => {
    if (status && !status.running && logs.length === 0) {
      fetch(`/api/agent-logs?project=${encodeURIComponent(project.label)}`)
        .then(r => r.json())
        .then(data => { if (data.logs?.length) setLogs(data.logs) })
        .catch(() => {})
    }
  }, [status?.running])

  const tasks = JSON.parse(localStorage.getItem('acc_tasks') || '[]')
  const currentTask = tasks.find(t => t.projectKey === project.label && t.status === 'in-progress')
  const pendingCount = tasks.filter(t => t.projectKey === project.label && t.status === 'pending').length

  const handleStop = async () => {
    setStopping(true)
    try {
      await fetch('/api/stop-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project: project.label }),
      })
    } catch {}
    setStopping(false)
  }

  const handleSessionReset = async () => {
    if (!window.confirm(`[${project.label}] 세션을 초기화하면 다음 실행 시 새 대화로 시작됩니다.\n계속하시겠습니까?`)) return
    setResetting(true)
    try {
      const r = await fetch('/api/agent-session-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project: project.label }),
      })
      const data = await r.json()
      if (!data.ok) alert(data.error)
      else setStatus(s => s ? { ...s, sessionId: null, turns: 0 } : s)
    } catch {}
    setResetting(false)
  }

  const running = status?.running ?? false
  const sessionId = status?.sessionId

  return (
    <div className={`agent-detail-card ${running ? 'running' : ''}`} data-tour="agent-card">
      {/* 헤더 */}
      <div className="adc-header">
        <div className="adc-header-left">
          <span className="adc-label">{project.label}</span>
          <div className={`adc-status-badge ${running ? 'running' : 'idle'}`}>
            <MdCircle size={7} />
            <span>{running ? '작업 중' : '대기 중'}</span>
          </div>
          {pendingCount > 0 && !running && (
            <span className="adc-pending-badge">{pendingCount}개 대기</span>
          )}
        </div>
        <div className="adc-header-actions" data-tour="agent-actions">
          {running && (
            <button className="adc-btn danger" onClick={handleStop} disabled={stopping}>
              <MdStop size={14} />
              {stopping ? '중단 중...' : '중단'}
            </button>
          )}
          <button
            className="adc-btn ghost"
            onClick={handleSessionReset}
            disabled={resetting || running}
            title={running ? '실행 중에는 세션을 초기화할 수 없습니다' : '세션 초기화'}
          >
            <MdRefresh size={14} />
            세션 초기화
          </button>
        </div>
      </div>

      {/* 세션 정보 */}
      <div className="adc-session-row" data-tour="agent-session">
        {sessionId ? (
          <>
            <span className="adc-session-id">세션 {sessionId.slice(0, 8)}...</span>
            <span className="adc-session-sep">·</span>
            <span className="adc-session-turns">{status?.turns ?? 0}턴</span>
            {status?.startTime && running && (
              <><span className="adc-session-sep">·</span><span className="adc-session-time">{formatRelative(status.startTime)}</span></>
            )}
          </>
        ) : (
          <span className="adc-session-none">세션 없음 — 다음 실행 시 새 대화로 시작</span>
        )}
      </div>

      {/* 현재 작업 */}
      {currentTask && (
        <div className="adc-current-task" onClick={() => onOpenTask?.(currentTask)}>
          <span className="adc-task-label">진행 중</span>
          <span className="adc-task-title">{currentTask.title}</span>
          {currentTask.screenId && <span className="adc-task-screen">{currentTask.screenId}</span>}
        </div>
      )}

      {/* 로그 패널 */}
      {(running || logs.length > 0) && (
        <div className="adc-log-section">
          <button className="adc-log-toggle" data-tour="agent-log-toggle" onClick={() => setLogsOpen(v => !v)}>
            {logsOpen ? <MdExpandLess size={15} /> : <MdExpandMore size={15} />}
            <span>에이전트 출력</span>
            {running && <span className="adc-log-live-badge">LIVE</span>}
          </button>
          {logsOpen && (
            <pre className="adc-log-panel" ref={logRef}>
              {logs.length > 0 ? logs.join('\n') : '출력 대기 중...'}
            </pre>
          )}
        </div>
      )}

      {/* 경로 */}
      <div className="adc-path">{project.path}</div>
    </div>
  )
}

export default function Agents({ onOpenTask }) {
  const [projects, setProjects] = useState([])
  const { showTour, startTour, closeTour } = usePageTour('agents')

  useEffect(() => {
    const load = () => setProjects(JSON.parse(localStorage.getItem('acc_projects') || '[]'))
    load()
    const id = setInterval(load, 5000)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="agents-page">
      <div className="page-header">
        <h1 className="page-title">에이전트</h1>
        <div className="page-header-right">
          <div className="refresh-info">
            <span className="pulse-dot" />
            <span>Live</span>
          </div>
          <button className="page-tour-btn" onClick={startTour} title="페이지 투어">?</button>
        </div>
      </div>

      {projects.length === 0 ? (
        <div className="agents-empty">
          <p>등록된 프로젝트가 없습니다.</p>
          <p>설정 &gt; 프로젝트에서 iOS 프로젝트를 추가하세요.</p>
        </div>
      ) : (
        <div className="agents-grid">
          {projects.map(p => (
            <AgentCard key={p.label} project={p} onOpenTask={onOpenTask} />
          ))}
        </div>
      )}
      {showTour && <TourOverlay steps={TOUR_STEPS} onClose={closeTour} />}
    </div>
  )
}
