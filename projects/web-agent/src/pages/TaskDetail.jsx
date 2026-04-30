import { useState, useEffect, useRef, Fragment } from 'react'
import {
  MdArrowBack, MdCheckCircle, MdRadioButtonUnchecked,
  MdAdd,
} from 'react-icons/md'
import './TaskDetail.css'

const STAGES = ['대기', '진행', '완료']

function getStageIndex(status) {
  if (status === 'pending')     return 0
  if (status === 'in-progress') return 1
  if (status === 'completed')   return 2
  return 0
}

function saveTasks(tasks) {
  localStorage.setItem('acc_tasks', JSON.stringify(tasks))
}

function addLog(taskId, message, type = 'info', agent = 'web') {
  const logs = JSON.parse(localStorage.getItem('acc_logs') || '[]')
  logs.push({ id: Date.now(), time: new Date().toISOString(), agent, message, type, taskId })
  localStorage.setItem('acc_logs', JSON.stringify(logs.slice(-200)))
}

async function syncQ(method, task) {
  const url = method === 'POST' ? '/api/task-queue' : `/api/task-queue/${task.id}`
  try {
    await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(task) })
  } catch (e) {
    console.warn('[task-sync] 실패:', e)
  }
}

function fmtTokens(n) {
  if (!n) return '0'
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
}

function AgentReportItem({ report, index, defaultOpen }) {
  const [open, setOpen] = useState(defaultOpen)
  const date = report.completedAt ? new Date(report.completedAt).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''
  const tu = report.tokenUsage
  const totalTk = tu ? (tu.input_tokens || 0) + (tu.output_tokens || 0) : null
  return (
    <div className="agent-report-item">
      <button className="agent-report-item-toggle" onClick={() => setOpen(v => !v)}>
        <span className="agent-report-item-num">#{index}</span>
        <span className="agent-report-item-date">{date}</span>
        {tu && <span className="agent-report-token-badge">{fmtTokens(totalTk)} tokens</span>}
        <span className="agent-report-item-chevron">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <>
          {tu && (
            <div className="agent-report-token-detail">
              <span>입력 {fmtTokens(tu.input_tokens)}</span>
              <span className="agent-report-token-sep">·</span>
              <span>출력 {fmtTokens(tu.output_tokens)}</span>
              {tu.cache_read_input_tokens > 0 && <><span className="agent-report-token-sep">·</span><span>캐시 {fmtTokens(tu.cache_read_input_tokens)}</span></>}
              {tu.total_cost_usd != null && <><span className="agent-report-token-sep">·</span><span>${tu.total_cost_usd.toFixed(4)}</span></>}
            </div>
          )}
          <pre className="agent-report-body">{report.summary}</pre>
        </>
      )}
    </div>
  )
}

