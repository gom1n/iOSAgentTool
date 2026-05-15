import { useState, useEffect, useRef } from 'react'
import { MdChecklist, MdMoreVert, MdEdit, MdContentCopy, MdDelete } from 'react-icons/md'
import TourOverlay from '../components/TourOverlay'
import usePageTour from '../hooks/usePageTour'
import './TaskManagement.css'

const TOUR_STEPS = [
  { title: '작업 관리', desc: 'Claude 에이전트에게 맡길 작업을 등록하고 관리합니다.', target: null },
  { title: '새 작업 추가', desc: '버튼을 클릭해 작업을 추가합니다.\n제목·프로젝트·스킴·요구사항을 입력하면 에이전트가 자동으로 처리합니다.', target: '[data-tour="new-task-btn"]' },
  { title: '상태 필터', desc: '전체·대기·진행·완료 상태별로 작업을 필터링합니다.', target: '[data-tour="filter-bar"]' },
  { title: '작업 카드', desc: '카드를 클릭하면 상세 화면으로 이동합니다.\n우측 셀렉트로 상태를 즉시 변경할 수 있습니다.', target: '[data-tour="task-card"]' },
]


const STATUSES   = ['전체', 'pending', 'in-progress', 'completed']
const STATUS_LABELS        = { pending: '대기', 'in-progress': '진행', completed: '완료' }
const STATUS_FILTER_LABELS = { '전체': '전체', pending: '대기', 'in-progress': '진행', completed: '완료' }

function loadProjects() {
  const stored = localStorage.getItem('acc_projects')
  return stored ? JSON.parse(stored) : []
}

async function syncQ(method, task) {
  const url = method === 'POST' ? '/api/task-queue' : `/api/task-queue/${task.id}`
  try {
    await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(task) })
  } catch (e) {
    console.warn('[task-sync] 실패:', e)
  }
}

function generateId() {
  return 'task-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6)
}

function addLog(message, type = 'info', agent = 'web') {
  const logs = JSON.parse(localStorage.getItem('acc_logs') || '[]')
  logs.push({ id: Date.now(), time: new Date().toISOString(), agent, message, type })
  localStorage.setItem('acc_logs', JSON.stringify(logs.slice(-100)))
}

function loadScreens() {
  const stored = localStorage.getItem('acc_screens')
  if (stored) return JSON.parse(stored)
  return [{ id: 'CHECK_BREAKDOWN_02', name: '개방플랫폼 분기', platform: 'iOS' }]
}

const EMPTY_FORM = { title: '', platform: 'iOS', screenIds: [], description: '', requirements: '', projectKey: '', projectPath: '', scheme: '' }

function formatDuration(ms) {
  const totalMin = Math.round(ms / 60000)
  if (totalMin < 60) return `${totalMin}분`
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return m > 0 ? `${h}시간 ${m}분` : `${h}시간`
}

