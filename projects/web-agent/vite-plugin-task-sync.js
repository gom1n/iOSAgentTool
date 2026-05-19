import { writeFileSync, unlinkSync, existsSync, mkdirSync, readdirSync, readFileSync, watch, statSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { exec, execSync, spawn } from 'child_process'
import http from 'http'
import https from 'https'
import crypto from 'crypto'
import { promisify } from 'util'

const pbkdf2 = promisify(crypto.pbkdf2)

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..', '..')

function loadEnv() {
  const envPath = join(ROOT, '.env')
  if (!existsSync(envPath)) return {}
  return Object.fromEntries(
    readFileSync(envPath, 'utf-8')
      .split('\n')
      .filter(l => l.trim() && !l.startsWith('#') && l.includes('='))
      .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] })
  )
}

function stripHtml(html) {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(p|div|tr|li|h[1-6])[^>]*>/gi, '\n')
    .replace(/<\/?(th|td)[^>]*>/gi, '\t')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]{3,}/g, '  ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

async function fetchWithAuth(url, username, password, certPath) {
  const auth = Buffer.from(`${username}:${password}`).toString('base64')
  const parsed = new URL(url)
  const options = {
    hostname: parsed.hostname,
    path: parsed.pathname + parsed.search,
    headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
    ...(certPath && existsSync(certPath) ? { ca: readFileSync(certPath) } : { rejectUnauthorized: false }),
  }
  return new Promise((resolve, reject) => {
    const req = https.get(options, res => {
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('end', () => resolve({ status: res.statusCode, body: data }))
    })
    req.on('error', reject)
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('timeout')) })
  })
}

function extractPageId(url) {
  try {
    const u = new URL(url)
    return u.searchParams.get('pageId') || u.pathname.split('/').pop()
  } catch { return null }
}

function structureApiSpec(rawText) {
  const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean)
  const TYPES = /^(NUMBER|STRING|BOOLEAN|INTEGER|ARRAY|OBJECT|DATE|LIST|LONG|DOUBLE|FLOAT|MAP)$/

  let method = '', url = '', title = ''
  const reqParams = [], resParams = []

  // title
  const titleIdx = lines.findIndex(l => l === 'API Title')
  if (titleIdx >= 0) title = lines[titleIdx + 1] || ''

  // method & url: scan for standalone HTTP verb then path
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    if (/^(GET|POST|PUT|DELETE|PATCH|HEAD)$/.test(l)) method = method || l
    if (/^\/[a-zA-Z0-9\/\-_{}]+$/.test(l) && l.length > 3) url = url || l
  }

  // param table parser — rawLines 사용 (trim 하면 탭이 사라져서 필드명 못 찾음)
  const rawLines = rawText.split('\n')
  let section = ''
  let sectionStart = -1

  for (let i = 0; i < rawLines.length; i++) {
    const l = rawLines[i]
    if (l.includes('Request Parameter'))  { section = 'req'; sectionStart = i; continue }
    if (l.includes('Response Parameter')) { section = 'res'; sectionStart = i; continue }
    if (sectionStart >= 0 && /Error Code|Example|History/.test(l)) { section = ''; sectionStart = -1; continue }
    if (!section) continue
    if (/^Field/.test(l.trim())) continue

    const fieldMatch = l.match(/^\t([a-z][a-zA-Z0-9_]+)\t/)
    if (!fieldMatch) continue
    const fieldName = fieldMatch[1]

    const win = rawLines.slice(i + 1, i + 9).map(s => s.trim())
    const typeFound = win.find(s => TYPES.test(s))
    if (!typeFound) continue

    const winStr = win.join(' ')
    const mandatory = /MANDATORY/i.test(winStr)

    const entry = { field: fieldName, type: typeFound, mandatory }
    if (section === 'req') reqParams.push(entry)
    else resParams.push(entry)
  }

  // JSON example blocks — greedy match of { ... }
  const jsonBlocks = []
  const jsonRe = /\{[^{}]*(?:\{[^{}]*\}[^{}]*)?\}/g
  let m
  while ((m = jsonRe.exec(rawText)) !== null) {
    try { JSON.parse(m[0]); jsonBlocks.push(JSON.stringify(JSON.parse(m[0]), null, 2)) } catch {}
  }

  // Compose
  const out = []
  if (title) out.push(`[${title}]`, '')
  if (method || url) out.push(`${method} ${url}`.trim(), '')

  if (reqParams.length) {
    const s = reqParams.map(p => `${p.field}(${p.type}${p.mandatory ? ', MANDATORY' : ''})`).join(', ')
    out.push(`Request:  ${s}`)
  }
  if (resParams.length) {
    const s = resParams.map(p => TYPES.test(p.type) && p.type !== 'STRING' ? `${p.field}(${p.type})` : p.field).join(', ')
    out.push(`Response: ${s}`)
  }

  if (jsonBlocks.length >= 1) {
    // Request 예시에 누락된 optional 파라미터 보완
    let reqExample = jsonBlocks[0]
    try {
      const parsed = JSON.parse(reqExample)
      const missing = reqParams.filter(p => !p.mandatory && !(p.field in parsed))
      missing.forEach(p => { parsed[p.field] = `(OPTIONAL) ${p.type}` })
      reqExample = JSON.stringify(parsed, null, 2)
    } catch {}

    out.push('', '예시:', reqExample)
    if (jsonBlocks.length >= 2) out.push('→', jsonBlocks[1])
  }

  return out.join('\n')
}

function resolveRef(ref, spec) {
  if (!ref || !ref.startsWith('#/')) return null
  const parts = ref.slice(2).split('/')
  let cur = spec
  for (const p of parts) { cur = cur?.[p]; if (!cur) return null }
  return cur
}

