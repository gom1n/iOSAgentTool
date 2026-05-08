import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const componentMap = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'config', 'component-map.json'), 'utf8')
).components

const projects = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../../shared/projects.json'), 'utf8')
)

const PRIORITY_MAP = {
  'Highest': 'highest',
  'High':    'high',
  'Medium':  'medium',
  'Low':     'low',
  'Lowest':  'lowest',
}

function resolveComponentMapping(components) {
  if (components?.length) {
    for (const comp of components) {
      if (componentMap[comp.name]) return componentMap[comp.name]
    }
  }
  return componentMap['_fallback']
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
}

export function mapIssueToTask(issue) {
  const fields  = issue.fields
  const mapping = resolveComponentMapping(fields.components)

  const projectKey  = mapping.projectLabel || ''
  const project     = projects.find(p => p.label === projectKey)
  const appPrefix   = mapping.app ? `[${mapping.app}] ` : ''

  return {
    id:          generateId(),
    jiraKey:     issue.key,
    jiraUrl:     `${process.env.JIRA_BASE_URL}/browse/${issue.key}`,
    title:       `${appPrefix}${fields.summary}`,
    platform:    mapping.platform || 'iOS',
    projectKey:  projectKey,
    projectPath: project?.path || '',
    scheme:      '',
    screenIds:   [],
    description: fields.description || '',
    requirements: [],
    priority:    PRIORITY_MAP[fields.priority?.name] || 'medium',
    status:      'pending',
    source:      'jira',
    created_at:  new Date().toISOString(),
  }
}
