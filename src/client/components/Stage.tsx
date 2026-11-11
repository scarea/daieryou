// 固定 1280×720 设计稿的舞台：整体等比缩放铺满窗口；竖屏手机自动横置。
import { ReactNode, useEffect, useState } from 'react'

export const STAGE_W = 1280
export const STAGE_H = 720

function measure() {
  const width = window.innerWidth
  const height = window.innerHeight
  const rotated = height > width && width < 820
  const scale = rotated ? Math.min(height / STAGE_W, width / STAGE_H) : Math.min(width / STAGE_W, height / STAGE_H)
  return { scale, rotated }
}

export function Stage({ children }: { children: ReactNode }) {
  const [layout, setLayout] = useState(measure)
  useEffect(() => {
    const update = () => setLayout(measure())
    window.addEventListener('resize', update)
    window.addEventListener('orientationchange', update)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('orientationchange', update)
    }
  }, [])
  return (
    <div className="viewport">
      <div
        className="stage"
        style={{ transform: `translate(-50%, -50%) rotate(${layout.rotated ? 90 : 0}deg) scale(${layout.scale})` }}
      >
        {children}
      </div>
    </div>
  )
}