function schemaToExample(schema, spec, depth = 0) {
  if (!schema || depth > 4) return null
  if (schema['$ref']) schema = resolveRef(schema['$ref'], spec) || schema
  const type = schema.type || (schema.properties ? 'object' : null)
  if (type === 'object' || schema.properties) {
    const obj = {}
    for (const [k, v] of Object.entries(schema.properties || {})) {
      obj[k] = schemaToExample(v, spec, depth + 1)
    }
    return obj
  }
  if (type === 'array') return [schemaToExample(schema.items, spec, depth + 1)]
  if (schema.example !== undefined) return schema.example
  if (schema.enum) return schema.enum[0]
  const fmt = schema.format || ''
  if (type === 'integer' || type === 'number') return fmt === 'int64' ? 12345678 : 0
  if (type === 'boolean') return true
  if (type === 'string') {
    if (fmt === 'date-time') return '2026-01-01T00:00:00Z'
    if (fmt === 'date') return '2026-01-01'
    return 'string'
  }
  return null
}

function parseSwaggerOperation(spec, operationId, tag) {
  const isV3 = !!spec.openapi
  const schemas = isV3 ? spec.components?.schemas : spec.definitions

  // operationId 또는 tag로 매칭
  let matched = null, matchedPath = '', matchedMethod = ''
  for (const [path, methods] of Object.entries(spec.paths || {})) {
    for (const [method, op] of Object.entries(methods)) {
      if (typeof op !== 'object') continue
      const idMatch = operationId && op.operationId === operationId
      const tagMatch = !operationId && tag && op.tags?.includes(tag)
      if (idMatch || tagMatch) {
        matched = op; matchedPath = path; matchedMethod = method.toUpperCase()
        if (idMatch) break
      }
    }
    if (matched && operationId) break
  }
  if (!matched) return null

  // Request params
  const reqParams = []
  for (const p of (matched.parameters || [])) {
    if (p.in === 'path' || p.in === 'query' || p.in === 'header') {
      const schema = p.schema || {}
      reqParams.push({ field: p.name, type: (schema.type || p.type || 'string').toUpperCase(), mandatory: !!p.required, in: p.in })
    }
    if (p.in === 'body' && p.schema) {
      const bodySchema = p.schema['$ref'] ? resolveRef(p.schema['$ref'], spec) : p.schema
      for (const [k, v] of Object.entries(bodySchema?.properties || {})) {
        const required = bodySchema.required?.includes(k)
        reqParams.push({ field: k, type: (v.type || 'object').toUpperCase(), mandatory: required })
      }
    }
  }

  // OpenAPI 3.0 requestBody
  if (isV3 && matched.requestBody) {
    const content = matched.requestBody.content?.['application/json']
    const bodySchema = content?.schema?.['$ref'] ? resolveRef(content.schema['$ref'], spec) : content?.schema
    for (const [k, v] of Object.entries(bodySchema?.properties || {})) {
      const required = bodySchema.required?.includes(k)
      reqParams.push({ field: k, type: (v.type || 'object').toUpperCase(), mandatory: required })
    }
  }

  // Response schema
  const resParams = []
  const res200 = matched.responses?.['200']
  const resSchema = isV3
    ? res200?.content?.['application/json']?.schema
    : res200?.schema
  const resolvedRes = resSchema?.['$ref'] ? resolveRef(resSchema['$ref'], spec) : resSchema
  for (const [k, v] of Object.entries(resolvedRes?.properties || {})) {
    resParams.push({ field: k, type: (v.type || 'object').toUpperCase() })
  }

  // 예시 생성
  const reqExample = {}
  if (isV3 && matched.requestBody) {
    const content = matched.requestBody.content?.['application/json']
    const bodySchema = content?.schema?.['$ref'] ? resolveRef(content.schema['$ref'], spec) : content?.schema
    Object.assign(reqExample, schemaToExample(bodySchema, spec) || {})
  }
  for (const p of (matched.parameters || [])) {
    if (p.in === 'query') reqExample[p.name] = schemaToExample(p.schema || {}, spec) ?? 'value'
  }

  const resExample = schemaToExample(resolvedRes, spec)

  const out = []
  out.push(`[${matched.summary || matched.operationId || ''}]`, '')
  out.push(`${matchedMethod} ${matchedPath}`, '')
  if (matched.description) out.push(`설명: ${matched.description.replace(/<[^>]+>/g,'').trim()}`, '')
  if (reqParams.length) {
    out.push(`Request:  ${reqParams.map(p => `${p.field}(${p.type}${p.mandatory ? ', MANDATORY' : ', OPTIONAL'})`).join(', ')}`)
  }
  if (resParams.length) {
    out.push(`Response: ${resParams.map(p => p.field).join(', ')}`)
  }
  if (Object.keys(reqExample).length || resExample) {
    out.push('', '예시:')
    if (Object.keys(reqExample).length) out.push(JSON.stringify(reqExample, null, 2))
    if (resExample) out.push('→', JSON.stringify(resExample, null, 2))
  }
  return out.join('\n')
}

