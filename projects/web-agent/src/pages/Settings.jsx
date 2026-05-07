import { useState, useEffect, useRef } from 'react'
import { MdMap, MdMenuBook, MdAdd, MdFolder } from 'react-icons/md'
import './Settings.css'
import FilePathInput from '../components/FilePathInput'
import TourOverlay from '../components/TourOverlay'
import usePageTour from '../hooks/usePageTour'

const TOUR_STEPS = [
  { title: '설정', desc: '에이전트가 작동하기 위한 기본 정보를 등록합니다.\n처음 사용 시 프로젝트 탭부터 시작하세요.', target: null },
  { title: '화면 매핑 탭', desc: 'iOS 스크린과 코드 파일을 연결합니다.\n에이전트가 어떤 파일을 수정해야 하는지 파악하는 데 사용됩니다.', target: '[data-tour="tab-mapping"]' },
  { title: '프로젝트 탭', desc: 'iOS 프로젝트 경로와 빌드 스킴을 등록합니다.\n경로를 입력하면 실시간으로 유효성을 검증합니다.', target: '[data-tour="tab-projects"]' },
  { title: '가이드 탭', desc: '에이전트의 행동 지침을 편집합니다.\nMaster 가이드와 iOS 에이전트 CLAUDE.md를 직접 수정할 수 있습니다.', target: '[data-tour="tab-guide"]' },
]

const DEFAULT_MASTER = `# Agent System - 전체 시스템 가이드

## 통신 규약

### Task JSON 형식
\`\`\`json
{
  "id": "task-001",
  "created_at": "2024-01-15T10:00:00Z",
  "title": "로그인 기능 추가",
  "platform": "iOS",
  "description": "사용자 로그인 페이지 구현",
  "status": "pending",
  "requirements": [
    "이메일/비밀번호 입력",
    "유효성 검사"
  ]
}
\`\`\`

### Status JSON 형식
\`\`\`json
{
  "task_id": "task-001",
  "agent": "ios-agent",
  "status": "in-progress",
  "progress": 60,
  "last_updated": "2024-01-15T10:30:00Z"
}
\`\`\`
`


const DEFAULT_IOS_GUIDE = `# iOS Agent - Claude Code 가이드

## 역할
실제 iOS 앱 개발 담당

## 기술 스택
- Swift / SwiftUI
- Xcode

## 작업 규칙
- 화면 ID를 기반으로 파일 수정
- screen-mapping.json 참고
- 커밋 메시지: [iOS] 형식 사용
`

const DEFAULT_PROJECTS = []

function loadProjects() {
  const stored = localStorage.getItem('acc_projects')
  if (!stored) return DEFAULT_PROJECTS
  // 구버전(scheme/configuration/destination 필드) → schemes 배열로 마이그레이션
  return JSON.parse(stored).map(p => {
    if (p.schemes) return p
    const legacy = []
    if (p.scheme) legacy.push({ name: p.scheme, configuration: p.configuration || '', destination: p.destination || '' })
    const { scheme, configuration, destination, ...rest } = p
    return { ...rest, schemes: legacy }
  })
}

// 파일 경로에서 클래스명 자동 추출 (확장자 제거)
function extractClassName(filePath) {
  if (!filePath) return ''
  const filename = filePath.split('/').pop()
  return filename.replace(/\.[^.]+$/, '')
}

