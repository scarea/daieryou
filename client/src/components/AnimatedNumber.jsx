import React, { useEffect, useRef, useState } from 'react'

// 数字滚动：分数变化时从旧值平滑滚到新值
const AnimatedNumber = ({ value, duration = 700, signed = false, className = '' }) => {
  const [display, setDisplay] = useState(value)
  const fromRef = useRef(value)
  const [pulse, setPulse] = useState(null)

  useEffect(() => {
    const from = fromRef.current
    if (from === value) {
      return undefined
    }
    setPulse(value > from ? 'up' : 'down')
    const startedAt = performance.now()
    let frame = 0
    const tick = (now) => {
      const progress = Math.min(1, (now - startedAt) / duration)
      const eased = 1 - (1 - progress) ** 3
      setDisplay(Math.round(from + (value - from) * eased))
      if (progress < 1) {
        frame = window.requestAnimationFrame(tick)
      } else {
        fromRef.current = value
      }
    }
    frame = window.requestAnimationFrame(tick)
    const pulseTimer = window.setTimeout(() => setPulse(null), duration + 400)
    return () => {
      window.cancelAnimationFrame(frame)
      window.clearTimeout(pulseTimer)
      fromRef.current = value
    }
  }, [value, duration])

  return (
    <span className={`animated-number ${pulse ? `pulse-${pulse}` : ''} ${className}`.trim()}>
      {signed && display > 0 ? '+' : ''}{display}
    </span>
  )
}

export default AnimatedNumber