async function fetchSwaggerSpec(swaggerUrl, certPath) {
  const u = new URL(swaggerUrl)
  const base = `${u.protocol}//${u.host}${u.pathname.replace(/\/swagger-ui[^/]*/,'').replace(/\/index\.html$/,'')}`

  // fragment から operationId と tag を抽出
  const frag = decodeURIComponent(u.hash.replace('#/', ''))
  const fragParts = frag.split('/')
  const tag = fragParts[0] || ''
  const operationId = fragParts[1] || ''

  // spec 후보 경로 순서대로 시도
  const candidates = [
    `${base}/v3/api-docs`,
    `${base}/v2/api-docs`,
    `${base}/swagger.json`,
    `${base}/api-docs`,
    `${u.protocol}//${u.host}/v3/api-docs`,
    `${u.protocol}//${u.host}/v2/api-docs`,
  ]

  let spec = null
  for (const specUrl of candidates) {
    try {
      const pu = new URL(specUrl)
      const isHttps = pu.protocol === 'https:'
      const mod = isHttps ? https : http
      const result = await new Promise((resolve, reject) => {
        const req = mod.get({
          hostname: pu.hostname, port: pu.port || undefined,
          path: pu.pathname + pu.search,
          headers: { Accept: 'application/json' },
          ...(isHttps ? { rejectUnauthorized: false } : {}),
          ...(certPath && existsSync(certPath) ? { ca: readFileSync(certPath) } : {}),
        }, res => {
          let d = ''
          res.on('data', c => d += c)
          res.on('end', () => resolve({ status: res.statusCode, body: d }))
        })
        req.on('error', reject)
        req.setTimeout(8000, () => { req.destroy(); reject(new Error('timeout')) })
      })
      if (result.status === 200) {
        const j = JSON.parse(result.body)
        if (j.paths) { spec = j; break }
      }
    } catch {}
  }

  if (!spec) throw new Error('Swagger spec을 찾을 수 없습니다 (v3/api-docs, v2/api-docs 시도)')

  // operationId/tag 없으면 전체 목록 반환
  if (!operationId && !tag) {
    const lines = [`[${spec.info?.title || 'API'}] 엔드포인트 목록`, '']
    const tagMap = {}
    for (const [path, methods] of Object.entries(spec.paths || {})) {
      for (const [method, op] of Object.entries(methods)) {
        if (typeof op !== 'object') continue
        const t = op.tags?.[0] || '기타'
        if (!tagMap[t]) tagMap[t] = []
        tagMap[t].push(`  ${method.toUpperCase()} ${path}  — ${op.summary || op.operationId || ''}`)
      }
    }
    for (const [t, ops] of Object.entries(tagMap)) {
      lines.push(`▸ ${t}`)
      lines.push(...ops)
      lines.push('')
    }
    lines.push('특정 엔드포인트를 보려면 URL 뒤에 #/{태그}/{operationId} 형식으로 입력하세요.')
    return { title: spec.info?.title || '', structured: lines.join('\n'), url: swaggerUrl }
  }

  const structured = parseSwaggerOperation(spec, operationId, tag)
  if (!structured) throw new Error(`operationId "${operationId}" 또는 tag "${tag}"를 spec에서 찾을 수 없습니다`)

  return { title: spec.info?.title || '', structured, url: swaggerUrl }
}

async function fetchConfluencePage(pageUrl, username, password, certPath) {
  const pageId = extractPageId(pageUrl)
  if (!pageId) throw new Error('pageId를 URL에서 찾을 수 없습니다')

  const base = new URL(pageUrl)
  const apiUrl = `${base.protocol}//${base.host}/rest/api/content/${pageId}?expand=body.view,title,space`

  const { status, body } = await fetchWithAuth(apiUrl, username, password, certPath)
  if (status === 401) throw new Error('인증 실패 — WIKI_USERNAME / WIKI_PASSWORD를 확인하세요')
  if (status !== 200) throw new Error(`위키 응답 오류 (HTTP ${status})`)

  const json = JSON.parse(body)
  const title = json.title || ''
  const html = json.body?.view?.value || ''
  const text = stripHtml(html)
  const structured = structureApiSpec(text)
  return { title, text, structured, pageId, url: pageUrl }
}

async function getClaudeSessionKey() {
  // 1. 키체인에서 Claude Safe Storage 비밀번호 가져오기
  const passwordBuf = execSync(
    'security find-generic-password -s "Claude Safe Storage" -w',
    { encoding: 'buffer' }
  )
  let end = passwordBuf.length
  while (end > 0 && passwordBuf[end - 1] <= 13) end--
  const password = passwordBuf.slice(0, end)

  // 2. PBKDF2로 복호화 키 생성 (Chromium 표준)
  const key = await pbkdf2(password, 'saltysalt', 1003, 16, 'sha1')

  // 3. SQLite에서 sessionKey 쿠키 값 읽기
  const cookieDb = `${process.env.HOME}/Library/Application Support/Claude/Cookies`
  const encryptedHex = execSync(
    `sqlite3 "${cookieDb}" "SELECT hex(encrypted_value) FROM cookies WHERE name='sessionKey' LIMIT 1;"`,
    { encoding: 'utf-8' }
  ).trim()

  if (!encryptedHex) throw new Error('sessionKey 쿠키를 찾을 수 없습니다')

  // 4. AES-128-CBC 복호화
  // v10 prefix(3바이트) 제거 후 다음 16바이트를 IV로 사용, 나머지가 실제 암호문
  const encBuf = Buffer.from(encryptedHex, 'hex')
  const iv = encBuf.slice(3, 19)
  const ciphertext = encBuf.slice(19)
  const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv)
  const decryptedBuf = Buffer.concat([decipher.update(ciphertext), decipher.final()])

  // 복호화 결과에서 sk-ant- 패턴 추출 (첫 블록은 헤더)
  const match = decryptedBuf.toString('latin1').match(/sk-ant-[\x21-\x7e]+/)
  if (!match) throw new Error('sessionKey 복호화 실패: sk-ant- 패턴 없음')

  return match[0]
}

async function fetchClaudeUsage() {
  const sessionKey = await getClaudeSessionKey()

  const headers = {
    cookie: `sessionKey=${sessionKey}`,
    'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    accept: 'application/json',
    'accept-language': 'ko-KR,ko;q=0.9',
    referer: 'https://claude.ai/',
  }

  // Claude Code 조직 UUID를 ~/.claude.json에서 직접 읽기 (여기에 실제 API 사용량이 있음)
  const claudeJson = JSON.parse(readFileSync(`${process.env.HOME}/.claude.json`, 'utf-8'))
  const orgId = claudeJson?.oauthAccount?.organizationUuid
  if (!orgId) throw new Error('organizationUuid를 찾을 수 없습니다')

  // 사용량 API 호출
  const usageRes = await fetch(`https://claude.ai/api/organizations/${orgId}/usage`, { headers })
  if (!usageRes.ok) throw new Error(`사용량 API 오류: ${usageRes.status}`)
  const usage = await usageRes.json()

  return { orgId, usage }
}

