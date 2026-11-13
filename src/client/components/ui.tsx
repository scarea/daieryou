// 通用 UI 小部件：头像、金币、弹窗、提示条、爵位徽章。
import { ReactNode, useEffect, useRef, useState } from 'react'
import { AVATARS, formatCoins, levelOf, titleOf } from '../../shared/economy.ts'
import { useStore } from '../store.ts'
import { music, sfx, voice } from '../sound.ts'

export function Avatar({ index, size = 64, ring = true, dim = false, frame = '' }: { index: number; size?: number; ring?: boolean; dim?: boolean; frame?: string }) {
  const def = AVATARS[index] ?? AVATARS[0]
  return (
    <div
      className={`avatar ${ring ? 'avatar-ring' : ''} ${dim ? 'avatar-dim' : ''} ${frame}`}
      style={{ width: size, height: size, fontSize: size * 0.52, background: `radial-gradient(circle at 35% 28%, ${def.from}, ${def.to} 78%)` }}
    >
      <span>{def.glyph}</span>
      {frame && <i className="frame-deco" />}
    </div>
  )
}

export function CoinIcon({ size = 22 }: { size?: number }) {
  return <span className="coin-icon" style={{ width: size, height: size, fontSize: size * 0.56 }}>¥</span>
}

export function Coins({ value, signed = false, size = 20 }: { value: number; signed?: boolean; size?: number }) {
  const text = `${signed && value > 0 ? '+' : ''}${formatCoins(value)}`
  return (
    <span className={`coins ${signed ? (value > 0 ? 'up' : value < 0 ? 'down' : '') : ''}`} style={{ fontSize: size }}>
      <CoinIcon size={size * 1.05} />
      <b>{text}</b>
    </span>
  )
}

export function TitleBadge({ honor, small = false }: { honor: number; small?: boolean }) {
  const { title } = titleOf(honor)
  return (
    <span className={`title-badge ${small ? 'small' : ''}`} style={{ color: title.color, borderColor: title.color }}>
      {title.name}
    </span>
  )
}

export function LevelTag({ exp }: { exp: number }) {
  return <span className="level-tag">Lv.{levelOf(exp).level}</span>
}

export function Button({
  children, onClick, kind = 'gold', size = 'md', disabled = false, className = '',
}: {
  children: ReactNode
  onClick?: () => void
  kind?: 'gold' | 'red' | 'ghost' | 'jade'
  size?: 'sm' | 'md' | 'lg'
  disabled?: boolean
  className?: string
}) {
  return (
    <button
      type="button"
      className={`btn btn-${kind} btn-${size} ${className}`}
      disabled={disabled}
      onClick={() => {
        sfx.click()
        onClick?.()
      }}
    >
      <span>{children}</span>
    </button>
  )
}

export function Modal({ title, onClose, children, width = 640 }: { title: string; onClose: () => void; children: ReactNode; width?: number }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="modal-mask" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div className="panel modal" style={{ width }}>
        <div className="modal-title">
          <i className="flourish" />
          <span className="gold-text">{title}</span>
          <i className="flourish flip" />
        </div>
        <button type="button" className="modal-close" onClick={() => { sfx.click(); onClose() }} aria-label="关闭">✕</button>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  )
}

export function Toasts() {
  const toasts = useStore((state) => state.toasts)
  return (
    <div className="toasts">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast-${toast.kind}`}>{toast.text}</div>
      ))}
    </div>
  )
}

export function ConnBanner() {
  const conn = useStore((state) => state.conn)
  const user = useStore((state) => state.user)
  if (!user || conn === 'open' || conn === 'idle') return null
  return <div className="conn-banner">{conn === 'connecting' ? '正在进入金殿…' : '连接中断，正在重连…'}</div>
}

export function SoundToggle() {
  const [muted, setMuted] = useState(sfx.isMuted())
  const toggle = () => {
    sfx.setMuted(!muted)
    setMuted(!muted)
    if (muted) sfx.pop()
  }
  return (
    <button type="button" className={`icon-btn ${muted ? 'is-off' : ''}`} onClick={toggle} title={muted ? '开启音效' : '关闭音效'}>
      ♪
    </button>
  )
}

export function MusicToggle() {
  const [on, setOn] = useState(music.isOn())
  return (
    <button
      type="button"
      className={`icon-btn ${on ? '' : 'is-off'}`}
      title={on ? '关闭音乐' : '开启音乐'}
      onClick={() => {
        music.setOn(!on)
        setOn(!on)
        sfx.click()
      }}
    >
      乐
    </button>
  )
}

/** 数字滚动：从上一次的值平滑过渡到新值 */
export function useCountUp(target: number, duration = 900, delay = 0, tick = false): number {
  const [value, setValue] = useState(target)
  const fromRef = useRef(target)
  useEffect(() => {
    const from = fromRef.current
    if (from === target) return
    let raf = 0
    let lastTick = 0
    const startAt = performance.now() + delay
    const step = (now: number) => {
      const t = Math.min(1, Math.max(0, (now - startAt) / duration))
      const eased = 1 - (1 - t) ** 3
      const current = Math.round(from + (target - from) * eased)
      setValue(current)
      if (tick && t > 0 && now - lastTick > 70) {
        lastTick = now
        sfx.count()
      }
      if (t < 1) raf = requestAnimationFrame(step)
      else fromRef.current = target
    }
    raf = requestAnimationFrame(step)
    return () => {
      cancelAnimationFrame(raf)
      fromRef.current = target
    }
  }, [target, duration, delay, tick])
  return value
}

export function CountUp({ value, from, duration, delay, signed = false, tick = false }: { value: number; from?: number; duration?: number; delay?: number; signed?: boolean; tick?: boolean }) {
  const [target, setTarget] = useState(from ?? value)
  useEffect(() => setTarget(value), [value])
  const current = useCountUp(target, duration, delay, tick)
  return <>{signed && current > 0 ? '+' : ''}{formatCoins(current)}</>
}

export function VoiceToggle() {
  const [on, setOn] = useState(voice.isOn())
  return (
    <button
      type="button"
      className={`icon-btn ${on ? '' : 'is-off'}`}
      title={on ? '关闭语音报牌' : '开启语音报牌'}
      onClick={() => {
        voice.setOn(!on)
        setOn(!on)
        if (!on) voice.say('语音已开启')
      }}
    >
      语
    </button>
  )
}
