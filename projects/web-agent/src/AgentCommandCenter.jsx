import { useState, useEffect } from 'react'
import Sidebar from './components/Sidebar'
import Monitoring from './pages/Monitoring'
import Agents from './pages/Agents'
import TaskManagement from './pages/TaskManagement'
import Settings from './pages/Settings'
import TaskDetail from './pages/TaskDetail'
import TourOverlay from './components/TourOverlay'
import './AgentCommandCenter.css'

const TOUR_KEY = 'acc_tour_done'

const SIDEBAR_STEPS = [
  { title: 'Agent System에 오신 것을 환영합니다!', desc: 'Claude AI 에이전트가 iOS 작업을 자동으로 처리하는 시스템입니다.\n주요 기능을 간단히 소개합니다.', target: null },
  { title: '모니터링', desc: '전체 작업 현황과 활동 로그를 실시간으로 확인합니다.', target: '[data-tour="nav-monitoring"]' },
  { title: '작업 관리', desc: '새 작업을 추가하고 상태를 관리합니다.\n프로젝트와 스킴을 지정하면 에이전트가 자동으로 처리합니다.', target: '[data-tour="nav-tasks"]' },
  { title: '에이전트', desc: '프로젝트별 Claude 에이전트 상태를 확인합니다.\n실시간 로그와 세션 초기화를 지원합니다.', target: '[data-tour="nav-agents"]' },
  { title: '설정 — 먼저 여기부터!', desc: 'iOS 프로젝트 경로와 빌드 스킴을 등록합니다.\n처음 사용 시 반드시 여기서 프로젝트를 추가하세요.', target: '[data-tour="nav-settings"]' },
  { title: 'Claude 사용량 & 시스템 상태', desc: '5시간·7일 단위 API 사용량을 실시간으로 확인합니다.\n시스템 오류 발생 시 하단에 표시됩니다.', target: '[data-tour="sidebar-footer"]' },
]

export default function AgentCommandCenter() {
  const [activePage, setActivePage]         = useState('monitoring')
  const [activeTask, setActiveTask]         = useState(null)
  const [platformFilter, setPlatformFilter] = useState(null)
  const [pageKey, setPageKey]               = useState(0)
  const [showTour, setShowTour]             = useState(false)

  useEffect(() => {
    if (!localStorage.getItem(TOUR_KEY)) setShowTour(true)
  }, [])

  const closeTour = () => {
    localStorage.setItem(TOUR_KEY, '1')
    setShowTour(false)
  }

  // iOS 에이전트가 파일을 이동하면 웹 UI에 반영
  useEffect(() => {
    const sync = async () => {
      try {
        const res = await fetch('/api/task-queue')
        if (!res.ok) return
        const fileTasks = await res.json()
        if (!fileTasks.length) return
        const stored = JSON.parse(localStorage.getItem('acc_tasks') || '[]')
        let changed = false
        const merged = stored.map(t => {
          const ft = fileTasks.find(f => f.id === t.id)
          const statusChanged = ft && ft.status !== t.status
          const summaryChanged = ft && ft.agentSummary && ft.agentSummary !== t.agentSummary
          const reportsChanged = ft && ft.agentReports && JSON.stringify(ft.agentReports) !== JSON.stringify(t.agentReports)
          if (statusChanged || summaryChanged || reportsChanged) {
            changed = true
            return { ...t, status: ft.status, agentSummary: ft.agentSummary || t.agentSummary, agentReports: ft.agentReports || t.agentReports, updated_at: ft.updated_at || t.updated_at }
          }
          return t
        })
        if (changed) localStorage.setItem('acc_tasks', JSON.stringify(merged))
      } catch {}
    }
    sync()
    const id = setInterval(sync, 3000)
    return () => clearInterval(id)
  }, [])

  const openTask = (task) => setActiveTask(task)
  const closeTask = () => setActiveTask(null)

  const navigateTo = (page, opts = {}) => {
    // 같은 페이지를 다시 누르거나 상세화면에서 누르면 → 완전 초기화
    if (page === activePage || activeTask) {
      setPageKey(k => k + 1)
    }
    setActiveTask(null)
    setPlatformFilter(opts.platform || null)
    setActivePage(page)
  }

  const renderPage = () => {
    if (activeTask) {
      return (
        <TaskDetail
          task={activeTask}
          onBack={closeTask}
          onTaskUpdate={(updated) => setActiveTask(updated)}
        />
      )
    }
    switch (activePage) {
      case 'monitoring':
        return <Monitoring key={pageKey} onOpenTask={openTask} onOpenPlatform={(p) => navigateTo('tasks', { platform: p })} />
      case 'agents':
        return <Agents key={pageKey} onOpenTask={openTask} />
      case 'tasks':
        return <TaskManagement key={pageKey} onOpenTask={openTask} platformFilter={platformFilter} />
      case 'settings':
        return <Settings key={pageKey} />
      default:
        return <Monitoring key={pageKey} onOpenTask={openTask} onOpenPlatform={(p) => navigateTo('tasks', { platform: p })} />
    }
  }

  return (
    <div className="acc-root">
      <Sidebar activePage={activePage} onNavigate={(p) => navigateTo(p)} onStartTour={() => setShowTour(true)} />
      <main className="acc-main">
        {renderPage()}
      </main>
      {showTour && <TourOverlay steps={SIDEBAR_STEPS} onClose={closeTour} />}
    </div>
  )
}