const IOS_WATCHER_PORT = 3002

function proxyToWatcher(port, path, method, res, errorMsg) {
  const options = { hostname: 'localhost', port, path, method }
  const req = http.request(options, (r) => {
    let data = ''
    r.on('data', chunk => (data += chunk))
    r.on('end', () => res.end(data))
  })
  req.on('error', () => {
    res.writeHead(503)
    res.end(JSON.stringify({ error: errorMsg }))
  })
  req.end()
}

const QUEUE_BASE    = join(ROOT, 'shared/task-queue')
const FOLDERS       = ['pending', 'in-progress', 'completed']
const LOGS_FILE     = join(ROOT, 'shared/activity-logs.json')
const HISTORY_FILE  = join(ROOT, 'shared/task-history.json')
const MAX_LOGS = 200

function loadHistory() {
  try { return existsSync(HISTORY_FILE) ? JSON.parse(readFileSync(HISTORY_FILE, 'utf-8')) : [] } catch { return [] }
}

function appendHistory(task) {
  const history = loadHistory()
  if (history.find(h => h.id === task.id)) return
  history.push({
    id:         task.id,
    title:      task.title || '',
    projectKey: task.projectKey || '기타',
    scheme:     task.scheme || '',
    platform:   task.platform || '',
    completedAt: new Date().toISOString(),
    createdAt:  task.created_at || new Date().toISOString(),
  })
  writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2))
}

const STATUS_LABEL = { pending: '대기 중', 'in-progress': '진행 중', completed: '완료' }


function appendActivityLog(entry) {
  let logs = []
  try { logs = JSON.parse(readFileSync(LOGS_FILE, 'utf-8')) } catch {}
  // 같은 taskId + message 조합이 5초 내에 이미 있으면 중복 방지
  if (entry.taskId || entry.message) {
    const now = Date.now()
    const isDup = logs.some(l =>
      l.taskId === entry.taskId &&
      l.message === entry.message &&
      now - new Date(l.time).getTime() < 60000
    )
    if (isDup) return
  }
  logs.push({ id: Date.now(), time: new Date().toISOString(), agent: 'system', type: 'info', ...entry })
  if (logs.length > MAX_LOGS) logs = logs.slice(-MAX_LOGS)
  writeFileSync(LOGS_FILE, JSON.stringify(logs, null, 2))
}

function ensureDirs() {
  for (const folder of FOLDERS) {
    const dir = join(QUEUE_BASE, folder)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  }
  if (!existsSync(LOGS_FILE)) writeFileSync(LOGS_FILE, '[]')
}

// 파일시스템 감시: iOS 에이전트가 직접 파일을 이동하거나 API 경유 시 로그 기록
// 디바운스 맵: "taskId:folder" → 마지막 기록 시각 (중복 방지)
const _logDebounce = new Map()

function watchTaskQueue() {
  for (const folder of FOLDERS) {
    const dir = join(QUEUE_BASE, folder)
    if (!existsSync(dir)) continue
    watch(dir, (eventType, filename) => {
      if (eventType !== 'rename' || !filename?.endsWith('.json')) return
      const filePath = join(dir, filename)
      if (!existsSync(filePath)) return
      try {
        const task = JSON.parse(readFileSync(filePath, 'utf-8'))
        const key = `${task.id ?? filename}:${folder}`
        const now = Date.now()
        if (_logDebounce.get(key) > now - 2000) return  // 2초 내 중복 무시
        _logDebounce.set(key, now)
        const type = folder === 'completed' ? 'success' : 'info'
        appendActivityLog({
          agent: 'ios',
          type,
          message: `[${task.title ?? filename}] ${STATUS_LABEL[folder] ?? folder}`,
          taskId: task.id,
        })
      } catch {}
    })
  }
}

function findTaskFile(id) {
  for (const folder of FOLDERS) {
    const path = join(QUEUE_BASE, folder, `${id}.json`)
    if (existsSync(path)) return { path, folder }
  }
  return null
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = ''
    req.on('data', chunk => (body += chunk))
    req.on('end', () => {
      try { resolve(JSON.parse(body)) } catch { resolve({}) }
    })
  })
}

