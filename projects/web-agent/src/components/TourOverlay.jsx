import { useState, useEffect, useCallback } from 'react'
import './TourOverlay.css'

const PAD = 8
const TIP_W = 300
const TIP_H = 180

function calcTooltipStyle(rect) {
  if (!rect) return {}
  const vw = window.innerWidth
  const vh = window.innerHeight
  const clampY = (y) => Math.min(Math.max(y, 16), vh - TIP_H - 16)
  const clampX = (x) => Math.min(Math.max(x, 16), vw - TIP_W - 16)

  if (vw - rect.right > TIP_W + 32) {
    return { top: clampY(rect.top + rect.height / 2), left: rect.right + 16, transform: 'translateY(-50%)' }
  }
  if (rect.left > TIP_W + 32) {
    return { top: clampY(rect.top + rect.height / 2), left: rect.left - TIP_W - 16, transform: 'translateY(-50%)' }
  }
  if (vh - rect.bottom > TIP_H + 16) {
    return { top: rect.bottom + 12, left: clampX(rect.left) }
  }
  return { top: rect.top - TIP_H - 12, left: clampX(rect.left) }
}

export default function TourOverlay({ steps, onClose }) {
  const [step, setStep] = useState(0)
  const [rect, setRect] = useState(null)
  const current = steps[step]

  const measure = useCallback(() => {
    if (!current?.target) { setRect(null); return }
    const el = document.querySelector(current.target)
    if (el) setRect(el.getBoundingClientRect())
    else setRect(null)
  }, [current?.target])

  useEffect(() => {
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [measure])

  const isLast = step === steps.length - 1
  const next = () => isLast ? onClose() : setStep(s => s + 1)
  const prev = () => setStep(s => s - 1)

  return (
    <div className="tour-root" onClick={onClose}>
      {rect ? (
        <div
          className="tour-spotlight"
          style={{ top: rect.top - PAD, left: rect.left - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 }}
        />
      ) : (
        <div className="tour-backdrop" />
      )}

      <div
        className={`tour-tooltip${!rect ? ' tour-tooltip--center' : ''}`}
        style={rect ? calcTooltipStyle(rect) : {}}
        onClick={e => e.stopPropagation()}
      >
        <div className="tour-progress">
          {steps.map((_, i) => (
            <span key={i} className={`tour-dot ${i === step ? 'active' : i < step ? 'done' : ''}`} onClick={() => setStep(i)} />
          ))}
        </div>
        <div className="tour-title">{current.title}</div>
        <p className="tour-desc">{current.desc}</p>
        <div className="tour-actions">
          {step > 0 && <button className="tour-btn tour-btn--prev" onClick={prev}>이전</button>}
          <button className="tour-btn tour-btn--skip" onClick={onClose}>건너뛰기</button>
          <button className="tour-btn tour-btn--next" onClick={next}>{isLast ? '완료' : '다음 →'}</button>
        </div>
      </div>
    </div>
  )
}
