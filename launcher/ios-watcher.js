#!/usr/bin/env node

/**
 * iOS Agent Watcher
 * pending/ 폴더를 감시하다가 변화가 생기면 iOS 에이전트를 자동 실행합니다.
 * HTTP 서버 (포트 3002): /status, /stop 엔드포인트 제공
 */

import { spawn } from 'child_process'
import fs from 'fs'
import http from 'http'
import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')

const PENDING_DIR = path.join(ROOT, 'shared/task-queue/pending')
const IOS_AGENT_DIR = path.join(ROOT, 'projects/ios-agent')
const LOCK_FILE = '/tmp/ios-agent-running.lock'
const POLL_INTERVAL = 3000
const CONTROL_PORT = 3002

let lastSnapshot = new Set()
let isRunning = false
let currentAgent = null
let consecutiveFailures = 0
const MAX_FAILURES = 3
const BACKOFF_MS = [30_000, 120_000, 300_000] // 30초, 2분, 5분

function getPendingFiles() {
  try {
    const files = fs.readdirSync(PENDING_DIR).filter(f => f.endsWith('.json'))
    return new Set(files.filter(f => {
      try {
        const task = JSON.parse(fs.readFileSync(`${PENDING_DIR}/${f}`, 'utf-8'))
        return task.platform === 'iOS'
      } catch {
        return false
      }
    }))
  } catch {
    return new Set()
  }
}

function hasChanged(current, previous) {
  if (current.size !== previous.size) return true
  for (const f of current) if (!previous.has(f)) return true
  return false
}

const COMPLETED_DIR = path.join(ROOT, 'shared/task-queue/completed')

function formatTokens(n) {
  if (!n) return '0'
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
}