// 단일 파일 항목의 절대 경로 계산
function computeFileFullPath(filePath, projectPath) {
  if (!filePath) return '—'
  const relPath = filePath.startsWith('/')
    ? filePath.replace(/^\/[^/]+\//, '')
    : filePath
  return projectPath ? `${projectPath}/${relPath}` : filePath
}

// 하위호환: 구버전(filePath/className) → files 배열로 마이그레이션
function migrateScreen(s) {
  if (s.files) return s
  return {
    ...s,
    files: s.filePath ? [{ filePath: s.filePath, className: s.className || '' }] : [],
  }
}

const DEFAULT_SCREEN = {
  id: '',
  name: '',
  platform: 'iOS',
  files: [],         // [{ filePath, className }]
  projectKey: '',
  projectPath: '',
  description: '',
  features: '',
  notes: '',
  specFileName: '',
}

const EMPTY_FILE_ENTRY = { filePath: '', className: '' }

function buildScreenMd(s, screensBase) {
  const featureLines = s.features
    ? s.features.split('\n').filter(Boolean).map(f => `- ${f}`).join('\n')
    : '(없음)'
  const specLine = s.specFileName
    ? `→ \`${screensBase}/${s.id}/${s.id}_spec.md\` 참고 (${s.specFileName})`
    : '(없음)'
  const fileLines = (s.files || []).length > 0
    ? s.files.map(f => `  - ${f.className || '(unnamed)'}: \`${computeFileFullPath(f.filePath, s.projectPath)}\``).join('\n')
    : '  (없음)'
  return [
    `# ${s.name || s.id} (${s.id})`,
    '',
    '## 화면 설명',
    s.description || '(없음)',
    '',
    '## 주요 기능',
    featureLines,
    '',
    '## 에이전트 참고사항',
    s.notes || '(없음)',
    '',
    '## 기획/디자인 스펙',
    specLine,
    '',
    '## 코드 정보',
    `- 플랫폼: ${s.platform}`,
    `- 프로젝트: ${s.projectKey || '—'}`,
    '- 관련 파일:',
    fileLines,
  ].join('\n')
}

function loadScreens() {
  const stored = localStorage.getItem('acc_screens')
  return stored ? JSON.parse(stored).map(migrateScreen) : []
}

export default function Settings() {
  const [activeTab, setActiveTab] = useState('mapping')
  const [screens, setScreens] = useState([])
  const [editScreen, setEditScreen] = useState(null)
  const [showScreenForm, setShowScreenForm] = useState(false)
  const [screenForm, setScreenForm] = useState(DEFAULT_SCREEN)
  const [projectFilter, setProjectFilter]   = useState('전체')
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [screenMenuIdx, setScreenMenuIdx] = useState(null)
  const screenMenuRef = useRef(null)
  const [specContent, setSpecContent] = useState('')   // 현재 편집 중 첨부된 스펙 내용 (저장 안 됨)
  const [specDragging, setSpecDragging] = useState(false)

  const [projects, setProjects]       = useState([])
  const [projectForm, setProjectForm] = useState({ label: '', path: '', color: '#3b82f6' })
  const [showProjectForm, setShowProjectForm] = useState(false)
  const [editingProjectIdx, setEditingProjectIdx] = useState(null)
  const [editingProjectForm, setEditingProjectForm] = useState({ label: '', path: '', color: '#3b82f6' })
  const [pathValidation, setPathValidation] = useState(null)  // null | { valid, target?, reason? }
  const pathValidateTimer = useRef(null)

  // 스킴 관리
  const [schemeFormProjectIdx, setSchemeFormProjectIdx] = useState(null)
  const [editSchemeIdx, setEditSchemeIdx] = useState(null)
  const [schemeForm, setSchemeForm] = useState({ name: '', configuration: '', destination: 'generic/platform=iOS' })

  const [masterGuide, setMasterGuide] = useState(DEFAULT_MASTER)

  const [iosGuide, setIosGuide] = useState(DEFAULT_IOS_GUIDE)
  const { showTour, startTour, closeTour } = usePageTour('settings')
  const [migrating, setMigrating]   = useState(false)
  const [migrateResult, setMigrateResult] = useState(null)

  const handleMigrate = async () => {
    setMigrating(true)
    setMigrateResult(null)
    try {
      const tasks = JSON.parse(localStorage.getItem('acc_tasks') || '[]')
      const completed = tasks.filter(t => t.status === 'completed')
      const entries = completed.map(t => ({
        id:         t.id,
        title:      t.title || '',
        projectKey: t.projectKey || '기타',
        scheme:     t.scheme || '',
        platform:   t.platform || '',
        completedAt: t.updated_at || t.created_at,
        createdAt:  t.created_at,
      }))
      const res = await fetch('/api/task-history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries }),
      })
      const data = await res.json()
      setMigrateResult({ ok: true, added: data.added, total: completed.length })
    } catch {
      setMigrateResult({ ok: false })
    }
    setMigrating(false)
  }
  const [savedGuide, setSavedGuide] = useState(null)
  const [editingGuide, setEditingGuide] = useState(null)
  const [systemPaths, setSystemPaths] = useState(null)

  const readGuideFile = async (filePath, setter) => {
    if (!filePath) return
    try {
      const res = await fetch(`/api/file?path=${encodeURIComponent(filePath)}`)
      if (res.ok) {
        const { content } = await res.json()
        setter(content)
      }
    } catch {}
  }

  useEffect(() => {
    // shared/screens/ 폴더와 localStorage 동기화 (폴더 직접 삭제 대응)
    fetch('/api/screens')
      .then(r => r.json())
      .then(({ ids }) => {
        const current = loadScreens()
        const synced = current.filter(s => ids.includes(s.id))
        if (synced.length !== current.length) {
          setScreens(synced)
          localStorage.setItem('acc_screens', JSON.stringify(synced))
        } else {
          setScreens(current)
        }
      })
      .catch(() => setScreens(loadScreens()))
    const loaded = loadProjects()
    setProjects(loaded)
    // 서버 파일과 자동 동기화 (projects.json 없을 때 대비)
    if (loaded.length > 0) {
      fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projects: loaded }),
      }).catch(() => {})
    }
    fetch('/api/system-paths')
      .then(r => r.json())
      .then(paths => {
        setSystemPaths(paths)
        readGuideFile(paths.guideFiles?.master, setMasterGuide)
        readGuideFile(paths.guideFiles?.ios, setIosGuide)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (screenMenuIdx === null) return
    const handler = (e) => {
      if (screenMenuRef.current && !screenMenuRef.current.contains(e.target)) setScreenMenuIdx(null)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [screenMenuIdx])

  const saveProjects = (updated) => {
    setProjects(updated)
    localStorage.setItem('acc_projects', JSON.stringify(updated))
    fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projects: updated }),
    }).catch(() => {})
  }

  const handleProjectSubmit = (e) => {
    e.preventDefault()
    if (!projectForm.label.trim() || !projectForm.path.trim()) return
    saveProjects([...projects, { label: projectForm.label, path: projectForm.path, color: projectForm.color || '#3b82f6', schemes: [] }])
    setProjectForm({ label: '', path: '', color: '#3b82f6' })
    setShowProjectForm(false)
    setPathValidation(null)
  }

  const deleteProject = (idx) => {
    saveProjects(projects.filter((_, i) => i !== idx))
  }

  const handleInlineProjectEdit = (i) => {
    setEditingProjectIdx(i)
    setEditingProjectForm({ label: projects[i].label, path: projects[i].path, color: projects[i].color || '#3b82f6' })
    setPathValidation(null)
    validatePath(projects[i].path)
  }

  const handleInlineProjectSave = (i) => {
    if (!editingProjectForm.label.trim() || !editingProjectForm.path.trim()) return
    saveProjects(projects.map((p, idx) => idx === i ? { ...p, label: editingProjectForm.label, path: editingProjectForm.path, color: editingProjectForm.color || '#3b82f6' } : p))
    setEditingProjectIdx(null)
    setPathValidation(null)
  }

  const validatePath = (path) => {
    clearTimeout(pathValidateTimer.current)
    if (!path.trim()) { setPathValidation(null); return }
    pathValidateTimer.current = setTimeout(async () => {
      try {
        const r = await fetch(`/api/validate-project-path?path=${encodeURIComponent(path.trim())}`)
        setPathValidation(await r.json())
      } catch { setPathValidation(null) }
    }, 400)
  }

  const openSchemeForm = (projectIdx, schemeIdx) => {
    setSchemeFormProjectIdx(projectIdx)
    setEditSchemeIdx(schemeIdx)
    setSchemeForm(schemeIdx !== null
      ? { ...projects[projectIdx].schemes[schemeIdx] }
      : { name: '', configuration: '', destination: 'generic/platform=iOS' }
    )
  }

  const closeSchemeForm = () => {
    setSchemeFormProjectIdx(null)
    setEditSchemeIdx(null)
    setSchemeForm({ name: '', configuration: '', destination: 'generic/platform=iOS' })
  }

  const handleSchemeSubmit = (e, projectIdx) => {
    e.preventDefault()
    if (!schemeForm.name.trim()) return
    const updated = projects.map((p, i) => {
      if (i !== projectIdx) return p
      const schemes = editSchemeIdx !== null
        ? p.schemes.map((s, j) => j === editSchemeIdx ? { ...schemeForm } : s)
        : [...p.schemes, { ...schemeForm }]
      return { ...p, schemes }
    })
    saveProjects(updated)
    closeSchemeForm()
  }

  const deleteScheme = (projectIdx, schemeIdx) => {
    const updated = projects.map((p, i) => {
      if (i !== projectIdx) return p
      return { ...p, schemes: p.schemes.filter((_, j) => j !== schemeIdx) }
    })
    saveProjects(updated)
  }

  const saveScreens = (updated) => {
    setScreens(updated)
    localStorage.setItem('acc_screens', JSON.stringify(updated))
  }



  const SCREENS_BASE = systemPaths?.screensBase || ''
  const guideFiles = systemPaths?.guideFiles || {}

  // screenId → 폴더명 (예: MONITORING_IOS_AGENT → MONITORING, COUPON_DETAIL → COUPON_DETAIL)
  const getScreenFolder = (screenId) => {
    const groups = ['MONITORING', 'SETTINGS', 'SIDEBAR', 'TASK_DETAIL', 'TASK_MANAGEMENT']
    for (const g of groups) {
      if (screenId === g || screenId.startsWith(g + '_')) return g
    }
    return screenId
  }

  const saveScreenMd = async (screen) => {
    const folder = getScreenFolder(screen.id)
    const dir = `${SCREENS_BASE}/${folder}`
    try {
      await fetch('/api/file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: `${dir}/${screen.id}.md`, content: buildScreenMd(screen, SCREENS_BASE) }),
      })
      if (specContent) {
        const res = await fetch('/api/compress-spec', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: specContent }),
        })
        const { compressed, originalSize, compressedSize } = await res.json()
        const ratio = ((1 - compressedSize / originalSize) * 100).toFixed(0)
        console.log(`스펙 경량화: ${(originalSize / 1024).toFixed(1)}KB → ${(compressedSize / 1024).toFixed(1)}KB (${ratio}% 감소)`)
        await fetch('/api/file', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: `${dir}/${screen.id}_spec.md`, content: compressed }),
        })
      }
    } catch {}
  }

  const handleScreenSubmit = (e) => {
    e.preventDefault()
    if (!screenForm.id.trim()) return

    if (editScreen !== null) {
      const updated = screens.map((s, i) => i === editScreen ? { ...screenForm } : s)
      saveScreens(updated)
      setEditScreen(null)
      saveScreenMd(screenForm)
    } else {
      saveScreens([...screens, { ...screenForm }])
      saveScreenMd(screenForm)
    }
    setSpecContent('')
    setScreenForm(DEFAULT_SCREEN)
    setShowScreenForm(false)
  }

  const handleEditScreen = (idx) => {
    setScreenForm({ ...screens[idx] })
    setSpecContent('')
    setEditScreen(idx)
    setShowScreenForm(true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleDeleteScreen = (idx) => {
    saveScreens(screens.filter((_, i) => i !== idx))
    setDeleteConfirm(null)
  }

  const handleSaveGuide = async (type) => {
    const contentMap = { master: masterGuide, ios: iosGuide }
    try {
      await fetch('/api/file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: guideFiles[type], content: contentMap[type] }),
      })
    } catch {}
    setSavedGuide(type)
    setEditingGuide(null)
    setTimeout(() => setSavedGuide(null), 2000)
  }

  return (
    <div className="settings">
      <div className="page-header">
        <h1 className="page-title">설정</h1>
        <button className="page-tour-btn" onClick={startTour} title="페이지 투어">?</button>
      </div>

      <div className="tabs">
        <button data-tour="tab-mapping" className={`tab-btn ${activeTab === 'mapping' ? 'active' : ''}`} onClick={() => setActiveTab('mapping')}>
          <MdMap size={15} /> 스크린 매핑
        </button>
        <button data-tour="tab-projects" className={`tab-btn ${activeTab === 'projects' ? 'active' : ''}`} onClick={() => setActiveTab('projects')}>
          <MdFolder size={15} /> 프로젝트
        </button>
        <button data-tour="tab-guide" className={`tab-btn ${activeTab === 'guide' ? 'active' : ''}`} onClick={() => setActiveTab('guide')}>
          <MdMenuBook size={15} /> 가이드
        </button>
      </div>

      {activeTab === 'mapping' && (
        <div className="tab-content">
          <div className="section-header">
            <div>
              <h2>스크린 ID 매핑</h2>
              <p className="section-desc">스크린 ID와 코드 위치를 연결합니다</p>
            </div>
            {!showScreenForm && (
              <button className="btn-primary" onClick={() => { setShowScreenForm(true); setEditScreen(null); setScreenForm(DEFAULT_SCREEN) }}>
                + 스크린 추가
              </button>
            )}
          </div>

          {showScreenForm && (
            <div className="form-card">
              <div className="form-card-header">
                <h3>{editScreen !== null ? '스크린 수정' : '새 스크린 추가'}</h3>
              </div>
              <form onSubmit={handleScreenSubmit} className="screen-form">
                {/* Row 1: 스크린 ID / 이름 / 플랫폼 */}
                <div className="form-row">
                  <div className="form-group">
                    <label>스크린 ID <span className="required-mark">*</span></label>
                    <input
                      type="text"
                      placeholder="MONITORING_IOS_AGENT"
                      value={screenForm.id}
                      onChange={e => setScreenForm(f => ({ ...f, id: e.target.value }))}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label>스크린 이름 <span className="optional-mark">선택</span></label>
                    <input
                      type="text"
                      placeholder="개방플랫폼 분기"
                      value={screenForm.name}
                      onChange={e => setScreenForm(f => ({ ...f, name: e.target.value }))}
                    />
                  </div>
                  <div className="form-group" style={{ maxWidth: 120 }}>
                    <label>플랫폼</label>
                    <select value={screenForm.platform} onChange={e => setScreenForm(f => ({ ...f, platform: e.target.value }))}>
                      <option>iOS</option>
                    </select>
                  </div>
                </div>

                {/* Row 2: 프로젝트 선택 (iOS 전용) */}
                {screenForm.platform === 'iOS' && <div className="form-group">
                  <label>프로젝트</label>
                  <div className="project-radio-group">
                    {projects.map(p => (
                      <label
                        key={p.path}
                        className={`project-radio ${screenForm.projectPath === p.path ? 'selected' : ''}`}
                      >
                        <input
                          type="radio"
                          name="project"
                          value={p.path}
                          checked={screenForm.projectPath === p.path}
                          onChange={() => setScreenForm(f => ({ ...f, projectPath: p.path, projectKey: p.label }))}
                        />
                        <span className="project-radio-label">{p.label}</span>
                        <span className="project-radio-path">{p.path.split('/').pop()}</span>
                      </label>
                    ))}
                  </div>
                </div>}

                {/* Row 3: 파일 목록 (iOS 전용) */}
                {screenForm.platform === 'iOS' && <div className="form-group">
                  <label>관련 파일</label>
                  <div className="file-list">
                    {(screenForm.files.length === 0 ? [EMPTY_FILE_ENTRY] : screenForm.files).map((entry, idx) => (
                      <div key={idx} className="file-list-row">
                        <div className="file-list-row-path">
                          <FilePathInput
                            label={null}
                            value={entry.filePath}
                            onChange={v => {
                              const next = [...(screenForm.files.length === 0 ? [EMPTY_FILE_ENTRY] : screenForm.files)]
                              next[idx] = { ...next[idx], filePath: v, className: extractClassName(v) }
                              setScreenForm(f => ({ ...f, files: next }))
                            }}
                            placeholder="src/Views/SomeView.swift"
                            projectPath={screenForm.projectPath}
                          />
                        </div>
                        <div className="file-list-row-class">
                          {entry.className
                            ? <code className="class-chip">{entry.className}</code>
                            : <span className="class-chip-empty">클래스명</span>
                          }
                        </div>
                        {screenForm.files.length > 1 && (
                          <button
                            type="button"
                            className="file-list-remove"
                            onClick={() => setScreenForm(f => ({ ...f, files: f.files.filter((_, i) => i !== idx) }))}
                          >×</button>
                        )}
                      </div>
                    ))}
                    <div className="file-list-actions">
                      <button
                        type="button"
                        className="file-list-add"
                        onClick={() => setScreenForm(f => ({ ...f, files: [...(f.files.length === 0 ? [EMPTY_FILE_ENTRY] : f.files), { ...EMPTY_FILE_ENTRY }] }))}
                      >
                        + 파일 추가
                      </button>
                      <FilePathInput
                        label={null}
                        value=""
                        onChange={() => {}}
                        onMultiple={paths => {
                          const newEntries = paths.map(p => ({ filePath: p, className: extractClassName(p) }))
                          setScreenForm(f => {
                            const existing = f.files.filter(e => e.filePath)
                            return { ...f, files: [...existing, ...newEntries] }
                          })
                        }}
                        placeholder=""
                        projectPath={screenForm.projectPath}
                        multipleButton
                      />
                    </div>
                  </div>
                </div>}

                <div className="screen-form-divider">
                  <span>에이전트 가이드</span>
                </div>

                {/* Row 4: 화면 설명 */}
                <div className="form-group">
                  <label>화면 설명</label>
                  <input
                    type="text"
                    placeholder="이 화면이 어떤 용도인지 간략히 설명하세요"
                    value={screenForm.description}
                    onChange={e => setScreenForm(f => ({ ...f, description: e.target.value }))}
                  />
                </div>

                {/* Row 5: 주요 기능 */}
                <div className="form-group">
                  <label>주요 기능 <span className="optional-mark">줄바꿈으로 구분</span></label>
                  <textarea
                    rows={4}
                    placeholder={"QR코드 스캔\n쿠폰 목록 조회\n쿠폰 상세 보기\n사용 처리"}
                    value={screenForm.features}
                    onChange={e => setScreenForm(f => ({ ...f, features: e.target.value }))}
                  />
                </div>

                {/* Row 6: 에이전트 참고사항 */}
                <div className="form-group">
                  <label>에이전트 참고사항 <span className="optional-mark">Claude Code가 작업 시 주의할 점</span></label>
                  <textarea
                    rows={3}
                    placeholder={"기존 QR 스캔 로직은 CameraManager를 통해 처리됨\nAPI 응답 모델은 CouponModel.swift 참고"}
                    value={screenForm.notes}
                    onChange={e => setScreenForm(f => ({ ...f, notes: e.target.value }))}
                  />
                </div>

                {screenForm.platform === 'iOS' && <><div className="screen-form-divider">
                  <span>기획/디자인 스펙</span>
                </div>

                <div
                  className={`spec-dropzone ${specDragging ? 'dragging' : ''} ${specContent ? 'has-file' : ''}`}
                  onDragOver={e => { e.preventDefault(); setSpecDragging(true) }}
                  onDragLeave={() => setSpecDragging(false)}
                  onDrop={e => {
                    e.preventDefault()
                    setSpecDragging(false)
                    const file = e.dataTransfer.files[0]
                    if (!file) return
                    const reader = new FileReader()
                    reader.onload = ev => {
                      setSpecContent(ev.target.result)
                      setScreenForm(f => ({ ...f, specFileName: file.name }))
                    }
                    reader.readAsText(file)
                  }}
                  onClick={() => document.getElementById('spec-file-input').click()}
                >
                  <input
                    id="spec-file-input"
                    type="file"
                    accept=".md,.txt"
                    style={{ display: 'none' }}
                    onChange={e => {
                      const file = e.target.files[0]
                      if (!file) return
                      const reader = new FileReader()
                      reader.onload = ev => {
                        setSpecContent(ev.target.result)
                        setScreenForm(f => ({ ...f, specFileName: file.name }))
                      }
                      reader.readAsText(file)
                      e.target.value = ''
                    }}
                  />
                  {specContent ? (
                    <div className="spec-dropzone-attached">
                      <span className="spec-file-icon">📄</span>
                      <div>
                        <div className="spec-file-name">{screenForm.specFileName}</div>
                        <div className="spec-file-size">{(specContent.length / 1024).toFixed(1)} KB · {specContent.split('\n').length}줄</div>
                      </div>
                      <button
                        type="button"
                        className="spec-remove-btn"
                        onClick={e => { e.stopPropagation(); setSpecContent(''); setScreenForm(f => ({ ...f, specFileName: '' })) }}
                      >×</button>
                    </div>
                  ) : screenForm.specFileName ? (
                    <div className="spec-dropzone-attached">
                      <span className="spec-file-icon">📄</span>
                      <div>
                        <div className="spec-file-name">{screenForm.specFileName}</div>
                        <div className="spec-file-size">이미 저장됨 · 재업로드하려면 클릭</div>
                      </div>
                    </div>
                  ) : (
                    <div className="spec-dropzone-empty">
                      <span className="spec-drop-icon">⬆</span>
                      <span>Axure/Zeplin 기획 스펙 <strong>.md</strong> 또는 <strong>.txt</strong> 드래그&드롭</span>
                      <span className="spec-drop-sub">또는 클릭해서 파일 선택</span>
                    </div>
                  )}
                </div>

                <div className="screen-md-hint">
                  저장 시 <code>agent-system/shared/screens/{screenForm.id || 'SCREEN_ID'}.md</code> 자동 생성
                  {screenForm.specFileName && <> · <code>{screenForm.id || 'SCREEN_ID'}_spec.md</code> 포함</>}
                </div></>}

                <div className="form-actions">
                  {editScreen !== null && (
                    <button
                      type="button"
                      className="btn-danger"
                      onClick={() => { handleDeleteScreen(editScreen); setShowScreenForm(false); setEditScreen(null) }}
                    >
                      삭제
                    </button>
                  )}
                  <div style={{ flex: 1 }} />
                  <button type="button" className="btn-ghost" onClick={() => { setShowScreenForm(false); setEditScreen(null) }}>취소</button>
                  <button type="submit" className="btn-primary">{editScreen !== null ? '수정 완료' : '추가'}</button>
                </div>
              </form>
            </div>
          )}

          {(() => {
            const iosProjects = ['전체', ...Array.from(new Set(
              screens.filter(s => s.platform === 'iOS' && s.projectKey).map(s => s.projectKey)
            ))]
            if (iosProjects.length <= 1) return null
            return (
              <div className="project-filter-tabs">
                {iosProjects.map(p => (
                  <button
                    key={p}
                    className={`project-filter-tab ${projectFilter === p ? 'active' : ''}`}
                    onClick={() => setProjectFilter(p)}
                  >
                    {p}
                    <span className="project-filter-count">
                      {p === '전체'
                        ? screens.filter(s => s.platform === 'iOS').length
                        : screens.filter(s => s.platform === 'iOS' && s.projectKey === p).length}
                    </span>
                  </button>
                ))}
              </div>
            )
          })()}

          {(() => {
            const filteredScreens = screens
              .map((s, i) => ({ s, i }))
              .filter(({ s }) => s.platform === 'iOS')
              .filter(({ s }) => projectFilter === '전체' || s.projectKey === projectFilter)
            return filteredScreens.length === 0 ? (
              <div className="screen-platform-empty">등록된 스크린 없음</div>
            ) : (
              <div className="screen-table-wrap">
                <table className="screen-table">
                  <thead>
                    <tr>
                      <th>스크린 ID</th>
                      <th>스크린 이름</th>
                      <th>프로젝트</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredScreens.map(({ s, i }) => (
                      <tr key={i} className="screen-row" onClick={() => handleEditScreen(i)}>
                        <td><code className="code-cell">{s.id}</code></td>
                        <td>{s.name || <span className="table-empty-cell">—</span>}</td>
                        <td>
                            {s.projectKey
                              ? <span className="project-tag">{s.projectKey}</span>
                              : <span className="table-empty-cell">—</span>}
                          </td>
                        <td onClick={e => e.stopPropagation()}>
                          <div className="row-actions">
                            <button className="btn-action-xs edit" onClick={() => handleEditScreen(i)}>편집</button>
                            <button className="btn-action-xs delete" onClick={() => handleDeleteScreen(i)}>삭제</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          })()}
        </div>
      )}

      {activeTab === 'projects' && (
        <div className="tab-content">
          <div className="section-header">
            <div>
              <h2>프로젝트 설정</h2>
              <p className="section-desc">iOS 작업에 사용할 프로젝트 경로를 관리합니다</p>
            </div>
            {!showProjectForm && (
              <button className="btn-primary" onClick={() => { setShowProjectForm(true); setProjectForm({ label: '', path: '', color: '#3b82f6' }) }}>
                + 프로젝트 추가
              </button>
            )}
          </div>

          {showProjectForm && (
            <div className="form-card">
              <div className="form-card-header">
                <h3>새 프로젝트 추가</h3>
              </div>
              <form onSubmit={handleProjectSubmit} className="project-form">
                <div className="form-row">
                  <div className="form-group form-group-color">
                    <label>색상</label>
                    <input
                      type="color"
                      className="project-color-input"
                      value={projectForm.color || '#3b82f6'}
                      onChange={e => setProjectForm(f => ({ ...f, color: e.target.value }))}
                    />
                  </div>
                  <div className="form-group">
                    <label>프로젝트 이름</label>
                    <input
                      type="text"
                      placeholder="코나카드"
                      value={projectForm.label}
                      onChange={e => setProjectForm(f => ({ ...f, label: e.target.value }))}
                      required
                      autoFocus
                    />
                  </div>
                  <div className="form-group flex-2">
                    <label>프로젝트 경로</label>
                    <div className="project-path-wrap">
                      <input
                        type="text"
                        className={pathValidation ? (pathValidation.valid ? 'path-ok' : 'path-err') : ''}
                        placeholder="/path/to/your/ios-project"
                        value={projectForm.path}
                        onChange={e => { setProjectForm(f => ({ ...f, path: e.target.value })); validatePath(e.target.value) }}
                        required
                      />
                      {pathValidation && (
                        <div className={`path-validation ${pathValidation.valid ? 'ok' : 'err'}`}>
                          {pathValidation.valid
                            ? `✓ ${pathValidation.target?.split('/').pop()}`
                            : `✗ ${pathValidation.reason}`}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                <div className="form-actions">
                  <button type="button" className="btn-ghost" onClick={() => { setShowProjectForm(false); setPathValidation(null) }}>취소</button>
                  <button type="submit" className="btn-primary">추가</button>
                </div>
              </form>
            </div>
          )}

          <div className="project-list">
            {projects.length === 0 ? (
              <p className="branch-empty">등록된 프로젝트 없음</p>
            ) : (
              projects.map((p, i) => (
                <div key={i} className="project-list-item">
                  {/* 프로젝트 헤더 — 일반 / 인라인 편집 */}
                  {editingProjectIdx === i ? (
                    <div className="project-inline-edit">
                      <div className="project-inline-fields">
                        <input
                          type="color"
                          className="project-color-input project-color-input-inline"
                          value={editingProjectForm.color || '#3b82f6'}
                          onChange={e => setEditingProjectForm(f => ({ ...f, color: e.target.value }))}
                        />
                        <input
                          className="project-inline-input"
                          placeholder="프로젝트 이름"
                          value={editingProjectForm.label}
                          onChange={e => setEditingProjectForm(f => ({ ...f, label: e.target.value }))}
                          autoFocus
                        />
                        <div className="project-path-wrap">
                          <input
                            className={`project-inline-input project-inline-path ${pathValidation ? (pathValidation.valid ? 'path-ok' : 'path-err') : ''}`}
                            placeholder="/path/to/ios-project"
                            value={editingProjectForm.path}
                            onChange={e => { setEditingProjectForm(f => ({ ...f, path: e.target.value })); validatePath(e.target.value) }}
                            onKeyDown={e => { if (e.key === 'Enter') handleInlineProjectSave(i); if (e.key === 'Escape') setEditingProjectIdx(null) }}
                          />
                          {pathValidation && (
                            <div className={`path-validation ${pathValidation.valid ? 'ok' : 'err'}`}>
                              {pathValidation.valid
                                ? `✓ ${pathValidation.target?.split('/').pop()}`
                                : `✗ ${pathValidation.reason}`}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="project-inline-actions">
                        <button className="btn-ghost-sm" onClick={() => { setEditingProjectIdx(null); setPathValidation(null) }}>취소</button>
                        <button className="btn-primary-sm" onClick={() => handleInlineProjectSave(i)}>저장</button>
                      </div>
                    </div>
                  ) : (
                    <div className="project-item-top">
                      <div className="project-list-info">
                        <span className="project-color-swatch" style={{ background: p.color || '#3b82f6' }} />
                        <span className="project-list-label">{p.label}</span>
                        <code className="project-list-path">{p.path}</code>
                      </div>
                      <div className="project-list-actions">
                        <button className="btn-ghost-sm" onClick={() => handleInlineProjectEdit(i)}>편집</button>
                        <button className="btn-ghost-sm btn-ghost-sm-danger" onClick={() => deleteProject(i)}>삭제</button>
                      </div>
                    </div>
                  )}

                  {/* 스킴 서브리스트 */}
                  <div className="scheme-section">
                    <div className="scheme-section-header">
                      <span className="scheme-section-title">스킴</span>
                      {schemeFormProjectIdx !== i && (
                        <button className="scheme-add-btn" onClick={() => openSchemeForm(i, null)}>+ 추가</button>
                      )}
                    </div>

                    {(p.schemes || []).length === 0 && schemeFormProjectIdx !== i && (
                      <p className="scheme-empty">등록된 스킴 없음</p>
                    )}

                    {(p.schemes || []).map((s, j) => (
                      <div key={j} className="scheme-item">
                        {schemeFormProjectIdx === i && editSchemeIdx === j ? (
                          <form className="scheme-form" onSubmit={e => handleSchemeSubmit(e, i)}>
                            <input className="scheme-input scheme-input-grow" placeholder="스킴 이름 *" value={schemeForm.name} onChange={e => setSchemeForm(f => ({ ...f, name: e.target.value }))} required autoFocus />
                            <input className="scheme-input" placeholder="Configuration (예: Debug)" value={schemeForm.configuration} onChange={e => setSchemeForm(f => ({ ...f, configuration: e.target.value }))} />
                            <div className="scheme-form-actions">
                              <button type="button" className="btn-ghost-sm" onClick={closeSchemeForm}>취소</button>
                              <button type="submit" className="btn-primary-sm">저장</button>
                            </div>
                          </form>
                        ) : (
                          <div className="scheme-item-row">
                            <div className="scheme-item-info">
                              <span className="scheme-item-name">{s.name}</span>
                              {s.configuration && <span className="scheme-item-meta">{s.configuration}</span>}
                            </div>
                            <div className="scheme-item-actions">
                              <button className="btn-ghost-sm" onClick={() => openSchemeForm(i, j)}>편집</button>
                              <button className="btn-ghost-sm btn-ghost-sm-danger" onClick={() => deleteScheme(i, j)}>삭제</button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}

                    {/* 새 스킴 추가 인라인 폼 */}
                    {schemeFormProjectIdx === i && editSchemeIdx === null && (
                      <form className="scheme-form" onSubmit={e => handleSchemeSubmit(e, i)}>
                        <input className="scheme-input scheme-input-grow" placeholder="스킴 이름 *" value={schemeForm.name} onChange={e => setSchemeForm(f => ({ ...f, name: e.target.value }))} required autoFocus />
                        <input className="scheme-input" placeholder="Configuration (예: Debug)" value={schemeForm.configuration} onChange={e => setSchemeForm(f => ({ ...f, configuration: e.target.value }))} />
                        <div className="scheme-form-actions">
                          <button type="button" className="btn-ghost-sm" onClick={closeSchemeForm}>취소</button>
                          <button type="submit" className="btn-primary-sm">추가</button>
                        </div>
                      </form>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {activeTab === 'projects' && (
        <div className="tab-content migrate-section">
          <div className="section-header">
            <div>
              <h2>작업 이력 마이그레이션</h2>
              <p className="section-desc">localStorage에 저장된 완료 작업을 서버 이력 파일로 옮깁니다. 중복은 자동으로 제외됩니다.</p>
            </div>
          </div>
          <div className="migrate-row">
            <button className="btn-primary" onClick={handleMigrate} disabled={migrating}>
              {migrating ? '마이그레이션 중...' : '기존 데이터 마이그레이션'}
            </button>
            {migrateResult && (
              migrateResult.ok
                ? <span className="migrate-ok">✓ {migrateResult.total}개 중 {migrateResult.added}개 추가됨 (중복 {migrateResult.total - migrateResult.added}개 제외)</span>
                : <span className="migrate-err">오류가 발생했습니다. 서버가 실행 중인지 확인하세요.</span>
            )}
          </div>
        </div>
      )}

      {activeTab === 'guide' && (
        <div className="tab-content">
          <div className="guide-list">
            {[
              { key: 'master', label: 'MASTER.md', desc: '전역 시스템 가이드', value: masterGuide, setter: setMasterGuide },
              { key: 'ios', label: 'iOS 에이전트 CLAUDE.md', desc: 'iOS 에이전트 작업 가이드', value: iosGuide, setter: setIosGuide },
            ].map(g => (
              <div key={g.key} className="guide-card">
                <div className="guide-card-header">
                  <div>
                    <div className="guide-filename">{g.label}</div>
                    <div className="guide-desc">{g.desc}</div>
                  </div>
                  <div className="guide-actions">
                    {savedGuide === g.key && <span className="saved-badge">✓ 저장됨</span>}
                    {editingGuide === g.key ? (
                      <>
                        <button className="btn-ghost-sm" onClick={() => setEditingGuide(null)}>취소</button>
                        <button className="btn-primary-sm" onClick={() => handleSaveGuide(g.key)}>저장</button>
                      </>
                    ) : (
                      <button className="btn-ghost-sm" onClick={() => setEditingGuide(g.key)}>편집</button>
                    )}
                  </div>
                </div>
                {editingGuide === g.key ? (
                  <textarea
                    className="guide-editor"
                    value={g.value}
                    onChange={e => g.setter(e.target.value)}
                    rows={20}
                  />
                ) : (
                  <pre className="guide-preview">{g.value}</pre>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      {showTour && <TourOverlay steps={TOUR_STEPS} onClose={closeTour} />}
    </div>
  )
}
