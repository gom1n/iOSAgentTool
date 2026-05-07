import { useState, useEffect, useRef, useLayoutEffect } from 'react'
import './TokenUsageChart.css'

const CHART_H = 140
const PAD_L   = 44
const PAD_R   = 12
const PAD_T   = 14
const PAD_B   = 28

function fmtK(n) {
  if (!n) return '0'
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`
  if (n >= 1000)    return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

function toDateKey(date) {
  const d = new Date(date)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function getMondayKey(date) {
  const d = new Date(date)
  const day = d.getDay() === 0 ? 7 : d.getDay()
  d.setDate(d.getDate() - (day - 1))
  return toDateKey(d)
}

function buildBuckets(mode) {
  const now = new Date()
  if (mode === 'daily') {
    return Array.from({ length: 14 }, (_, i) => {
      const d = new Date(now)
      d.setDate(d.getDate() - (13 - i))
      const key = toDateKey(d)
      return { key, label: `${d.getMonth() + 1}/${d.getDate()}` }
    })
  }
  // weekly: last 8 weeks
  return Array.from({ length: 8 }, (_, i) => {
    const d = new Date(now)
    d.setDate(d.getDate() - (7 - i) * 7)
    const key = getMondayKey(d)
    const start = new Date(key)
    const end = new Date(start)
    end.setDate(end.getDate() + 6)
    return {
      key,
      label: `${start.getMonth() + 1}/${start.getDate()}`,
      endLabel: `${end.getMonth() + 1}/${end.getDate()}`,
    }
  })
}

function loadEntries() {
  const tasks = JSON.parse(localStorage.getItem('acc_tasks') || '[]')
  const entries = []
  tasks.forEach(task => {
    const reports = task.agentReports || []
    reports.forEach(report => {
      if (!report.tokenUsage) return
      const date = report.completedAt || task.updated_at || task.created_at
      if (!date) return
      const total = (report.tokenUsage.input_tokens || 0) + (report.tokenUsage.output_tokens || 0)
      const cost  = report.tokenUsage.total_cost_usd || 0
      entries.push({ date, task, total, cost })
    })
  })
  return entries
}

export default function TokenUsageChart() {
  const [mode, setMode]     = useState('daily')
  const [entries, setEntries] = useState([])
  const [tooltip, setTooltip] = useState(null)
  const wrapRef = useRef(null)
  const [chartWidth, setChartWidth] = useState(0)

  useEffect(() => {
    setEntries(loadEntries())
    const id = setInterval(() => setEntries(loadEntries()), 5000)
    return () => clearInterval(id)
  }, [])

  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    setChartWidth(el.clientWidth)
    const ro = new ResizeObserver(e => setChartWidth(e[0].contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const buckets = buildBuckets(mode)

  const grouped = Object.fromEntries(buckets.map(b => [b.key, []]))
  entries.forEach(e => {
    const key = mode === 'daily' ? toDateKey(e.date) : getMondayKey(e.date)
    if (grouped[key]) grouped[key].push(e)
  })

  const totals  = buckets.map(b => grouped[b.key].reduce((s, e) => s + e.total, 0))
  const maxTotal = Math.max(...totals, 1)

  const totalAll  = totals.reduce((s, v) => s + v, 0)
  const totalCost = entries.filter(e => {
    const key = mode === 'daily' ? toDateKey(e.date) : getMondayKey(e.date)
    return grouped[key] !== undefined
  }).reduce((s, e) => s + e.cost, 0)

  const innerW = Math.max(0, chartWidth - PAD_L - PAD_R)
  const innerH = CHART_H - PAD_T - PAD_B
  const step   = innerW / buckets.length
  const barW   = Math.max(4, step * 0.55)
  const barXCenter = (i) => PAD_L + i * step + step / 2

  const yLabels = [0, 0.5, 1].map(r => ({ r, val: Math.round(maxTotal * r) }))

  return (
    <div className="tuc-card card">
      <div className="tuc-header">
        <div className="tuc-title-area">
          <span className="tuc-title">토큰 사용량</span>
          {totalAll > 0 && (
            <span className="tuc-summary">
              {fmtK(totalAll)} tokens
              {totalCost > 0 && <span className="tuc-cost"> · ${totalCost.toFixed(2)}</span>}
            </span>
          )}
        </div>
        <div className="tuc-mode-btns">
          <button className={`tuc-mode-btn ${mode === 'daily'  ? 'active' : ''}`} onClick={() => setMode('daily')}>일별</button>
          <button className={`tuc-mode-btn ${mode === 'weekly' ? 'active' : ''}`} onClick={() => setMode('weekly')}>주별</button>
        </div>
      </div>

      <div className="tuc-chart-area" ref={wrapRef}>
        {chartWidth > 0 && (
          <svg width={chartWidth} height={CHART_H} viewBox={`0 0 ${chartWidth} ${CHART_H}`}>
            {/* Grid + Y labels */}
            {yLabels.map(({ r, val }) => {
              const y = PAD_T + innerH * (1 - r)
              return (
                <g key={r}>
                  <line x1={PAD_L} y1={y} x2={chartWidth - PAD_R} y2={y}
                    stroke="var(--border-color)" strokeWidth={r === 0 ? 1 : 0.5} />
                  <text x={PAD_L - 6} y={y + 4} fontSize={9} fill="var(--text-secondary)" textAnchor="end">
                    {fmtK(val)}
                  </text>
                </g>
              )
            })}

            {/* Bars + X labels */}
            {buckets.map((b, i) => {
              const cx  = barXCenter(i)
              const tot = totals[i]
              const bH  = tot > 0 ? Math.max(3, (tot / maxTotal) * innerH) : 0
              const by  = PAD_T + innerH - bH
              const hasData = tot > 0
              return (
                <g key={b.key}>
                  <rect
                    x={cx - barW / 2} y={by}
                    width={barW} height={bH > 0 ? bH : 0}
                    fill={hasData ? '#3b82f6' : 'var(--bg-secondary)'}
                    rx={3}
                    style={{ cursor: hasData ? 'pointer' : 'default', transition: 'fill 0.1s' }}
                    onMouseEnter={e => hasData && setTooltip({ b, entries: grouped[b.key], clientX: e.clientX, clientY: e.clientY })}
                    onMouseMove={e => tooltip && setTooltip(t => ({ ...t, clientX: e.clientX, clientY: e.clientY }))}
                    onMouseLeave={() => setTooltip(null)}
                  />
                  {/* empty slot placeholder */}
                  {!hasData && (
                    <rect x={cx - barW / 2} y={PAD_T + innerH - 2} width={barW} height={2}
                      fill="var(--border-color)" rx={1} />
                  )}
                  <text x={cx} y={CHART_H - 6} fontSize={9} fill="var(--text-secondary)" textAnchor="middle">
                    {b.label}
                  </text>
                </g>
              )
            })}
          </svg>
        )}

      </div>

      {/* Tooltip — fixed 포지션으로 컨테이너 클리핑 방지 */}
      {tooltip && (() => {
        const { b, entries: tipEntries, clientX, clientY } = tooltip
        const tipTotal = tipEntries.reduce((s, e) => s + e.total, 0)
        const tipCost  = tipEntries.reduce((s, e) => s + e.cost, 0)
        const byTask = []
        tipEntries.forEach(e => {
          const existing = byTask.find(x => x.taskId === e.task.id)
          if (existing) { existing.total += e.total; existing.cost += e.cost }
          else byTask.push({ taskId: e.task.id, title: e.task.title, total: e.total, cost: e.cost })
        })
        byTask.sort((a, b) => b.total - a.total)
        const TIP_W = 268
        const safeLeft = Math.min(Math.max(TIP_W / 2 + 8, clientX), window.innerWidth - TIP_W / 2 - 24)
        return (
          <div className="tuc-tooltip" style={{ left: safeLeft, top: clientY - 12, transform: 'translate(-50%, -100%)' }}>
            <div className="tuc-tip-date">
              {b.label}{b.endLabel ? ` ~ ${b.endLabel}` : ''}
            </div>
            <div className="tuc-tip-items">
              {byTask.map(t => (
                <div key={t.taskId} className="tuc-tip-item">
                  <span className="tuc-tip-task" title={t.title}>{t.title}</span>
                  <span className="tuc-tip-tokens">{fmtK(t.total)}</span>
                </div>
              ))}
            </div>
            <div className="tuc-tip-total">
              {fmtK(tipTotal)} tokens
              {tipCost > 0 && <span className="tuc-tip-cost"> · ${tipCost.toFixed(3)}</span>}
            </div>
          </div>
        )
      })()}
    </div>
  )
}