function runAgent() {
  if (isRunning) {
    console.log('⏭  에이전트 이미 실행 중 — 완료 후 재확인')
    return
  }

  const files = getPendingFiles()
  if (files.size === 0) return

  isRunning = true
  const runStartTime = new Date().toISOString()
  console.log(`\n📋 대기 작업 ${files.size}개 감지 → iOS 에이전트 실행`)
  console.log(`   ${[...files].join(', ')}`)

  try { fs.writeFileSync(LOCK_FILE, String(Date.now())) } catch {}

  const agent = spawn(
    'claude',
    [
      '--output-format', 'stream-json',
      '--verbose',
      '--max-turns', '20',
      '-p',
      'shared/task-queue/pending 폴더에 처리할 작업이 있습니다. CLAUDE.md의 지시에 따라 즉시 처리해주세요.',
      '--dangerously-skip-permissions',
    ],
    {
      cwd: IOS_AGENT_DIR,
      env: { ...process.env, ...(process.env.CERT_PATH ? { NODE_EXTRA_CA_CERTS: process.env.CERT_PATH } : {}) },
      stdio: ['inherit', 'pipe', 'inherit'],
    }
  )

  let tokenUsage = null
  let totalCostUsd = null

  agent.stdout.on('data', (data) => {
    for (const line of data.toString().split('\n')) {
      if (!line.trim()) continue
      try {
        const ev = JSON.parse(line)
        if (ev.type === 'assistant') {
          const texts = (ev.message?.content || []).filter(c => c.type === 'text').map(c => c.text)
          if (texts.length) process.stdout.write(texts.join(''))
        } else if (ev.type === 'result') {
          tokenUsage = ev.usage || null
          totalCostUsd = ev.total_cost_usd ?? null
        }
      } catch { process.stdout.write(line + '\n') }
    }
  })

  currentAgent = agent
  console.log(`   PID: ${agent.pid}`)

  agent.on('close', (code) => {
    console.log(`\n${'─'.repeat(60)}`)
    console.log(`${code === 0 ? '✅ 작업 완료' : '❌ 작업 실패'} (exit: ${code})`)
    try { fs.unlinkSync(LOCK_FILE) } catch {}
    isRunning = false
    currentAgent = null

    // 토큰 사용량을 완료된 작업의 최신 agentReport에 기록
    if (tokenUsage) {
      try {
        const files = fs.readdirSync(COMPLETED_DIR).filter(f => f.endsWith('.json'))
        let updated = 0
        for (const file of files) {
          const p = `${COMPLETED_DIR}/${file}`
          const task = JSON.parse(fs.readFileSync(p, 'utf-8'))
          if (task.updated_at >= runStartTime && task.agentReports?.length > 0) {
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
        const total = (tokenUsage.input_tokens || 0) + (tokenUsage.output_tokens || 0)
        console.log(`📊 토큰: 입력 ${formatTokens(tokenUsage.input_tokens)}, 출력 ${formatTokens(tokenUsage.output_tokens)} (총 ${formatTokens(total)})${totalCostUsd != null ? ` · $${totalCostUsd.toFixed(4)}` : ''}`)
        if (updated > 0) console.log(`   ${updated}개 작업에 사용량 기록됨`)
      } catch (e) { console.warn('   토큰 기록 실패:', e.message) }
    }

    if (code !== 0) {
      // SIGTERM(143) / SIGINT(130) = 사용자가 의도적으로 중단 → 재시도 없음
      if (code === 143 || code === 130) {
        console.log('   사용자에 의해 중단됨 — 재시도하지 않습니다.')
        return
      }
      consecutiveFailures++
      if (consecutiveFailures >= MAX_FAILURES) {
        console.error(`\n🚫 연속 ${consecutiveFailures}회 실패 — 자동 재시도 중단`)
        console.error('   토큰 한도 초과 또는 오류를 확인하고 watcher를 재시작하세요.')
        return
      }
      const delay = BACKOFF_MS[consecutiveFailures - 1] ?? BACKOFF_MS[BACKOFF_MS.length - 1]
      console.warn(`\n⚠️  실패 (${consecutiveFailures}/${MAX_FAILURES}회) — ${delay / 1000}초 후 재시도`)
      setTimeout(() => {
        lastSnapshot = getPendingFiles()
        if (lastSnapshot.size > 0) runAgent()
      }, delay)
      return
    }

    consecutiveFailures = 0
    lastSnapshot = getPendingFiles()
    if (lastSnapshot.size > 0) {
      console.log('📋 아직 남은 작업 있음 → 재실행')
      setTimeout(runAgent, 2000)
    }
  })

  agent.on('error', (err) => {
    console.error('❌ 에이전트 실행 오류:', err.message)
    console.error('   claude CLI가 PATH에 있는지 확인하세요.')
    try { fs.unlinkSync(LOCK_FILE) } catch {}
    isRunning = false
    currentAgent = null
  })
}

function stopAgent() {
  if (!currentAgent) return { ok: false, error: '실행 중인 에이전트 없음' }
  try {
    // 프로세스 그룹 전체 종료 시도, 실패하면 단일 프로세스 종료
    try {
      process.kill(-currentAgent.pid, 'SIGTERM')
    } catch {
      currentAgent.kill('SIGTERM')
    }
    console.log(`\n🛑 에이전트 강제 종료 요청 (PID: ${currentAgent.pid})`)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e.message }
  }
}

// HTTP 제어 서버 (포트 3002)
const controlServer = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    return res.end()
  }

  if (req.url === '/status' && req.method === 'GET') {
    res.end(JSON.stringify({ running: isRunning, pid: currentAgent?.pid ?? null }))
    return
  }

  if (req.url === '/stop' && req.method === 'POST') {
    const result = stopAgent()
    res.end(JSON.stringify(result))
    return
  }

  res.writeHead(404)
  res.end(JSON.stringify({ error: 'not found' }))
})

controlServer.listen(CONTROL_PORT, () => {
  console.log(`🌐 제어 서버 시작 (포트 ${CONTROL_PORT})`)
})

function poll() {
  const current = getPendingFiles()
  if (hasChanged(current, lastSnapshot)) {
    console.log(`\n🔔 변화 감지: [${[...lastSnapshot].join(', ')}] → [${[...current].join(', ')}]`)
    lastSnapshot = current
    runAgent()
  } else {
    lastSnapshot = current
  }
}

// 시작
console.log('👀 iOS Agent Watcher 시작')
console.log(`   감시 폴더: ${PENDING_DIR}`)
console.log(`   에이전트:  ${IOS_AGENT_DIR}`)
console.log(`   폴링 간격: ${POLL_INTERVAL / 1000}초\n`)

try { fs.unlinkSync(LOCK_FILE) } catch {}

lastSnapshot = getPendingFiles()
console.log(`현재 대기 작업: ${lastSnapshot.size}개`)

// 시작 시 이미 pending 작업이 있으면 즉시 실행
if (lastSnapshot.size > 0) {
  console.log('🚀 시작 시 대기 작업 발견 → 즉시 실행')
  runAgent()
}

setInterval(poll, POLL_INTERVAL)
