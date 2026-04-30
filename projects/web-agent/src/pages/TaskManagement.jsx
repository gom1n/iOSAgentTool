import { useState, useEffect, useRef } from 'react'
import { MdChecklist, MdMoreVert, MdEdit, MdContentCopy, MdDelete } from 'react-icons/md'
import './TaskManagement.css'

const PRIORITIES = ['높음', '중간', '낮음']
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

const EMPTY_FORM = { title: '', platform: 'iOS', priority: '중간', screenId: '', description: '', requirements: '', projectKey: '', projectPath: '' }

export default function TaskManagement({ onOpenTask, platformFilter }) {
  const [tasks, setTasks]       = useState([])
  const [screens, setScreens]   = useState([])
  const [projects, setProjects] = useState([])
  const [filter, setFilter]     = useState('전체')
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId]     = useState(null)
  const [form, setForm]         = useState(EMPTY_FORM)
  const [menuOpenId, setMenuOpenId] = useState(null)
  const menuRef = useRef(null)

  useEffect(() => {
    setTasks(JSON.parse(localStorage.getItem('acc_tasks') || '[]'))
    setScreens(loadScreens())
    setProjects(loadProjects())
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
      const task = { id: generateId(), ...form, requirements: reqs, status: 'pending', created_at: new Date().toISOString() }
      saveTasks([...tasks, task])
      addLog(`새 작업 생성: "${form.title}" (${form.platform})`, 'success')
      syncQ('POST', task)
    }
    setForm(EMPTY_FORM)
    setShowForm(false)
  }

  const handleEdit = (task) => {
    setForm({
      title: task.title, platform: task.platform, priority: task.priority || '중간',
      screenId: task.screenId || '', description: task.description || '',
      requirements: Array.isArray(task.requirements) ? task.requirements.join('\n') : (task.requirements || ''),
      projectKey: task.projectKey || '', projectPath: task.projectPath || '',
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
    setForm({
      title: task.title + ' (복사)',
      platform: task.platform,
      priority: task.priority || '중간',
      screenId: task.screenId || '',
      description: task.description || '',
      requirements: Array.isArray(task.requirements) ? task.requirements.join('\n') : (task.requirements || ''),
      projectKey: task.projectKey || '',
      projectPath: task.projectPath || '',
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
  const baseTasks = platformFilter ? tasks.filter(t => t.platform === platformFilter) : tasks

  const sortedTasks = [...(filter === '전체' ? baseTasks : baseTasks.filter(t => t.status === filter))]
    .sort((a, b) => {
      const order = { '높음': 0, '중간': 1, '낮음': 2 }
      if (order[a.priority] !== order[b.priority]) return order[a.priority] - order[b.priority]
      return new Date(b.updated_at ?? b.created_at) - new Date(a.updated_at ?? a.created_at)
    })

  return (
    <div className="task-management">
      <div className="page-header">
        <h1 className="page-title">
          작업 관리
          {platformFilter && <span className="platform-filter-badge">{platformFilter}</span>}
        </h1>
        {!showForm && (
          <button className="btn-primary" onClick={() => setShowForm(true)}>+ 새 작업</button>
        )}
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
              <div className="form-group">
                <label>우선순위</label>
                <select value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}>
                  {PRIORITIES.map(p => <option key={p}>{p}</option>)}
                </select>
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
                        onChange={() => setForm(f => ({ ...f, projectKey: p.label, projectPath: p.path }))}
                      />
                      <span className="project-radio-label">{p.label}</span>
                      <span className="project-radio-path">{p.path.split('/').pop()}</span>
                    </label>
                  ))}
                </div>
              </div>

            <div className="form-row">
              <div className="form-group flex-2">
                <label>컴포넌트 ID 선택</label>
                <select value={form.screenId} onChange={e => setForm(f => ({ ...f, screenId: e.target.value }))}>
                  <option value="">선택 안 함</option>
                  {screens.map(s => <option key={s.id} value={s.id}>{s.id} — {s.name}</option>)}
                </select>
              </div>
              <div className="form-group flex-2">
                <label>컴포넌트 ID 직접 입력</label>
                <input type="text" placeholder="CHECK_BREAKDOWN_02" value={form.screenId}
                  onChange={e => setForm(f => ({ ...f, screenId: e.target.value }))} />
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

      <div className="filter-bar">
        {STATUSES.map(s => (
          <button key={s} className={`filter-btn ${filter === s ? 'active' : ''}`} onClick={() => setFilter(s)}>
            {STATUS_FILTER_LABELS[s]}
            <span className="filter-count">{s === '전체' ? tasks.length : tasks.filter(t => t.status === s).length}</span>
          </button>
        ))}
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
          {sortedTasks.map(task => (
            <div key={task.id} className={`task-card priority-${task.priority === '높음' ? 'high' : task.priority === '낮음' ? 'low' : 'mid'}`}
              onClick={(e) => { if (!e.target.closest('button, select')) onOpenTask?.(task) }}
              style={{ cursor: onOpenTask ? 'pointer' : 'default' }}
            >
              <div className="task-card-header">
                <div className="task-card-left">
                  <span className={`priority-badge priority-${task.priority === '높음' ? 'high' : task.priority === '낮음' ? 'low' : 'mid'}`}>{task.priority}</span>
                  <span className={`platform-badge ${task.platform?.toLowerCase()}`}>{task.platform}</span>
                  {task.screenId && <span className="screen-id-badge">{task.screenId}</span>}
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
              <div className="task-card-footer">
                <span className="task-id">{task.id}</span>
                <span className="task-date">{new Date(task.created_at).toLocaleDateString('ko-KR')}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
