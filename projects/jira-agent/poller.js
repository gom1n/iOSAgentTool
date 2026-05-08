import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { searchIssues } from './jiraClient.js'
import { mapIssueToTask } from './taskMapper.js'


const __dirname   = path.dirname(fileURLToPath(import.meta.url))
const STATE_FILE  = path.join(__dirname, 'state', 'processed-issues.json')
const PENDING_DIR = path.join(__dirname, '../../shared/task-queue/pending')
const INTERVAL    = parseInt(process.env.JIRA_POLL_INTERVAL || '120000', 10)

const JQL = `project = "${process.env.JIRA_PROJECT}" AND status in (OPEN, Reopened, Accepted, "In Progress", "To Do") AND assignee in (${process.env.JIRA_ASSIGNEE})`

function loadState() {
  if (!fs.existsSync(STATE_FILE)) return {}
  return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
}

function createTask(issue) {
  const task     = mapIssueToTask(issue)
  const filename = `${issue.key}-${task.id}.json`
  fs.writeFileSync(path.join(PENDING_DIR, filename), JSON.stringify(task, null, 2))
  return filename
}

async function poll() {
  const timestamp = new Date().toISOString()
  console.log(`\n[${timestamp}] 폴링 시작 — ${JQL}`)

  let issues
  try {
    issues = await searchIssues(JQL)
  } catch (err) {
    console.error(`❌ Jira 조회 실패: ${err.message}`)
    return
  }

  const state = loadState()
  let created = 0

  for (const issue of issues) {
    const key     = issue.key
    const status  = issue.fields.status.name
    const prev    = state[key]

    const isNew        = !prev && status === 'To Do'
    const isBackToTodo = prev && status === 'To Do' && prev.lastStatus !== 'To Do'

    if (isNew || isBackToTodo) {
      const reason   = isNew ? '신규 이슈' : `상태 복귀 (${prev.lastStatus} → To Do)`
      const filename = createTask(issue)
      console.log(`✅ [${key}] ${issue.fields.summary}`)
      console.log(`   사유: ${reason} | 파일: ${filename}`)
      created++
    }

    state[key] = {
      lastStatus: status,
      lastSeen:   new Date().toISOString(),
      summary:    issue.fields.summary,
    }
  }

  saveState(state)
  console.log(`[${new Date().toISOString()}] 완료 — 이슈 ${issues.length}개 확인, 태스크 ${created}개 생성`)
}

console.log('🚀 Jira 폴러 시작')
console.log(`   간격: ${INTERVAL / 1000}초`)
console.log(`   JQL: ${JQL}\n`)

poll()
setInterval(poll, INTERVAL)
