import { useState, useEffect, useLayoutEffect, useRef } from 'react'
import './TaskHistoryChart.css'

const RANGE_OPTIONS = [
  { label: '7일',  days: 7  },
  { label: '14일', days: 14 },
  { label: '30일', days: 30 },
]

const FALLBACK_COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444',
  '#8b5cf6', '#06b6d4', '#84cc16', '#f97316',
]

const CHART_H = 160
const CHART_PAD_TOP = 12
const DOT_R = 3

function dateStr(d) {
  return d.toISOString().slice(0, 10)
}

function buildDateRange(days) {
  const dates = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    dates.push(dateStr(d))
  }
  return dates
}

function formatDateLabel(iso, days) {
  const d = new Date(iso)
  if (days <= 7) return `${d.getMonth() + 1}/${d.getDate()}`
  if (d.getDay() === 0 || d.getDate() === 1) return `${d.getMonth() + 1}/${d.getDate()}`
  return String(d.getDate())
}

function loadProjectColors() {
  try {
    return Object.fromEntries(
      JSON.parse(localStorage.getItem('acc_projects') || '[]').map(p => [p.label, p.color || '#3b82f6'])
    )
  } catch { return {} }
}

export default function TaskHistoryChart() {
  const [history, setHistory]         = useState([])
  const [range, setRange]             = useState(30)
  const [tooltip, setTooltip]         = useState(null)
  const [loading, setLoading]         = useState(true)
  const [projectColors, setProjectColors] = useState({})
  const [chartWidth, setChartWidth]   = useState(0)
  const wrapRef = useRef(null)

  // DOM paint 직후 너비 측정 (loading 끝나면 재실행)
  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    setChartWidth(el.clientWidth)
    const ro = new ResizeObserver(entries => setChartWidth(entries[0].contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [loading])

  useEffect(() => {
    setProjectColors(loadProjectColors())
    const handler = () => setProjectColors(loadProjectColors())
    window.addEventListener('storage', handler)
    return () => window.removeEventListener('storage', handler)
  }, [])

  useEffect(() => {
    fetch('/api/task-history')
      .then(r => r.json())
      .then(data => { setHistory(data); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  if (loading) return null

  const dates  = buildDateRange(range)
  const cutoff = dates[0]
  const filtered = history.filter(h => (h.completedAt || h.createdAt) >= cutoff)

  const projectKeys = [...new Set(filtered.map(h => h.projectKey || '기타'))]
  const colorMap = Object.fromEntries(
    projectKeys.map((k, i) => [k, projectColors[k] || FALLBACK_COLORS[i % FALLBACK_COLORS.length]])
  )

  const byDate = {}
  for (const d of dates) byDate[d] = {}
  for (const h of filtered) {
    const d = (h.completedAt || h.createdAt).slice(0, 10)
    if (!byDate[d]) continue
    const pk = h.projectKey || '기타'
    byDate[d][pk] = (byDate[d][pk] || 0) + 1
  }

  const maxTotal = Math.max(1, ...dates.map(d => Object.values(byDate[d] || {}).reduce((s, v) => s + v, 0)))

  if (history.length === 0) {
    return (
      <div className="thc-empty">
        <p>아직 기록된 작업 이력이 없습니다.</p>
        <p>설정 &gt; 프로젝트 탭에서 기존 데이터를 마이그레이션하거나, 작업이 완료되면 자동으로 기록됩니다.</p>
      </div>
    )
  }

  const n = dates.length
  // 실제 픽셀 좌표 계산 (chartWidth가 0이면 SVG 숨김)
  const xPos = i => n > 1 ? (i / (n - 1)) * chartWidth : chartWidth / 2
  const yPos = count => CHART_PAD_TOP + (1 - count / maxTotal) * (CHART_H - CHART_PAD_TOP)

  const gridYs = [maxTotal, Math.round(maxTotal / 2), 0]

  return (
    <div className="thc-wrap">
      <div className="thc-header">
        <span className="thc-title">작업 이력</span>
        <div className="thc-header-right">
          {projectKeys.length > 0 && (
            <div className="thc-legend">
              {projectKeys.map(pk => (
                <div key={pk} className="thc-legend-item">
                  <span className="thc-legend-dot" style={{ background: colorMap[pk] }} />
                  <span className="thc-legend-label">{pk}</span>
                </div>
              ))}
            </div>
          )}
          <div className="thc-range-btns">
            {RANGE_OPTIONS.map(o => (
              <button
                key={o.days}
                className={`thc-range-btn ${range === o.days ? 'active' : ''}`}
                onClick={() => setRange(o.days)}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="thc-chart-area">
        {/* Y축 레이블 */}
        <div className="thc-y-axis">
          {gridYs.map(v => (
            <span key={v} className="thc-y-label">{v}</span>
          ))}
        </div>

        {/* 차트 본체 */}
        <div className="thc-line-wrap" ref={wrapRef}>
          {chartWidth > 0 && (
            <svg
              className="thc-svg"
              width={chartWidth}
              height={CHART_H}
              viewBox={`0 0 ${chartWidth} ${CHART_H}`}
            >
              {/* 그리드 선 */}
              {gridYs.map(v => (
                <line
                  key={v}
                  x1={0} y1={yPos(v)}
                  x2={chartWidth} y2={yPos(v)}
                  stroke="var(--border-color)"
                  strokeWidth="1"
                  opacity="0.4"
                />
              ))}

              {/* 프로젝트별 꺾은선 */}
              {projectKeys.map(pk => {
                const pts = dates.map((d, i) => `${xPos(i)},${yPos(byDate[d]?.[pk] || 0)}`).join(' ')
                return (
                  <g key={pk}>
                    <polyline
                      points={pts}
                      fill="none"
                      stroke={colorMap[pk]}
                      strokeWidth="2"
                      strokeLinejoin="round"
                      strokeLinecap="round"
                    />
                    {dates.map((d, i) => {
                      const count = byDate[d]?.[pk] || 0
                      if (!count) return null
                      return (
                        <circle
                          key={d}
                          cx={xPos(i)}
                          cy={yPos(count)}
                          r={DOT_R}
                          fill={colorMap[pk]}
                        />
                      )
                    })}
                  </g>
                )
              })}
            </svg>
          )}

          {/* X축 레이블 + hover 감지 */}
          <div className="thc-x-axis">
            {dates.map((d, i) => {
              const dayData = byDate[d] || {}
              const total   = Object.values(dayData).reduce((s, v) => s + v, 0)
              const showLabel = range <= 7
                || new Date(d).getDay() === 0
                || new Date(d).getDate() === 1
              return (
                <div
                  key={d}
                  className="thc-x-col"
                  onMouseEnter={() => total > 0 && setTooltip({ date: d, data: dayData, total, idx: i })}
                  onMouseLeave={() => setTooltip(null)}
                >
                  <span className={`thc-date-label ${showLabel ? '' : 'thc-date-faint'}`}>
                    {formatDateLabel(d, range)}
                  </span>
                </div>
              )
            })}
          </div>

          {/* 툴팁 */}
          {tooltip && tooltip.total > 0 && (
            <div
              className="thc-tooltip"
              style={{ left: `${n > 1 ? (tooltip.idx / (n - 1)) * 100 : 50}%` }}
            >
              <div className="thc-tooltip-date">{tooltip.date}</div>
              {Object.entries(tooltip.data).map(([pk, cnt]) => (
                <div key={pk} className="thc-tooltip-row">
                  <span className="thc-tooltip-dot" style={{ background: colorMap[pk] }} />
                  <span>{pk}</span>
                  <span className="thc-tooltip-cnt">{cnt}건</span>
                </div>
              ))}
              <div className="thc-tooltip-total">합계 {tooltip.total}건</div>
            </div>
          )}
        </div>
      </div>

    </div>
  )
}