export default function TaskDetail({ task: initialTask, onBack, onTaskUpdate }) {
  const [task, setTask]               = useState(initialTask)
  const [newReq, setNewReq]           = useState('')
  const [statusUpdating, setStatusUpdating] = useState(false)

  // Xcode 빌드
  const [buildSchemes, setBuildSchemes]           = useState([])
  const [selectedSchemeIdx, setSelectedSchemeIdx] = useState(0)
  const [buildStatus, setBuildStatus]             = useState('idle')
  const [buildLogs, setBuildLogs]                 = useState([])
  const buildLogRef = useRef(null)

  // 프로젝트 scheme 로드
  useEffect(() => {
    if (!task.projectKey) return
    const projects = JSON.parse(localStorage.getItem('acc_projects') || '[]')
    const proj = projects.find(p => p.label === task.projectKey)
    if (proj) {
      setBuildSchemes(proj.schemes || [])
      setSelectedSchemeIdx(0)
    }
  }, [task.projectKey])

  // 빌드 로그 폴링
  useEffect(() => {
    if (buildStatus !== 'running') return
    const id = setInterval(async () => {
      try {
        const r = await fetch('/api/xcode-build/logs')
        const data = await r.json()
        setBuildLogs(data.logs || [])
        if (data.status !== 'running') setBuildStatus(data.status)
      } catch {}
    }, 2000)
    return () => clearInterval(id)
  }, [buildStatus])

  // 빌드 로그 자동 스크롤
  useEffect(() => {
    if (buildLogRef.current) buildLogRef.current.scrollTop = buildLogRef.current.scrollHeight
  }, [buildLogs])

  // 작업 폴링
  useEffect(() => {
    const id = setInterval(() => {
      const all = JSON.parse(localStorage.getItem('acc_tasks') || '[]')
      const updated = all.find(t => t.id === task.id)
      if (updated && JSON.stringify(updated) !== JSON.stringify(task)) {
        setTask(updated)
        onTaskUpdate?.(updated)
      }
    }, 3000)
    return () => clearInterval(id)
  }, [task])

  const updateTask = (patch) => {
    const all = JSON.parse(localStorage.getItem('acc_tasks') || '[]')
    const updated = all.map(t => t.id === task.id ? { ...t, ...patch, updated_at: new Date().toISOString() } : t)
    saveTasks(updated)
    const next = { ...task, ...patch, updated_at: new Date().toISOString() }
    setTask(next)
    onTaskUpdate?.(next)
  }

  const handleStatusChange = (status) => {
    setStatusUpdating(true)
    updateTask({ status })
    addLog(task.id, `상태 변경: ${task.title} → ${status === 'pending' ? '대기' : status === 'in-progress' ? '진행' : '완료'}`,
      status === 'completed' ? 'success' : 'info')
    syncQ('PATCH', { ...task, status, updated_at: new Date().toISOString() })
    setTimeout(() => setStatusUpdating(false), 400)
  }

  const handleAddRequirement = () => {
    if (!newReq.trim()) return
    const reqs = [...(Array.isArray(task.requirements) ? task.requirements : []), newReq.trim()]
    const statusPatch = task.status === 'completed' ? { status: 'pending' } : {}
    updateTask({ requirements: reqs, ...statusPatch })
    addLog(task.id, `추가 요구사항: "${newReq.trim()}"${statusPatch.status ? ' → 재작업 대기 중' : ''}`, 'info')
    if (statusPatch.status) {
      const next = { ...task, requirements: reqs, status: 'pending', updated_at: new Date().toISOString() }
      syncQ('PATCH', next)
    }
    setNewReq('')
  }

  const handleRemoveRequirement = (idx) => {
    const reqs = task.requirements.filter((_, i) => i !== idx)
    updateTask({ requirements: reqs })
  }

  const handleBuild = async () => {
    const s = buildSchemes[selectedSchemeIdx]
    if (!task.projectPath || !s?.name) return
    setBuildStatus('running')
    setBuildLogs([])
    try {
      await fetch('/api/xcode-build', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectPath: task.projectPath, scheme: s.name, destination: s.destination, configuration: s.configuration }),
      })
    } catch {
      setBuildStatus('failed')
    }
  }

  const handleBuildStop = async () => {
    await fetch('/api/xcode-build/stop', { method: 'POST' }).catch(() => {})
    setBuildStatus('idle')
  }

  const stageIdx = getStageIndex(task.status)

  return (
    <div className="task-detail">
      {/* Header */}
      <div className="detail-header">
        <button className="back-btn" onClick={onBack}>
          <MdArrowBack size={18} />
          <span>뒤로</span>
        </button>
        <div className="detail-title-wrap">
          <div className="detail-title-row">
            <span className={`platform-badge ${task.platform?.toLowerCase()}`}>{task.platform}</span>
            <h1 className="detail-title">{task.title}</h1>
          </div>
          {task.screenId && <span className="detail-screen-id">{task.screenId}</span>}
        </div>
        <div className="detail-status-wrap">
          <select
            className={`status-select status-${task.status}`}
            value={task.status}
            onChange={e => handleStatusChange(e.target.value)}
            disabled={statusUpdating}
          >
            <option value="pending">대기</option>
            <option value="in-progress">진행 중</option>
            <option value="completed">완료</option>
          </select>
        </div>
      </div>

      {/* Pipeline */}
      <div className="detail-pipeline">
        {STAGES.map((stage, i) => {
          const isDone           = i < stageIdx
          const isCurrent        = i === stageIdx
          const isCompletedFinal = isCurrent && task.status === 'completed'
          return (
            <Fragment key={stage}>
              {i > 0 && <div className={`dp-connector ${isDone || isCompletedFinal ? 'done' : isCurrent ? 'active' : ''}`} />}
              <button
                className={`dp-stage ${isDone || isCompletedFinal ? 'done' : isCurrent ? 'current' : 'idle'}`}
                onClick={() => handleStatusChange(['pending', 'in-progress', 'completed'][i])}
              >
                <div className="dp-dot">
                  {(isDone || isCompletedFinal) && <MdCheckCircle size={16} />}
                  {isCurrent && !isCompletedFinal && (
                    task.status === 'in-progress'
                      ? <span className="pipeline-pulse" />
                      : <MdRadioButtonUnchecked size={16} />
                  )}
                  {!isDone && !isCurrent && <MdRadioButtonUnchecked size={16} />}
                </div>
                <span className="dp-label">{stage}</span>
              </button>
            </Fragment>
          )
        })}
      </div>

      {/* Main Body */}
      <div className="detail-body">
          {task.description && (
            <div className="detail-section">
              <h3 className="section-title">설명</h3>
              <p className="detail-desc">{task.description}</p>
            </div>
          )}

          <div className="detail-section">
            <h3 className="section-title">정보</h3>
            <div className="detail-meta-list">
              <div className="detail-meta-item">
                <span className="meta-key">우선순위</span>
                <span className={`priority-badge priority-${task.priority === '높음' ? 'high' : task.priority === '낮음' ? 'low' : 'mid'}`}>
                  {task.priority || '중간'}
                </span>
              </div>
              {task.projectKey && (
                <div className="detail-meta-item">
                  <span className="meta-key">서비스</span>
                  <span className="meta-val">{task.projectKey}</span>
                </div>
              )}
              <div className="detail-meta-item">
                <span className="meta-key">생성일</span>
                <span className="meta-val">{new Date(task.created_at).toLocaleString('ko-KR')}</span>
              </div>
              {task.updated_at && (
                <div className="detail-meta-item">
                  <span className="meta-key">수정일</span>
                  <span className="meta-val">{new Date(task.updated_at).toLocaleString('ko-KR')}</span>
                </div>
              )}
            </div>
          </div>

          <div className="detail-section">
            <h3 className="section-title">요구사항</h3>
            {Array.isArray(task.requirements) && task.requirements.length > 0 ? (
              <ul className="req-list">
                {task.requirements.map((req, i) => (
                  <li key={i} className="req-item">
                    <MdCheckCircle size={14} className="req-check" />
                    <span>{req}</span>
                    <button className="req-remove" onClick={() => handleRemoveRequirement(i)}>×</button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="no-req">요구사항 없음</p>
            )}
            <div className="add-req-row">
              <input
                type="text"
                className="add-req-input"
                placeholder="추가 요구사항 입력..."
                value={newReq}
                onChange={e => setNewReq(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAddRequirement()}
              />
              <button className="add-req-btn" onClick={handleAddRequirement} disabled={!newReq.trim()}>
                <MdAdd size={16} />
                추가
              </button>
            </div>
          </div>
      </div>

      {/* Agent Reports */}
      {((task.agentReports?.length > 0) || task.agentSummary) && (() => {
        const reports = task.agentReports?.length > 0
          ? [...task.agentReports].reverse()
          : [{ summary: task.agentSummary, completedAt: task.updated_at || task.created_at }]
        return (
          <div className="agent-report-wrap">
            <div className="agent-report-list-header">
              <span className="agent-report-title">🤖 에이전트 리포트</span>
              <span className="agent-report-count">{reports.length}회</span>
            </div>
            {reports.map((r, i) => (
              <AgentReportItem key={i} report={r} index={reports.length - i} defaultOpen={i === 0} />
            ))}
            {(() => {
              const withUsage = reports.filter(r => r.tokenUsage)
              if (withUsage.length === 0) return null
              const totalIn   = withUsage.reduce((s, r) => s + (r.tokenUsage.input_tokens  || 0), 0)
              const totalOut  = withUsage.reduce((s, r) => s + (r.tokenUsage.output_tokens || 0), 0)
              const totalCost = withUsage.reduce((s, r) => s + (r.tokenUsage.total_cost_usd || 0), 0)
              return (
                <div className="agent-report-token-total">
                  <span className="agent-report-token-total-label">총 소비</span>
                  <span>{fmtTokens(totalIn + totalOut)} tokens</span>
                  <span className="agent-report-token-sep">·</span>
                  <span>입력 {fmtTokens(totalIn)}</span>
                  <span className="agent-report-token-sep">·</span>
                  <span>출력 {fmtTokens(totalOut)}</span>
                  {totalCost > 0 && <><span className="agent-report-token-sep">·</span><span>${totalCost.toFixed(4)}</span></>}
                </div>
              )
            })()}
          </div>
        )
      })()}

      {/* Xcode 빌드 패널: iOS 완료 작업만 */}
      {task.platform === 'iOS' && task.status === 'completed' && task.projectPath && (
        <div className="build-panel">
          <div className="build-panel-header">
            <span className="build-panel-title">Xcode 빌드</span>
            {buildStatus === 'running' && <span className="build-badge running">빌드 중...</span>}
            {buildStatus === 'success' && <span className="build-badge success">✓ 성공</span>}
            {buildStatus === 'failed'  && <span className="build-badge failed">✗ 실패</span>}
          </div>
          <div className="build-config">
            {buildSchemes.length === 0 ? (
              <p className="build-config-empty">설정 &gt; 프로젝트에서 스킴을 등록하세요</p>
            ) : (
              <div className="build-scheme-list">
                {buildSchemes.map((s, i) => (
                  <label key={i} className={`build-scheme-option ${selectedSchemeIdx === i ? 'selected' : ''}`}>
                    <input type="radio" name="build-scheme" checked={selectedSchemeIdx === i} onChange={() => setSelectedSchemeIdx(i)} />
                    <div className="build-scheme-info">
                      <span className="build-scheme-name">{s.name}</span>
                      <span className="build-scheme-meta">
                        {[s.configuration, s.destination].filter(Boolean).join(' · ') || '기본 설정'}
                      </span>
                    </div>
                  </label>
                ))}
              </div>
            )}
          </div>
          <div className="build-actions">
            {buildStatus === 'running' ? (
              <button className="build-stop-btn" onClick={handleBuildStop}>중단</button>
            ) : (
              <button
                className="build-btn"
                onClick={handleBuild}
                disabled={buildSchemes.length === 0}
              >
                빌드
              </button>
            )}
          </div>
          {buildLogs.length > 0 && (
            <pre className="build-log" ref={buildLogRef}>{buildLogs.join('\n')}</pre>
          )}
        </div>
      )}
    </div>
  )
}