export function taskSyncPlugin() {
  ensureDirs()
  watchTaskQueue()
  return {
    name: 'task-sync',
    configureServer(server) {

      // GET /api/activity-logs — 서버사이드 활동 로그
      // DELETE /api/activity-logs — 로그 초기화
      server.middlewares.use('/api/activity-logs', (req, res) => {
        res.setHeader('Content-Type', 'application/json')
        if (req.method === 'DELETE') {
          try {
            writeFileSync(LOGS_FILE, '[]')
            res.end(JSON.stringify({ ok: true }))
          } catch (e) {
            res.writeHead(500)
            res.end(JSON.stringify({ ok: false, error: e.message }))
          }
          return
        }
        try {
          const logs = JSON.parse(readFileSync(LOGS_FILE, 'utf-8'))
          res.end(JSON.stringify(logs))
        } catch {
          res.end('[]')
        }
      })

      server.middlewares.use('/api/task-queue', async (req, res) => {
        res.setHeader('Content-Type', 'application/json')

        // GET /api/task-queue — 파일시스템에서 전체 작업 읽기 (iOS 에이전트 상태 반영용)
        if (req.method === 'GET' && (req.url === '' || req.url === '/')) {
          const tasks = []
          for (const folder of FOLDERS) {
            const dir = join(QUEUE_BASE, folder)
            if (!existsSync(dir)) continue
            for (const file of readdirSync(dir).filter(f => f.endsWith('.json'))) {
              try {
                const task = JSON.parse(readFileSync(join(dir, file), 'utf-8'))
                tasks.push({ ...task, status: folder }) // 폴더가 상태의 기준
              } catch {}
            }
          }
          res.end(JSON.stringify(tasks))
          return
        }

        // POST /api/task-queue — 작업 생성
        if (req.method === 'POST') {
          const task = await readBody(req)
          const folder = task.status || 'pending'
          writeFileSync(join(QUEUE_BASE, folder, `${task.id}.json`), JSON.stringify(task, null, 2))
          res.end(JSON.stringify({ ok: true }))
          return
        }

        // ID 추출: /api/task-queue/task-123-abc
        const id = req.url?.replace(/^\//, '').split('?')[0]

        // DELETE /api/task-queue/:id — 작업 삭제
        if (req.method === 'DELETE' && id) {
          const found = findTaskFile(id)
          if (found) unlinkSync(found.path)
          const history = loadHistory().filter(h => h.id !== id)
          writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2))
          res.end(JSON.stringify({ ok: true }))
          return
        }

        // PATCH /api/task-queue/:id — 상태 변경 (폴더 이동)
        if (req.method === 'PATCH' && id) {
          const task = await readBody(req)
          const found = findTaskFile(id)

          // agentSummary가 있으면 agentReports 배열에 누적
          let agentReports = []
          let existingHumanEstimate = null
          let existingStartedAt = null
          if (found) {
            try {
              const existing = JSON.parse(readFileSync(found.path, 'utf-8'))
              agentReports = existing.agentReports || []
              existingHumanEstimate = existing.humanEstimateMinutes || null
              existingStartedAt = existing.started_at || null
            } catch {}
            unlinkSync(found.path)
          }
          if (task.agentSummary && task.status === 'completed') {
            const report = { summary: task.agentSummary, completedAt: new Date().toISOString() }
            if (task.agentSuccess !== undefined) report.success = task.agentSuccess
            if (task.agentBuildSuccess !== undefined) report.buildSuccess = task.agentBuildSuccess
            agentReports = [...agentReports, report]
          }

          const humanEstimateMinutes = task.humanEstimateMinutes || existingHumanEstimate
          // in-progress 전환 시 최초 1회만 started_at 기록
          const started_at = existingStartedAt || (task.status === 'in-progress' ? new Date().toISOString() : undefined)

          const newFolder = task.status || 'pending'
          const taskWithTs = {
            ...task,
            agentReports,
            updated_at: new Date().toISOString(),
            ...(humanEstimateMinutes != null ? { humanEstimateMinutes } : {}),
            ...(started_at ? { started_at } : {}),
          }
          writeFileSync(join(QUEUE_BASE, newFolder, `${id}.json`), JSON.stringify(taskWithTs, null, 2))
          if (task.status === 'completed') appendHistory(task)
          res.end(JSON.stringify({ ok: true }))
          return
        }

        res.statusCode = 404
        res.end(JSON.stringify({ error: 'not found' }))
      })

      // GET  /api/file?path=... — 파일 읽기
      // POST /api/file          — 파일 저장 { path, content }
      server.middlewares.use('/api/file', async (req, res) => {
        res.setHeader('Content-Type', 'application/json')
        const params = new URLSearchParams(req.url?.split('?')[1] || '')

        if (req.method === 'GET') {
          const filePath = params.get('path')
          if (!filePath || !existsSync(filePath)) {
            res.writeHead(404)
            return res.end(JSON.stringify({ error: 'File not found' }))
          }
          try {
            res.end(JSON.stringify({ content: readFileSync(filePath, 'utf-8') }))
          } catch (e) {
            res.writeHead(500)
            res.end(JSON.stringify({ error: e.message }))
          }
          return
        }

        if (req.method === 'POST') {
          const { path, content } = await readBody(req)
          try {
            const dir = path.substring(0, path.lastIndexOf('/'))
            if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true })
            writeFileSync(path, content)
            res.end(JSON.stringify({ ok: true }))
          } catch (e) {
            res.writeHead(500)
            res.end(JSON.stringify({ error: e.message }))
          }
          return
        }

        res.writeHead(405)
        res.end(JSON.stringify({ error: 'method not allowed' }))
      })

      // POST /api/git-commit — git add + commit (+ 선택적 checkout)
      server.middlewares.use('/api/git-commit', async (req, res) => {
        res.setHeader('Content-Type', 'application/json')
        if (req.method !== 'POST') {
          res.writeHead(405)
          return res.end(JSON.stringify({ error: 'method not allowed' }))
        }
        const { projectPath, branch, message } = await readBody(req)
        if (!projectPath || !message) {
          res.writeHead(400)
          return res.end(JSON.stringify({ error: 'projectPath and message required' }))
        }
        const escaped = message.replace(/"/g, '\\"')
        const checkoutCmd = branch ? `git -C "${projectPath}" checkout "${branch}" && ` : ''
        // git add -A 후 CLAUDE 관련 파일은 스테이징에서 제거
        const addCmd = `git -C "${projectPath}" add -A && git -C "${projectPath}" reset HEAD -- CLAUDE.md .claude 2>/dev/null; true`
        const cmd = `${checkoutCmd}${addCmd} && git -C "${projectPath}" commit -m "${escaped}"`
        exec(cmd, { maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
          if (err && !stdout.includes('nothing to commit')) {
            res.end(JSON.stringify({ ok: false, error: (stderr || err.message).trim() }))
          } else {
            res.end(JSON.stringify({ ok: true, output: stdout.trim() }))
          }
        })
      })

      // POST /api/git-rollback — 마지막 커밋 취소 (변경사항은 유지)
      server.middlewares.use('/api/git-rollback', async (req, res) => {
        res.setHeader('Content-Type', 'application/json')
        if (req.method !== 'POST') {
          res.writeHead(405)
          return res.end(JSON.stringify({ error: 'method not allowed' }))
        }
        const { projectPath } = await readBody(req)
        if (!projectPath) {
          res.writeHead(400)
          return res.end(JSON.stringify({ error: 'projectPath required' }))
        }
        exec(`git -C "${projectPath}" reset --soft HEAD~1`, { maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
          if (err) {
            res.end(JSON.stringify({ ok: false, error: (stderr || err.message).trim() }))
          } else {
            res.end(JSON.stringify({ ok: true }))
          }
        })
      })

      // POST /api/open-file — Xcode로 파일 열기
      server.middlewares.use('/api/open-file', async (req, res) => {
        res.setHeader('Content-Type', 'application/json')
        if (req.method !== 'POST') {
          res.writeHead(405)
          return res.end(JSON.stringify({ error: 'method not allowed' }))
        }
        const { path: filePath } = await readBody(req)
        if (!filePath) {
          res.writeHead(400)
          return res.end(JSON.stringify({ error: 'path required' }))
        }
        exec(`open -a Xcode "${filePath}"`, (err, _, stderr) => {
          if (err) {
            res.end(JSON.stringify({ ok: false, error: (stderr || err.message).trim() }))
          } else {
            res.end(JSON.stringify({ ok: true }))
          }
        })
      })

      // GET|POST|DELETE /api/task-history
      server.middlewares.use('/api/task-history', async (req, res) => {
        res.setHeader('Content-Type', 'application/json')
        if (req.method === 'GET') {
          return res.end(JSON.stringify(loadHistory()))
        }
        if (req.method === 'POST') {
          const body = await readBody(req)
          const entries = body.entries || []
          const history = loadHistory()
          const existingIds = new Set(history.map(h => h.id))
          let added = 0
          for (const e of entries) {
            if (!existingIds.has(e.id)) { history.push(e); existingIds.add(e.id); added++ }
          }
          writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2))
          return res.end(JSON.stringify({ ok: true, added }))
        }
        if (req.method === 'DELETE') {
          writeFileSync(HISTORY_FILE, '[]')
          return res.end(JSON.stringify({ ok: true }))
        }
        res.writeHead(405); res.end('{}')
      })

      // GET /api/screens — shared/screens/ 에 실제 존재하는 screen ID 목록
      server.middlewares.use('/api/screens', (req, res) => {
        res.setHeader('Content-Type', 'application/json')
        if (req.method !== 'GET') { res.writeHead(405); return res.end('{}') }
        const screensBase = join(ROOT, 'shared/screens')
        try {
          const ids = readdirSync(screensBase).filter(f =>
            statSync(join(screensBase, f)).isDirectory()
          )
          res.end(JSON.stringify({ ids }))
        } catch {
          res.end(JSON.stringify({ ids: [] }))
        }
      })

      // GET /api/system-paths — 서버 측 경로 정보 (클라이언트 하드코딩 제거용)
      server.middlewares.use('/api/system-paths', (req, res) => {
        res.setHeader('Content-Type', 'application/json')
        if (req.method !== 'GET') {
          res.writeHead(405)
          return res.end(JSON.stringify({ error: 'method not allowed' }))
        }
        res.end(JSON.stringify({
          root: ROOT,
          screensBase: join(ROOT, 'shared/screens'),
          guidelinesDir: join(ROOT, 'shared/guidelines'),
          guideFiles: {
            ios: join(ROOT, 'projects/ios-agent/CLAUDE.md'),
          },
        }))
      })

      // GET /api/agent-status — 전체 프로젝트 에이전트 상태
      server.middlewares.use('/api/agent-status', (req, res) => {
        res.setHeader('Content-Type', 'application/json')
        if (req.method !== 'GET') { res.writeHead(405); return res.end(JSON.stringify({ error: 'method not allowed' })) }
        proxyToWatcher(IOS_WATCHER_PORT, '/status', 'GET', res, '워처 서버가 실행되지 않았습니다. (ios-watcher.js 확인)')
      })

      // GET /api/agent-logs?project=X — 특정 프로젝트 에이전트 로그
      server.middlewares.use('/api/agent-logs', (req, res) => {
        res.setHeader('Content-Type', 'application/json')
        if (req.method !== 'GET') { res.writeHead(405); return res.end(JSON.stringify({ error: 'method not allowed' })) }
        const qs = req.url?.split('?')[1] || ''
        const project = decodeURIComponent((qs.match(/(?:^|&)project=([^&]*)/) || [])[1] || '')
        proxyToWatcher(IOS_WATCHER_PORT, `/logs?project=${encodeURIComponent(project)}`, 'GET', res, '워처 서버 연결 실패')
      })

      // POST /api/agent-session-reset — 세션 초기화
      server.middlewares.use('/api/agent-session-reset', async (req, res) => {
        res.setHeader('Content-Type', 'application/json')
        if (req.method !== 'POST') { res.writeHead(405); return res.end(JSON.stringify({ error: 'method not allowed' })) }
        const body = await readBody(req)
        const proxyReq = http.request(
          { hostname: 'localhost', port: IOS_WATCHER_PORT, path: '/session-reset', method: 'POST', headers: { 'Content-Type': 'application/json' } },
          (r) => { let d = ''; r.on('data', c => (d += c)); r.on('end', () => res.end(d)) }
        )
        proxyReq.on('error', () => { res.writeHead(503); res.end(JSON.stringify({ error: '워처 서버 연결 실패' })) })
        proxyReq.write(JSON.stringify(body))
        proxyReq.end()
      })

      // GET /api/claude-usage — Claude 사용량 조회
      server.middlewares.use('/api/claude-usage', async (req, res) => {
        res.setHeader('Content-Type', 'application/json')
        if (req.method !== 'GET') {
          res.writeHead(405)
          return res.end(JSON.stringify({ error: 'method not allowed' }))
        }
        try {
          const { usage } = await fetchClaudeUsage()
          res.end(JSON.stringify({ ok: true, usage }))
        } catch (e) {
          res.writeHead(500)
          res.end(JSON.stringify({ ok: false, error: e.message }))
        }
      })

      // POST /api/stop-agent — 특정 프로젝트 에이전트 중단 { project }
      server.middlewares.use('/api/stop-agent', async (req, res) => {
        res.setHeader('Content-Type', 'application/json')
        if (req.method !== 'POST') { res.writeHead(405); return res.end(JSON.stringify({ error: 'method not allowed' })) }
        const body = await readBody(req)
        const proxyReq = http.request(
          { hostname: 'localhost', port: IOS_WATCHER_PORT, path: '/stop', method: 'POST', headers: { 'Content-Type': 'application/json' } },
          (r) => {
            let data = ''
            r.on('data', chunk => (data += chunk))
            r.on('end', () => {
              try {
                const result = JSON.parse(data)
                if (result.ok) appendActivityLog({ agent: 'ios', type: 'stopped', message: `[${body.project}] 에이전트 강제 중단됨` })
              } catch {}
              res.end(data)
            })
          }
        )
        proxyReq.on('error', () => { res.writeHead(503); res.end(JSON.stringify({ error: '워처 서버가 실행되지 않았습니다.' })) })
        proxyReq.write(JSON.stringify(body))
        proxyReq.end()
      })

      // GET/POST /api/projects — shared/projects.json 동기화
      const PROJECTS_FILE = join(ROOT, 'shared/projects.json')
      server.middlewares.use('/api/projects', async (req, res) => {
        res.setHeader('Content-Type', 'application/json')
        res.setHeader('Access-Control-Allow-Origin', '*')
        if (req.method === 'GET') {
          try {
            const data = existsSync(PROJECTS_FILE) ? readFileSync(PROJECTS_FILE, 'utf-8') : '[]'
            return res.end(data)
          } catch (e) {
            res.writeHead(500)
            return res.end(JSON.stringify({ error: e.message }))
          }
        }
        if (req.method === 'POST') {
          try {
            const { projects } = await readBody(req)
            writeFileSync(PROJECTS_FILE, JSON.stringify(projects, null, 2))
            return res.end(JSON.stringify({ ok: true }))
          } catch (e) {
            res.writeHead(500)
            return res.end(JSON.stringify({ error: e.message }))
          }
        }
        res.writeHead(405)
        res.end(JSON.stringify({ error: 'method not allowed' }))
      })

      // GET /api/git-diff?projectPath=... — git diff 조회
      server.middlewares.use('/api/git-diff', (req, res) => {
        res.setHeader('Content-Type', 'application/json')
        const params = new URLSearchParams(req.url?.split('?')[1] || '')
        const projectPath = params.get('projectPath')

        if (!projectPath || !existsSync(projectPath)) {
          res.writeHead(400)
          return res.end(JSON.stringify({ error: 'Invalid projectPath' }))
        }

        exec(`git -C "${projectPath}" diff HEAD`, { maxBuffer: 2 * 1024 * 1024 }, (_, stdout) => {
          res.end(JSON.stringify({ diff: stdout || '' }))
        })
      })

      // ── Xcode 프로젝트 파일 탐색 ──────────────────────────
      // 1) path 자체가 .xcworkspace/.xcodeproj
      // 2) path 바로 아래에 존재
      // 3) path 한 단계 하위 폴더에 존재
      function findXcodeProject(basePath) {
        const isWs   = p => p.endsWith('.xcworkspace') && !p.includes('project.xcworkspace')
        const isProj = p => p.endsWith('.xcodeproj')

        if (isWs(basePath))   return { flag: '-workspace', target: basePath }
        if (isProj(basePath)) return { flag: '-project',   target: basePath }

        let entries
        try { entries = readdirSync(basePath) } catch { return null }

        const ws   = entries.find(e => isWs(e))
        const proj = entries.find(e => isProj(e))
        if (ws)   return { flag: '-workspace', target: join(basePath, ws) }
        if (proj) return { flag: '-project',   target: join(basePath, proj) }

        for (const entry of entries) {
          const sub = join(basePath, entry)
          try {
            const subEntries = readdirSync(sub)
            const subWs   = subEntries.find(e => isWs(e))
            const subProj = subEntries.find(e => isProj(e))
            if (subWs)   return { flag: '-workspace', target: join(sub, subWs) }
            if (subProj) return { flag: '-project',   target: join(sub, subProj) }
          } catch {}
        }
        return null
      }

      // GET /api/validate-project-path?path=... → 경로 유효성 확인
      server.middlewares.use('/api/validate-project-path', (req, res) => {
        res.setHeader('Content-Type', 'application/json')
        res.setHeader('Access-Control-Allow-Origin', '*')
        const qs = req.url?.split('?')[1] || ''
        const path = decodeURIComponent((qs.match(/(?:^|&)path=([^&]*)/) || [])[1] || '')
        if (!path) return res.end(JSON.stringify({ valid: false, reason: '경로를 입력하세요' }))
        if (!existsSync(path)) return res.end(JSON.stringify({ valid: false, reason: '경로가 존재하지 않습니다' }))
        const found = findXcodeProject(path)
        if (found) return res.end(JSON.stringify({ valid: true, target: found.target }))
        let entries = []
        try { entries = readdirSync(path) } catch {}
        return res.end(JSON.stringify({ valid: false, reason: `.xcworkspace / .xcodeproj를 찾을 수 없습니다`, entries: entries.slice(0, 10) }))
      })

      // ── Xcode 빌드 ──────────────────────────────────────
      // 빌드 상태는 서버 메모리에 유지 (단일 빌드만 지원)
      const buildState = { status: 'idle', logs: [], proc: null }

      // POST /  → 빌드 시작
      // GET  /logs → 로그 + 상태 폴링
      // POST /stop → 빌드 중단
      server.middlewares.use('/api/xcode-build', async (req, res) => {
        res.setHeader('Content-Type', 'application/json')
        res.setHeader('Access-Control-Allow-Origin', '*')
        const sub = req.url || '/'

        // GET /logs
        if (sub === '/logs' && req.method === 'GET') {
          return res.end(JSON.stringify({ status: buildState.status, logs: buildState.logs }))
        }

        // POST /stop
        if (sub === '/stop' && req.method === 'POST') {
          if (buildState.proc) {
            try { process.kill(-buildState.proc.pid, 'SIGTERM') } catch { buildState.proc.kill('SIGTERM') }
            buildState.status = 'idle'
            buildState.proc = null
          }
          return res.end(JSON.stringify({ ok: true }))
        }

        // POST / — 빌드 시작
        if ((sub === '' || sub === '/') && req.method === 'POST') {
          if (buildState.status === 'running') {
            res.writeHead(409)
            return res.end(JSON.stringify({ error: '이미 빌드 중입니다' }))
          }
          const { projectPath, scheme, destination, configuration } = await readBody(req)
          if (!projectPath || !scheme) {
            res.writeHead(400)
            return res.end(JSON.stringify({ error: 'projectPath, scheme 필요' }))
          }
          if (!existsSync(projectPath)) {
            res.writeHead(400)
            return res.end(JSON.stringify({ error: '프로젝트 경로를 찾을 수 없습니다' }))
          }

          // .xcworkspace 또는 .xcodeproj 자동 감지
          const found = findXcodeProject(projectPath)
          if (!found) {
            let entries = []
            try { entries = readdirSync(projectPath) } catch {}
            res.writeHead(400)
            return res.end(JSON.stringify({ error: `.xcworkspace / .xcodeproj를 찾을 수 없습니다 (확인된 항목: ${entries.slice(0, 8).join(', ') || '없음'})` }))
          }
          const { flag: buildFlag, target: buildTarget } = found

          const destArgs = destination ? ['-destination', destination] : ['-destination', 'generic/platform=iOS']
          const configArgs = configuration ? ['-configuration', configuration] : []
          const args = [buildFlag, buildTarget, '-scheme', scheme, ...configArgs, ...destArgs, 'build']
          buildState.status = 'running'
          buildState.logs = [`▶ xcodebuild ${args.join(' ')}`]
          const proc = spawn('xcodebuild', args, { detached: true })
          buildState.proc = proc

          const onData = (data) => {
            const lines = data.toString().split('\n').filter(l => l.trim())
            buildState.logs.push(...lines)
            if (buildState.logs.length > 500) buildState.logs = buildState.logs.slice(-500)
          }
          proc.stdout.on('data', onData)
          proc.stderr.on('data', onData)
          proc.on('close', (code) => {
            buildState.status = code === 0 ? 'success' : 'failed'
            buildState.logs.push(code === 0 ? '✅ 빌드 성공' : `❌ 빌드 실패 (exit ${code})`)
            buildState.proc = null
          })

          return res.end(JSON.stringify({ ok: true }))
        }

        res.writeHead(404)
        res.end(JSON.stringify({ error: 'not found' }))
      })

      // POST /api/fetch-wiki — 위키(Confluence) 또는 Swagger 파싱
      server.middlewares.use('/api/fetch-wiki', async (req, res) => {
        res.setHeader('Content-Type', 'application/json')
        if (req.method !== 'POST') { res.writeHead(405); return res.end(JSON.stringify({ error: 'method not allowed' })) }

        const { url } = await readBody(req)
        if (!url) { res.writeHead(400); return res.end(JSON.stringify({ error: 'url required' })) }

        const env = loadEnv()
        const isSwagger = /swagger-ui|swagger\.json|api-docs/i.test(url)

        try {
          if (isSwagger) {
            const result = await fetchSwaggerSpec(url, env.CERT_PATH)
            res.end(JSON.stringify({ ok: true, ...result }))
          } else {
            const username = env.WIKI_USERNAME
            const password = env.WIKI_PASSWORD
            if (!username || !password) {
              res.writeHead(400)
              return res.end(JSON.stringify({ error: '.env에 WIKI_USERNAME과 WIKI_PASSWORD를 설정해주세요' }))
            }
            const result = await fetchConfluencePage(url, username, password, env.CERT_PATH)
            res.end(JSON.stringify({ ok: true, ...result }))
          }
        } catch (e) {
          res.writeHead(500)
          res.end(JSON.stringify({ error: e.message }))
        }
      })

      // POST /api/compress-spec — Python 스크립트로 spec.md 경량화
      server.middlewares.use('/api/compress-spec', async (req, res) => {
        res.setHeader('Content-Type', 'application/json')
        if (req.method !== 'POST') {
          res.writeHead(405)
          return res.end(JSON.stringify({ error: 'method not allowed' }))
        }
        const { content } = await readBody(req)
        if (!content) {
          res.writeHead(400)
          return res.end(JSON.stringify({ error: 'content required' }))
        }
        const scriptPath = join(ROOT, 'shared/compress_spec.py')
        try {
          const compressed = await new Promise((resolve, reject) => {
            const proc = spawn('python3', [scriptPath, '-'], { stdio: ['pipe', 'pipe', 'pipe'] })
            let out = ''
            let err = ''
            proc.stdout.on('data', d => { out += d })
            proc.stderr.on('data', d => { err += d })
            proc.on('close', code => {
              if (code !== 0) reject(new Error(err || `python3 exit ${code}`))
              else resolve(out)
            })
            proc.stdin.write(content, 'utf-8')
            proc.stdin.end()
          })
          const origSize = Buffer.byteLength(content, 'utf-8')
          const compSize = Buffer.byteLength(compressed, 'utf-8')
          res.end(JSON.stringify({ compressed, originalSize: origSize, compressedSize: compSize }))
        } catch (e) {
          res.writeHead(500)
          res.end(JSON.stringify({ error: e.message }))
        }
      })

    },
  }
}
