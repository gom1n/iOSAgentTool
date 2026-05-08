import https from 'https'
import http from 'http'
import fs from 'fs'

function getAuthHeader() {
  const { JIRA_USERNAME, JIRA_PASSWORD } = process.env
  return 'Basic ' + Buffer.from(`${JIRA_USERNAME}:${JIRA_PASSWORD}`).toString('base64')
}

export async function searchIssues(jql, maxResults = 100) {
  const baseUrl = process.env.JIRA_BASE_URL.replace(/\/$/, '')
  const url = new URL(`${baseUrl}/rest/api/2/search`)
  url.searchParams.set('jql', jql)
  url.searchParams.set('maxResults', String(maxResults))
  url.searchParams.set('fields', 'summary,description,status,priority,components,issuetype')

  const isHttps = url.protocol === 'https:'
  const options = {
    hostname: url.hostname,
    port: url.port || (isHttps ? 443 : 80),
    path: url.pathname + url.search,
    method: 'GET',
    headers: {
      'Authorization': getAuthHeader(),
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
  }

  if (isHttps) {
    // 사내 프록시/자체서명 인증서 환경 대응
    options.rejectUnauthorized = false
  }

  return new Promise((resolve, reject) => {
    const req = (isHttps ? https : http).request(options, (res) => {
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('end', () => {
        if (res.statusCode === 401) {
          reject(new Error('인증 실패: Jira 아이디/비밀번호를 확인하세요.'))
          return
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`))
          return
        }
        try {
          resolve(JSON.parse(data).issues || [])
        } catch (e) {
          reject(new Error('JSON 파싱 실패: ' + e.message))
        }
      })
    })
    req.on('error', reject)
    req.end()
  })
}
