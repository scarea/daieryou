// 背景金粉粒子：缓慢上浮、闪烁，营造金殿氛围。
import { useEffect, useRef } from 'react'

interface Mote {
  x: number
  y: number
  r: number
  vy: number
  vx: number
  phase: number
  speed: number
}

export function GoldDust({ count = 70 }: { count?: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const W = 1280
    const H = 1280
    canvas.width = W
    canvas.height = H
    const motes: Mote[] = Array.from({ length: count }, () => ({
      x: Math.random() * W,
      y: Math.random() * H,
      r: 0.6 + Math.random() * 2.2,
      vy: -(0.08 + Math.random() * 0.35),
      vx: (Math.random() - 0.5) * 0.18,
      phase: Math.random() * Math.PI * 2,
      speed: 0.008 + Math.random() * 0.025,
    }))
    let frame = 0
    let raf = 0
    const draw = () => {
      frame += 1
      ctx.clearRect(0, 0, W, H)
      ctx.globalCompositeOperation = 'lighter'
      for (const mote of motes) {
        mote.x += mote.vx + Math.sin(frame * 0.01 + mote.phase) * 0.12
        mote.y += mote.vy
        if (mote.y < -10) {
          mote.y = H + 10
          mote.x = Math.random() * W
        }
        const alpha = 0.25 + 0.55 * Math.abs(Math.sin(frame * mote.speed + mote.phase))
        const glow = ctx.createRadialGradient(mote.x, mote.y, 0, mote.x, mote.y, mote.r * 4)
        glow.addColorStop(0, `rgba(255, 236, 170, ${alpha})`)
        glow.addColorStop(0.4, `rgba(246, 200, 90, ${alpha * 0.45})`)
        glow.addColorStop(1, 'rgba(246, 200, 90, 0)')
        ctx.fillStyle = glow
        ctx.beginPath()
        ctx.arc(mote.x, mote.y, mote.r * 4, 0, Math.PI * 2)
        ctx.fill()
      }
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [count])
  return <canvas ref={ref} className="gold-dust" />
}
