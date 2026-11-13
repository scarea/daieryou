// 舞台：整个界面画在一块固定尺寸的画布上，再等比缩放铺满窗口。
//  - wide：1280×720，电脑与平板。
//  - phone：1280×592，手机横屏（竖着拿时自动横置）。画布更矮，同样的元素在手机上显示得更大。
//  - tall：竖屏手机上的登录页，不旋转，方便打字。
import { ReactNode, createContext, useContext, useEffect, useState } from 'react'

export type StageMode = 'wide' | 'phone' | 'tall'

interface Layout {
  mode: StageMode
  width: number
  height: number
  scale: number
  rotated: boolean
}

const PHONE_MAX = 560

function measure(compact: boolean, allowTall: boolean): Layout {
  const w = window.innerWidth
  const h = window.innerHeight
  const portrait = h > w
  const phone = Math.min(w, h) < PHONE_MAX
  if (phone && portrait && allowTall) {
    const width = 600
    const height = Math.max(900, Math.round((width * h) / w))
    return { mode: 'tall', width, height, scale: Math.min(w / width, h / height), rotated: false }
  }
  const long = Math.max(w, h)
  const short = Math.min(w, h)
  if (phone && compact) {
    return { mode: 'phone', width: 1280, height: 592, scale: Math.min(long / 1280, short / 592), rotated: portrait }
  }
  const rotated = portrait && phone
  return { mode: 'wide', width: 1280, height: 720, scale: rotated ? Math.min(long / 1280, short / 720) : Math.min(w / 1280, h / 720), rotated }
}

const StageContext = createContext<{ mode: StageMode; rotated: boolean }>({ mode: 'wide', rotated: false })
export const useStage = () => useContext(StageContext)

/** 把屏幕上的位移换算成舞台上"往上"的距离（舞台横置时方向不同） */
export function stageUp(rotated: boolean, dx: number, dy: number): number {
  return rotated ? dx : -dy
}

export function Stage({ children, compact = false, allowTall = false }: { children: ReactNode; compact?: boolean; allowTall?: boolean }) {
  const [layout, setLayout] = useState(() => measure(compact, allowTall))
  useEffect(() => {
    const update = () => setLayout(measure(compact, allowTall))
    update()
    window.addEventListener('resize', update)
    window.addEventListener('orientationchange', update)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('orientationchange', update)
    }
  }, [compact, allowTall])
  return (
    <div className="viewport">
      <div
        className={`stage mode-${layout.mode}`}
        style={{
          width: layout.width,
          height: layout.height,
          transform: `translate(-50%, -50%) rotate(${layout.rotated ? 90 : 0}deg) scale(${layout.scale})`,
        }}
      >
        <StageContext.Provider value={{ mode: layout.mode, rotated: layout.rotated }}>{children}</StageContext.Provider>
      </div>
    </div>
  )
}
