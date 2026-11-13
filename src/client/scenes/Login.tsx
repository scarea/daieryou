// 登录殿：登录 / 注册 / 游客试玩。
import { FormEvent, useState } from 'react'
import { makeCard } from '../../shared/cards.ts'
import { AVATARS } from '../../shared/economy.ts'
import { Avatar, Button } from '../components/ui.tsx'
import { CardView } from '../components/CardView.tsx'
import { api } from '../net.ts'
import { useStore } from '../store.ts'
import { sfx } from '../sound.ts'

const LEFT_FAN = [makeCard('S', 1), makeCard('H', 1), makeCard('D', 1)]
const RIGHT_FAN = [makeCard('H', 12), makeCard('H', 13), makeCard(null, 15)]

function Fan({ cards, side }: { cards: ReturnType<typeof makeCard>[]; side: 'left' | 'right' }) {
  return (
    <div className={`login-fan ${side}`}>
      {cards.map((card, index) => (
        <div key={card.id} className="login-fan-card" style={{ ['--i' as string]: index - 1 }}>
          <CardView card={card} />
        </div>
      ))}
    </div>
  )
}

export function Login() {
  const authenticate = useStore((state) => state.authenticate)
  const toast = useStore((state) => state.toast)
  const [mode, setMode] = useState<'login' | 'register' | 'reset'>('login')
  const [recovery, setRecovery] = useState('')
  const setRecoveryCode = useStore((state) => state.setRecoveryCode)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [nickname, setNickname] = useState('')
  const [avatar, setAvatar] = useState(0)
  const [busy, setBusy] = useState(false)

  const run = async (target: 'login' | 'register' | 'guest') => {
    if (busy) return
    setBusy(true)
    try {
      await authenticate(target, target === 'guest' ? {} : { username, password, nickname, avatar })
      sfx.gong()
    } catch (error) {
      toast((error as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const reset = async () => {
    if (busy) return
    setBusy(true)
    try {
      const data = await api<{ recoveryCode: string }>('/auth/reset', { username, recoveryCode: recovery, password })
      await authenticate('login', { username, password })
      setRecoveryCode(data.recoveryCode)
      toast('密码已重设，恢复码已更新', 'gold')
    } catch (error) {
      toast((error as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (mode === 'reset') void reset()
    else void run(mode)
  }

  return (
    <div className={`scene login ${mode === 'register' ? 'is-register' : ''}`}>
      <div className="login-rays" />
      <Fan cards={LEFT_FAN} side="left" />
      <Fan cards={RIGHT_FAN} side="right" />

      <header className="login-brand">
        <div className="brand-seal">棋牌</div>
        <h1 className="brand-title gold-text">金殿</h1>
        <p className="brand-sub">
          <i />
          <span>红中麻将 · 逮二游 · 约上好友开一桌</span>
          <i />
        </p>
      </header>

      <form className="panel login-panel" onSubmit={submit}>
        <div className="tabs">
          <button type="button" className={`tab ${mode === 'login' ? 'on' : ''}`} onClick={() => { sfx.click(); setMode('login') }}>登 录</button>
          <button type="button" className={`tab ${mode === 'register' ? 'on' : ''}`} onClick={() => { sfx.click(); setMode('register') }}>注 册</button>
        </div>

        <label className="field">
          <em>账号</em>
          <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="3~16 位字母或数字" autoComplete="username" maxLength={16} />
        </label>
        <label className="field">
          <em>密码</em>
          <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={mode === 'reset' ? '设置新密码，至少 6 位' : '至少 6 位'} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} maxLength={64} />
        </label>
        {mode === 'reset' && (
          <label className="field">
            <em>恢复码</em>
            <input className="input recovery-input" value={recovery} onChange={(e) => setRecovery(e.target.value.toUpperCase())} placeholder="XXXX-XXXX-XXXX" maxLength={20} />
          </label>
        )}
        {mode === 'register' && (
          <>
            <label className="field">
              <em>昵称</em>
              <input className="input" value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="牌桌上的名号（可不填）" maxLength={12} />
            </label>
            <div className="avatar-picker">
              {AVATARS.map((def, index) => (
                <button key={def.glyph} type="button" className={`avatar-option ${avatar === index ? 'on' : ''}`} onClick={() => { sfx.select(); setAvatar(index) }} title={def.name}>
                  <Avatar index={index} size={38} ring={false} />
                </button>
              ))}
            </div>
          </>
        )}

        <div className="login-actions">
          <button type="submit" className="btn btn-gold btn-lg login-submit" disabled={busy}>
            <span>{mode === 'login' ? '进入金殿' : mode === 'register' ? '注册并进入' : '重设密码'}</span>
          </button>
          {mode === 'reset'
            ? <Button kind="ghost" size="md" onClick={() => setMode('login')}>返回登录</Button>
            : <Button kind="ghost" size="md" onClick={() => void run('guest')} disabled={busy}>游客试玩</Button>}
        </div>
        <p className="login-tip">
          {mode === 'login'
            ? <>新人入殿即赠 <b>5,000</b> 金币 · <button type="button" className="link" onClick={() => setMode('reset')}>忘记密码？</button></>
            : mode === 'register' ? <>注册后会给你一个<b>恢复码</b>，请妥善保存以便找回密码</> : <>没有恢复码？请联系管理员重置密码</>}
        </p>
      </form>

      <footer className="login-foot">健康游戏 · 理性娱乐 ｜ 本游戏金币仅供娱乐，不可兑换任何现实财物</footer>
    </div>
  )
}
