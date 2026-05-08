#!/usr/bin/env node

/**
 * iOS Agent Watcher — 프로젝트별 병렬 에이전트
 * - shared/projects.json 을 읽어 projectKey 별로 에이전트 실행
 * - 프로젝트 간 병렬, 프로젝트 내 직렬
 * - --resume 으로 세션 유지 (shared/agent-sessions.json)
 * - HTTP 서버 (포트 3002)
 *   GET  /status              → 전체 프로젝트 에이전트 상태
 *   GET  /logs?project=X      → 특정 프로젝트 에이전트 로그
 *   POST /stop                → 특정 프로젝트 에이전트 중단 { project }
 *   POST /session-reset       → 특정 프로젝트 세션 초기화  { project }
 */

import { spawn, execSync } from 'child_process'
import fs from 'fs'
import http from 'http'
import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')

const PENDING_DIR    = path.join(ROOT, 'shared/task-queue/pending')
const COMPLETED_DIR  = path.join(ROOT, 'shared/task-queue/completed')
const IOS_AGENT_DIR  = path.join(ROOT, 'projects/ios-agent')
const PROJECTS_FILE  = path.join(ROOT, 'shared/projects.json')
const SESSIONS_FILE  = path.join(ROOT, 'shared/agent-sessions.json')
const POLL_INTERVAL  = 3000
const CONTROL_PORT   = 3002
const MAX_FAILURES   = 3
const BACKOFF_MS     = [30_000, 120_000, 300_000]
const MAX_LOG_LINES  = 300

// ── 상태 ──────────────────────────────────────────────────────────────────
// { [projectKey]: { proc, pid, logs, startTime, turns, status, consecutiveFailures } }
const activeAgents = {}

// 세션 ID: { [projectKey]: sessionId }
let sessions = {}

// ── 유틸 ──────────────────────────────────────────────────────────────────
function loadProjectsFromTasks() {
  const map = {}
  for (const dir of [PENDING_DIR, path.join(ROOT, 'shared/task-queue/in-progress')]) {
    try {
      for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.json'))) {
        try {
          const t = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8'))
          if (t.platform === 'iOS' && t.projectKey && t.projectPath && !map[t.projectKey]) {
            map[t.projectKey] = { label: t.projectKey, path: t.projectPath }
          }
        } catch {}
      }
    } catch {}
  }
  return Object.values(map)
}

function loadProjects() {
  try {
    const list = JSON.parse(fs.readFileSync(PROJECTS_FILE, 'utf-8'))
    if (list.length > 0) return list
  } catch {}
  // projects.json 없거나 비어있으면 task 파일에서 추출
  const fallback = loadProjectsFromTasks()
  if (fallback.length > 0) {
    console.log(`⚠️  projects.json 없음 — 태스크에서 프로젝트 ${fallback.length}개 추출 (${fallback.map(p => p.label).join(', ')})`)
  }
  return fallback
}

function loadSessions() {
  try { sessions = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf-8')) } catch { sessions = {} }
}

function saveSessions() {
  try { fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2)) } catch {}
}

function getPendingTasksForProject(projectKey) {
  try {
    return fs.readdirSync(PENDING_DIR)
      .filter(f => f.endsWith('.json'))
      .filter(f => {
        try {
          const t = JSON.parse(fs.readFileSync(path.join(PENDING_DIR, f), 'utf-8'))
          return t.platform === 'iOS' && t.projectKey === projectKey
        } catch { return false }
      })
  } catch { return [] }
}

function formatTokens(n) {
  if (!n) return '0'
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = ''
    req.on('data', c => (body += c))
    req.on('end', () => { try { resolve(JSON.parse(body)) } catch { resolve({}) } })
  })
}

function appendActivityLog(entry) {
  const logFile = path.join(ROOT, 'shared/activity-logs.json')
  try {
    const logs = fs.existsSync(logFile) ? JSON.parse(fs.readFileSync(logFile, 'utf-8')) : []
    logs.push({ id: Date.now(), time: new Date().toISOString(), ...entry })
    fs.writeFileSync(logFile, JSON.stringify(logs.slice(-500), null, 2))
  } catch {}
}

// ── Git diff 필터 ─────────────────────────────────────────────────────────
const DIFF_EXCLUDE = [
  /Package\.resolved/, /Package\.swift/, /Podfile\.lock/,
  /\.pbxproj/, /\.xcworkspace/, /xcuserdata/, /DerivedData/,
  /\.claude\//, /CLAUDE\.md/, /\.gitignore/, /\.git\//,
  /node_modules\//, /\.log$/, /\.DS_Store/,
]
const DIFF_INCLUDE_EXT = ['.swift', '.m', '.h', '.mm', '.storyboard', '.xib', '.plist', '.json', '.entitlements', '.metal', '.strings']
const DIFF_MAX_LINES = 600

