import { useState, useEffect } from 'react'
import Sidebar from './components/Sidebar'
import Monitoring from './pages/Monitoring'
import TaskManagement from './pages/TaskManagement'
import Settings from './pages/Settings'
import TaskDetail from './pages/TaskDetail'
import './AgentCommandCenter.css'

export default function AgentCommandCenter() {
  const [activePage, setActivePage]         = useState('monitoring')
  const [activeTask, setActiveTask]         = useState(null)
  const [platformFilter, setPlatformFilter] = useState(null)
  const [pageKey, setPageKey]               = useState(0)

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
      <Sidebar activePage={activePage} onNavigate={(p) => navigateTo(p)} />
      <main className="acc-main">
        {renderPage()}
      </main>
    </div>
  )
}