export default function TaskManagement({ onOpenTask, platformFilter }) {
  const [tasks, setTasks]       = useState([])
  const [screens, setScreens]   = useState([])
  const [projects, setProjects] = useState([])
  const [filter, setFilter]         = useState('전체')
  const [projectFilter, setProjectFilter] = useState('전체')
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId]     = useState(null)
  const [form, setForm]         = useState(EMPTY_FORM)
  const [menuOpenId, setMenuOpenId] = useState(null)
  const menuRef = useRef(null)
  const { showTour, startTour, closeTour } = usePageTour('tasks')

  useEffect(() => {
    setTasks(JSON.parse(localStorage.getItem('acc_tasks') || '[]'))
    setProjects(loadProjects())
    fetch('/api/screens')
      .then(r => r.json())
      .then(({ ids }) => {
        const current = loadScreens()
        const synced = current.filter(s => ids.includes(s.id))
        if (synced.length !== current.length) {
          localStorage.setItem('acc_screens', JSON.stringify(synced))
          setScreens(synced)
        } else {
          setScreens(current)
        }
      })
      .catch(() => setScreens(loadScreens()))
  }, [])

  useEffect(() => {
    if (showForm) setProjects(loadProjects())
  }, [showForm])

  useEffect(() => {
    if (!menuOpenId) return
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpenId(null)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [menuOpenId])

  const saveTasks = (updated) => {
    setTasks(updated)
    localStorage.setItem('acc_tasks', JSON.stringify(updated))
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!form.title.trim()) return
    const reqs = form.requirements.split('\n').filter(Boolean)
    if (editId) {
      const updated = tasks.map(t => t.id === editId
        ? { ...t, ...form, requirements: reqs, updated_at: new Date().toISOString() }
        : t)
      saveTasks(updated)
      addLog(`작업 수정: "${form.title}"`, 'info')
      syncQ('PATCH', updated.find(t => t.id === editId))
      setEditId(null)
    } else {
      const task = { id: generateId(), ...form, screenId: form.screenIds[0] || '', requirements: reqs, status: 'pending', created_at: new Date().toISOString() }
      saveTasks([...tasks, task])
      addLog(`새 작업 생성: "${form.title}" (${form.platform})`, 'success')
      syncQ('POST', task)
    }
    setForm(EMPTY_FORM)
    setShowForm(false)
  }

  const handleEdit = (task) => {
    const screenIds = task.screenIds?.length
      ? task.screenIds
      : task.screenId ? [task.screenId] : []
    setForm({
      title: task.title, platform: task.platform,
      screenIds, description: task.description || '',
      requirements: Array.isArray(task.requirements) ? task.requirements.join('\n') : (task.requirements || ''),
      projectKey: task.projectKey || '', projectPath: task.projectPath || '',
      scheme: task.scheme || '',
    })
    setEditId(task.id)
    setShowForm(true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleDelete = (id) => {
    const task = tasks.find(t => t.id === id)
    saveTasks(tasks.filter(t => t.id !== id))
    if (task) {
      addLog(`작업 삭제: "${task.title}"`, 'warning')
      syncQ('DELETE', task)
    }
    setMenuOpenId(null)
  }

  const handleDuplicate = (task) => {
    const screenIds = task.screenIds?.length
      ? task.screenIds
      : task.screenId ? [task.screenId] : []
    setForm({
      title: task.title + ' (복사)',
      platform: task.platform,
      screenIds,
      description: task.description || '',
      requirements: Array.isArray(task.requirements) ? task.requirements.join('\n') : (task.requirements || ''),
      projectKey: task.projectKey || '',
      projectPath: task.projectPath || '',
      scheme: task.scheme || '',
    })
    setEditId(null)
    setShowForm(true)
    setMenuOpenId(null)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleStatusChange = (id, status) => {
    const updated = tasks.map(t => t.id === id ? { ...t, status, updated_at: new Date().toISOString() } : t)
    saveTasks(updated)
    const task = updated.find(t => t.id === id)
    if (task) {
      addLog(`상태 변경: "${task.title}" → ${STATUS_LABELS[status]}`, status === 'completed' ? 'success' : 'info')
      syncQ('PATCH', task)
    }
  }

  // platformFilter: Monitoring에서 플랫폼 클릭 시 진입
  const projectKeys = ['전체', ...Array.from(new Set(tasks.map(t => t.projectKey).filter(Boolean)))]

  const baseTasks = tasks
    .filter(t => !platformFilter || t.platform === platformFilter)
    .filter(t => projectFilter === '전체' || t.projectKey === projectFilter)

  const sortedTasks = [...(filter === '전체' ? baseTasks : baseTasks.filter(t => t.status === filter))]
    .sort((a, b) => new Date(b.updated_at ?? b.created_at) - new Date(a.updated_at ?? a.created_at))

  return (
    <div className="task-management">
      <div className="page-header">
        <h1 className="page-title">
          작업 관리
          {platformFilter && <span className="platform-filter-badge">{platformFilter}</span>}
        </h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {!showForm && (
            <button className="btn-primary" data-tour="new-task-btn" onClick={() => setShowForm(true)}>+ 새 작업</button>
          )}
          <button className="page-tour-btn" onClick={startTour} title="페이지 투어">?</button>
        </div>
      </div>

      {showForm && (
        <div className="form-card">
          <div className="form-card-header">
            <h2>{editId ? '작업 수정' : '새 기획사항 입력'}</h2>
          </div>
          <form onSubmit={handleSubmit} className="task-form">
            <div className="form-row">
              <div className="form-group flex-2">
                <label>작업 제목 *</label>
                <input type="text" placeholder="예: 로그인 화면 추가" value={form.title}
                  onChange={e => setForm(f => ({ ...f, title: e.target.value }))} required />
              </div>
            </div>
            <div className="form-group">
                <label>서비스 / 프로젝트</label>
                <div className="project-radio-group">
                  {projects.map(p => (
                    <label
                      key={p.path}
                      className={`project-radio ${form.projectPath === p.path ? 'selected' : ''}`}
                    >
                      <input
                        type="radio"
                        name="project"
                        value={p.path}
                        checked={form.projectPath === p.path}
                        onChange={() => setForm(f => ({ ...f, projectKey: p.label, projectPath: p.path, scheme: '' }))}
                      />
                      <span className="project-radio-label">{p.label}</span>
                      <span className="project-radio-path">{p.path.split('/').pop()}</span>
                    </label>
                  ))}
                </div>
              </div>
              {(() => {
                const selectedProject = projects.find(p => p.path === form.projectPath)
                const schemes = selectedProject?.schemes || []
                if (!schemes.length) return null
                return (
                  <div className="form-group">
                    <label>스킴</label>
                    <select value={form.scheme} onChange={e => setForm(f => ({ ...f, scheme: e.target.value }))}>
                      <option value="">선택 안 함</option>
                      {schemes.map(s => (
                        <option key={s.name} value={s.name}>{s.name} ({s.configuration})</option>
                      ))}
                    </select>
                  </div>
                )
              })()}

            <div className="form-group">
              <label>스크린 ID</label>
              {form.screenIds.length > 0 && (
                <div className="screen-id-tags">
                  {form.screenIds.map(id => (
                    <span key={id} className="screen-id-tag">
                      {id}
                      <button type="button" onClick={() => setForm(f => ({ ...f, screenIds: f.screenIds.filter(s => s !== id) }))}>×</button>
                    </span>
                  ))}
                </div>
              )}
              <div className="screen-id-add-row">
                <select
                  value=""
                  onChange={e => {
                    const val = e.target.value
                    if (val && !form.screenIds.includes(val)) setForm(f => ({ ...f, screenIds: [...f.screenIds, val] }))
                  }}
                >
                  <option value="">목록에서 선택...</option>
                  {screens.filter(s => !form.screenIds.includes(s.id)).map(s => (
                    <option key={s.id} value={s.id}>{s.id} — {s.name}</option>
                  ))}
                </select>
                <input
                  type="text"
                  placeholder="직접 입력 후 Enter"
                  onKeyDown={e => {
                    if (e.key !== 'Enter') return
                    e.preventDefault()
                    const val = e.target.value.trim()
                    if (val && !form.screenIds.includes(val)) setForm(f => ({ ...f, screenIds: [...f.screenIds, val] }))
                    e.target.value = ''
                  }}
                />
              </div>
            </div>
            <div className="form-group">
              <label>설명</label>
              <input type="text" placeholder="작업에 대한 간단한 설명" value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
            </div>
            <div className="form-group">
              <label>요구사항 (줄바꿈으로 구분)</label>
              <textarea rows={5} placeholder={"이메일/비밀번호 입력\n유효성 검사\n소셜 로그인 지원"}
                value={form.requirements} onChange={e => setForm(f => ({ ...f, requirements: e.target.value }))} />
            </div>
            <div className="form-actions">
              <button type="button" className="btn-ghost" onClick={() => { setForm(EMPTY_FORM); setEditId(null); setShowForm(false) }}>취소</button>
              <button type="submit" className="btn-primary">{editId ? '수정 완료' : '작업 생성'}</button>
            </div>
          </form>
        </div>
      )}

      <div className="filter-bar" data-tour="filter-bar">
        {STATUSES.map(s => (
          <button key={s} className={`filter-btn ${filter === s ? 'active' : ''}`} onClick={() => setFilter(s)}>
            {STATUS_FILTER_LABELS[s]}
            <span className="filter-count">{s === '전체' ? tasks.length : tasks.filter(t => t.status === s).length}</span>
          </button>
        ))}
        {projectKeys.length > 1 && (
          <>
            <div className="filter-bar-sep" />
            {projectKeys.map(key => {
              const proj = projects.find(p => p.label === key)
              const color = proj?.color || '#6b7280'
              const isActive = projectFilter === key
              return (
                <button
                  key={key}
                  className={`filter-btn ${isActive ? 'active' : ''}`}
                  style={key !== '전체' && isActive ? { background: color + '22', color, borderColor: color + '55' } : {}}
                  onClick={() => setProjectFilter(key)}
                >
                  {key !== '전체' && <span className="filter-project-dot" style={{ background: color }} />}
                  {key}
                  <span className="filter-count">
                    {key === '전체' ? tasks.length : tasks.filter(t => t.projectKey === key).length}
                  </span>
                </button>
              )
            })}
          </>
        )}
      </div>

      {sortedTasks.length === 0 ? (
        <div className="empty-tasks">
          <div className="empty-icon-wrap">
            <MdChecklist size={48} />
          </div>
          <p>{filter === '전체' ? '작업이 없습니다. 새 작업을 추가해보세요.' : `${STATUS_FILTER_LABELS[filter]} 상태의 작업이 없습니다.`}</p>
        </div>
      ) : (
        <div className="task-list">
          {sortedTasks.map((task, idx) => (
            <div key={task.id} {...(idx === 0 ? { 'data-tour': 'task-card' } : {})} className="task-card"
              onClick={(e) => { if (!e.target.closest('button, select')) onOpenTask?.(task) }}
              style={{ cursor: onOpenTask ? 'pointer' : 'default' }}
            >
              <div className="task-card-header">
                <div className="task-card-left">
                  {task.projectKey && (() => {
                    const proj = projects.find(p => p.label === task.projectKey)
                    const color = proj?.color || '#6b7280'
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
                    <span key={id} className="screen-id-badge">{id}</span>
                  ))}
                  {task.scheme && <span className="scheme-badge">{task.scheme}</span>}
                </div>
                <div className="task-card-actions">
                  <select value={task.status} className={`status-select status-${task.status}`}
                    onChange={e => handleStatusChange(task.id, e.target.value)}>
                    <option value="pending">대기</option>
                    <option value="in-progress">진행 중</option>
                    <option value="completed">완료</option>
                  </select>
                  <div className="task-menu-wrap" ref={menuOpenId === task.id ? menuRef : null}>
                    <button
                      className="btn-icon"
                      onClick={(e) => { e.stopPropagation(); setMenuOpenId(menuOpenId === task.id ? null : task.id) }}
                      title="더보기"
                    >
                      <MdMoreVert size={18} />
                    </button>
                    {menuOpenId === task.id && (
                      <div className="task-menu-dropdown">
                        <button className="task-menu-item" onClick={(e) => { e.stopPropagation(); handleEdit(task); setMenuOpenId(null) }}>
                          <MdEdit size={14} /> 편집
                        </button>
                        <button className="task-menu-item" onClick={(e) => { e.stopPropagation(); handleDuplicate(task) }}>
                          <MdContentCopy size={14} /> 복제
                        </button>
                        <div className="task-menu-divider" />
                        <button className="task-menu-item danger" onClick={(e) => { e.stopPropagation(); handleDelete(task.id) }}>
                          <MdDelete size={14} /> 삭제
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <div className="task-card-title">{task.title}</div>
              {task.description && <div className="task-card-desc">{task.description}</div>}
              {Array.isArray(task.requirements) && task.requirements.length > 0 && (
                <ul className="task-requirements">
                  {task.requirements.map((req, i) => <li key={i}>{req}</li>)}
                </ul>
              )}
              {task.status === 'completed' && task.started_at && (() => {
                const startTs = task.started_at
                const agentMs = new Date(task.updated_at) - new Date(startTs)
                const humanMs = task.humanEstimateMinutes ? task.humanEstimateMinutes * 60000 : null
                const ratio = humanMs && agentMs > 0 ? (humanMs / agentMs).toFixed(1) : null
                return (
                  <div className="task-time-row">
                    <span className="time-badge agent">⚡ {formatDuration(agentMs)}</span>
                    {humanMs && <span className="time-badge human">👤 {formatDuration(humanMs)}</span>}
                    {ratio && parseFloat(ratio) > 1 && <span className="time-badge efficiency">{ratio}x 빠름</span>}
                  </div>
                )
              })()}
              <div className="task-card-footer">
                <span className="task-id">{task.id}</span>
                <span className="task-date">{new Date(task.created_at).toLocaleDateString('ko-KR')}</span>
              </div>
            </div>
          ))}
        </div>
      )}
      {showTour && <TourOverlay steps={TOUR_STEPS} onClose={closeTour} />}
    </div>
  )
}