function filterDiff(rawDiff) {
  const sections = rawDiff.split(/^(?=diff --git )/m).filter(s => s.startsWith('diff --git'))
  const kept = sections.filter(section => {
    const m = section.match(/^diff --git a\/(.*?) b\//)
    if (!m) return false
    const fp = m[1]
    if (DIFF_EXCLUDE.some(p => p.test(fp))) return false
    const ext = fp.includes('.') ? '.' + fp.split('.').pop() : ''
    return DIFF_INCLUDE_EXT.includes(ext)
  })
  if (!kept.length) return ''
  const lines = kept.join('').split('\n')
  if (lines.length > DIFF_MAX_LINES) {
    return lines.slice(0, DIFF_MAX_LINES).join('\n') + `\n\\ ... (${lines.length - DIFF_MAX_LINES}줄 생략)`
  }
  return kept.join('').trim()
}

// ── 에이전트 실행 ─────────────────────────────────────────────────────────
function runAgent(projectKey, projectPath, projectLabel) {
  if (activeAgents[projectKey]?.proc) {
    console.log(`⏭  [${projectLabel}] 에이전트 이미 실행 중`)
    return
  }

  const tasks = getPendingTasksForProject(projectKey)
  if (tasks.length === 0) return

  const runStartTime = new Date().toISOString()
  console.log(`\n📋 [${projectLabel}] 대기 작업 ${tasks.length}개 → 에이전트 실행`)

  // 에이전트 실행 전 HEAD 기록 (diff 범위 계산용)
  let startHead = null
  try { startHead = execSync('git rev-parse HEAD', { cwd: projectPath, encoding: 'utf-8' }).trim() } catch {}

  const agentState = {
    proc: null,
    pid: null,
    logs: [],
    startTime: runStartTime,
    turns: 0,
    status: 'running',
    consecutiveFailures: activeAgents[projectKey]?.consecutiveFailures ?? 0,
    label: projectLabel,
    projectPath,
  }
  activeAgents[projectKey] = agentState

  const prompt = [
    `당신은 iOS 에이전트입니다.`,
    `담당 프로젝트: ${projectLabel}`,
    `프로젝트 경로: ${projectPath}`,
    ``,
    `${PENDING_DIR} 폴더에서 platform이 "iOS"이고 projectKey가 "${projectKey}"인 작업 파일을 찾아서 처리하세요.`,
    `다른 projectKey의 작업은 절대 처리하지 마세요.`,
    ``,
    `CLAUDE.md의 작업 흐름 지시에 따라 처리하되, 파일 수정 경로는 모두 ${projectPath} 기준으로 합니다.`,
  ].join('\n')

  const args = [
    '--output-format', 'stream-json',
    '--verbose',
    '--max-turns', '30',
    '-p', prompt,
    '--dangerously-skip-permissions',
  ]

  if (sessions[projectKey]) {
    args.push('--resume', sessions[projectKey])
    console.log(`   세션 재개: ${sessions[projectKey].slice(0, 12)}...`)
  }

  const proc = spawn('claude', args, {
    cwd: IOS_AGENT_DIR,
    env: {
      ...process.env,
      ...(process.env.CERT_PATH ? { NODE_EXTRA_CA_CERTS: process.env.CERT_PATH } : {}),
    },
    stdio: ['inherit', 'pipe', 'inherit'],
  })

  agentState.proc = proc
  agentState.pid = proc.pid
  console.log(`   PID: ${proc.pid}`)

  let tokenUsage = null
  let totalCostUsd = null

  proc.stdout.on('data', (data) => {
    for (const line of data.toString().split('\n')) {
      if (!line.trim()) continue
      try {
        const ev = JSON.parse(line)
        if (ev.type === 'assistant') {
          const texts = (ev.message?.content || []).filter(c => c.type === 'text').map(c => c.text)
          if (texts.length) {
            const lines = texts.join('').split('\n').filter(l => l.trim())
            agentState.logs.push(...lines)
            if (agentState.logs.length > MAX_LOG_LINES) {
              agentState.logs = agentState.logs.slice(-MAX_LOG_LINES)
            }
            process.stdout.write(texts.join(''))
            agentState.turns++
          }
        } else if (ev.type === 'result') {
          tokenUsage = ev.usage || null
          totalCostUsd = ev.total_cost_usd ?? null
          if (ev.session_id) {
            sessions[projectKey] = ev.session_id
            saveSessions()
            console.log(`\n   세션 저장: ${ev.session_id.slice(0, 12)}...`)
          }
        }
      } catch { /* non-JSON line */ }
    }
  })

  proc.on('close', (code) => {
    console.log(`\n${'─'.repeat(60)}`)
    console.log(`${code === 0 ? '✅' : '❌'} [${projectLabel}] 완료 (exit: ${code})`)

    agentState.status = code === 0 ? 'idle' : 'error'
    agentState.proc = null
    agentState.pid = null

    appendActivityLog({
      agent: 'ios',
      type: code === 0 ? 'success' : 'error',
      message: `[${projectLabel}] ${code === 0 ? '에이전트 작업 완료' : `에이전트 실패 (exit ${code})`}`,
    })

    // 토큰 사용량 기록
    if (tokenUsage) {
      try {
        const files = fs.readdirSync(COMPLETED_DIR).filter(f => f.endsWith('.json'))
        let updated = 0
        for (const file of files) {
          const p = path.join(COMPLETED_DIR, file)
          const task = JSON.parse(fs.readFileSync(p, 'utf-8'))
          if (task.projectKey === projectKey && task.updated_at >= runStartTime && task.agentReports?.length > 0) {
            const reports = [...task.agentReports]
            reports[reports.length - 1] = {
              ...reports[reports.length - 1],
              tokenUsage: {
                input_tokens: tokenUsage.input_tokens || 0,
                output_tokens: tokenUsage.output_tokens || 0,
                cache_read_input_tokens: tokenUsage.cache_read_input_tokens || 0,
                total_cost_usd: totalCostUsd,
              },
            }
            fs.writeFileSync(p, JSON.stringify({ ...task, agentReports: reports }, null, 2))
            updated++
          }
        }
        const cacheRead = tokenUsage.cache_read_input_tokens || 0
        const totalInput = (tokenUsage.input_tokens || 0) + cacheRead
        const total = totalInput + (tokenUsage.output_tokens || 0)
        const cacheStr = cacheRead > 0 ? ` (캐시 ${formatTokens(cacheRead)})` : ''
        console.log(`📊 토큰: 입력 ${formatTokens(totalInput)}${cacheStr}, 출력 ${formatTokens(tokenUsage.output_tokens)} (총 ${formatTokens(total)})${totalCostUsd != null ? ` · $${totalCostUsd.toFixed(4)}` : ''}`)
        if (updated > 0) console.log(`   ${updated}개 작업에 사용량 기록됨`)
      } catch (e) { console.warn('   토큰 기록 실패:', e.message) }
    }

    // Git diff 캡처 (커밋된 변경 + 미커밋 변경 모두 포함)
    if (startHead && code === 0) {
      try {
        const committed   = execSync(`git diff ${startHead} HEAD`, { cwd: projectPath, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 })
        const uncommitted = execSync('git diff HEAD', { cwd: projectPath, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 })
        const filtered = filterDiff(committed + uncommitted)
        if (filtered) {
          const files = fs.readdirSync(COMPLETED_DIR).filter(f => f.endsWith('.json'))
          let updated = 0
          for (const file of files) {
            const p = path.join(COMPLETED_DIR, file)
            const task = JSON.parse(fs.readFileSync(p, 'utf-8'))
            if (task.projectKey === projectKey && task.updated_at >= runStartTime) {
              const agentDiffs = [...(task.agentDiffs || []), { diff: filtered, capturedAt: new Date().toISOString() }]
              fs.writeFileSync(p, JSON.stringify({ ...task, agentDiffs }, null, 2))
              updated++
            }
          }
          if (updated > 0) console.log(`   diff 기록: ${updated}개 작업, ${filtered.split('\n').length}줄`)
        } else {
          console.log('   코드 변경 없음 (diff 없음)')
        }
      } catch (e) { console.warn('   diff 기록 실패:', e.message) }
    }

    if (code === 143 || code === 130) {
      console.log(`   [${projectLabel}] 사용자 중단 — 재시도 없음`)
      agentState.consecutiveFailures = 0
      agentState.userStopped = true
      agentState.stoppedTaskFiles = new Set(getPendingTasksForProject(projectKey))
      return
    }

    if (code !== 0) {
      agentState.consecutiveFailures++
      if (agentState.consecutiveFailures >= MAX_FAILURES) {
        console.error(`\n🚫 [${projectLabel}] 연속 ${agentState.consecutiveFailures}회 실패 — 자동 재시도 중단`)
        return
      }
      const delay = BACKOFF_MS[agentState.consecutiveFailures - 1] ?? BACKOFF_MS[BACKOFF_MS.length - 1]
      console.warn(`\n⚠️  [${projectLabel}] 실패 (${agentState.consecutiveFailures}/${MAX_FAILURES}회) — ${delay / 1000}초 후 재시도`)
      setTimeout(() => {
        if (getPendingTasksForProject(projectKey).length > 0) runAgent(projectKey, projectPath, projectLabel)
      }, delay)
      return
    }

    agentState.consecutiveFailures = 0

    // 완료 후 남은 작업 확인
    if (getPendingTasksForProject(projectKey).length > 0) {
      console.log(`📋 [${projectLabel}] 남은 작업 있음 → 재실행`)
      setTimeout(() => runAgent(projectKey, projectPath, projectLabel), 2000)
    }
  })

  proc.on('error', (err) => {
    console.error(`❌ [${projectLabel}] 에이전트 실행 오류: ${err.message}`)
    agentState.status = 'error'
    agentState.proc = null
    agentState.pid = null
  })
}

// ── 폴링 ──────────────────────────────────────────────────────────────────
function poll() {
  const projects = loadProjects()
  for (const p of projects) {
    const key = p.label
    const tasks = getPendingTasksForProject(key)
    if (tasks.length === 0 || activeAgents[key]?.proc) continue

    const st = activeAgents[key]
    if (st?.userStopped) {
      const hasNewTask = tasks.some(f => !st.stoppedTaskFiles?.has(f))
      if (!hasNewTask) continue
      // 새 태스크가 추가됐으면 중단 플래그 해제 후 시작
      st.userStopped = false
      st.stoppedTaskFiles = null
    }

    runAgent(key, p.path, p.label)
  }
}

// ── HTTP 제어 서버 ─────────────────────────────────────────────────────────
const controlServer = http.createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end() }

  const url = new URL(req.url, `http://localhost:${CONTROL_PORT}`)
  const pathname = url.pathname

  // GET /status — 전체 프로젝트 상태
  if (pathname === '/status' && req.method === 'GET') {
    const projects = loadProjects()
    const result = projects.map(p => {
      const st = activeAgents[p.label]
      return {
        key:       p.label,
        label:     p.label,
        path:      p.path,
        running:   !!(st?.proc),
        pid:       st?.pid ?? null,
        sessionId: sessions[p.label] ?? null,
        turns:     st?.turns ?? 0,
        startTime: st?.startTime ?? null,
        status:    st?.status ?? 'idle',
      }
    })
    return res.end(JSON.stringify({ projects: result }))
  }

  // GET /logs?project=X — 특정 프로젝트 로그
  if (pathname === '/logs' && req.method === 'GET') {
    const key = url.searchParams.get('project')
    const st = activeAgents[key]
    return res.end(JSON.stringify({
      logs:    st?.logs ?? [],
      running: !!(st?.proc),
      status:  st?.status ?? 'idle',
    }))
  }

  // POST /stop — 특정 프로젝트 에이전트 중단
  if (pathname === '/stop' && req.method === 'POST') {
    const { project } = await readBody(req)
    const st = activeAgents[project]
    if (!st?.proc) return res.end(JSON.stringify({ ok: false, error: '실행 중인 에이전트 없음' }))
    try {
      try { process.kill(-st.proc.pid, 'SIGTERM') } catch { st.proc.kill('SIGTERM') }
      console.log(`\n🛑 [${project}] 에이전트 강제 종료 (PID: ${st.pid})`)
      return res.end(JSON.stringify({ ok: true }))
    } catch (e) {
      return res.end(JSON.stringify({ ok: false, error: e.message }))
    }
  }

  // POST /session-reset — 특정 프로젝트 세션 초기화
  if (pathname === '/session-reset' && req.method === 'POST') {
    const { project } = await readBody(req)
    if (activeAgents[project]?.proc) {
      return res.end(JSON.stringify({ ok: false, error: '실행 중에는 세션을 초기화할 수 없습니다' }))
    }
    const had = !!sessions[project]
    delete sessions[project]
    saveSessions()
    console.log(`🔄 [${project}] 세션 초기화${had ? ` (이전: ${sessions[project]?.slice(0,12)}...)` : ''}`)
    appendActivityLog({ agent: 'ios', type: 'info', message: `[${project}] 세션 초기화됨` })
    return res.end(JSON.stringify({ ok: true }))
  }

  res.writeHead(404)
  res.end(JSON.stringify({ error: 'not found' }))
})

controlServer.listen(CONTROL_PORT, () => {
  console.log(`🌐 제어 서버 시작 (포트 ${CONTROL_PORT})`)
})

// ── 시작 ──────────────────────────────────────────────────────────────────
console.log('👀 iOS Agent Watcher 시작 (프로젝트별 병렬 모드)')
console.log(`   감시 폴더: ${PENDING_DIR}`)
console.log(`   폴링 간격: ${POLL_INTERVAL / 1000}초\n`)

loadSessions()

const projects = loadProjects()
if (projects.length === 0) {
  console.log('⚠️  등록된 프로젝트 없음 — 설정에서 프로젝트를 추가하세요')
} else {
  console.log(`등록된 프로젝트: ${projects.map(p => p.label).join(', ')}`)
}

// 시작 시 즉시 체크
poll()

setInterval(poll, POLL_INTERVAL)
