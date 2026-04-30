import { execFile } from 'child_process'
import http from 'http'
import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
const BASE = path.join(ROOT, 'projects')
const CERT = process.env.CERT_PATH || ''

const AGENT_CMDS = {
  ios: CERT
    ? `export NODE_EXTRA_CA_CERTS="${CERT}" && cd "${BASE}/ios-agent" && claude`
    : `cd "${BASE}/ios-agent" && claude`,
}

function launchInTerminal(command) {
  execFile('osascript', [
    '-e', 'tell application "Terminal"',
    '-e', 'activate',
    '-e', `do script "${command.replace(/"/g, '\\"')}"`,
    '-e', 'end tell',
  ], (err) => {
    if (err) console.error('터미널 실행 실패:', err.message)
  })
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Content-Type', 'application/json')

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    return res.end()
  }

  const url = new URL(req.url, 'http://localhost:3001')

  if (req.method === 'POST' && url.pathname === '/api/launch-agent') {
    let body = ''
    req.on('data', chunk => (body += chunk))
    req.on('end', () => {
      try {
        const { type } = JSON.parse(body)
        const cmd = AGENT_CMDS[type]
        if (!cmd) {
          res.writeHead(400)
          return res.end(JSON.stringify({ error: 'Unknown agent type' }))
        }
        launchInTerminal(cmd)
        res.writeHead(200)
        res.end(JSON.stringify({ success: true }))
      } catch (e) {
        res.writeHead(500)
        res.end(JSON.stringify({ error: e.message }))
      }
    })
    return
  }

  res.writeHead(404)
  res.end(JSON.stringify({ error: 'Not found' }))
})

server.listen(3001, () =>
  console.log('[launcher] http://localhost:3001 에서 실행 중')
)
