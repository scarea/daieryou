import { useEffect, useRef, useState } from 'react'
import { Stage } from './components/Stage.tsx'
import { GoldDust } from './components/GoldDust.tsx'
import { RecoveryModal } from './components/features.tsx'
import { ConnBanner, Toasts } from './components/ui.tsx'
import { Login } from './scenes/Login.tsx'
import { Lobby } from './scenes/Lobby.tsx'
import { Table } from './scenes/Table.tsx'
import { Mahjong } from './mahjong/Mahjong.tsx'
import { useStore } from './store.ts'
import { sfx } from './sound.ts'

type SceneKey = 'boot' | 'login' | 'lobby' | 'table' | 'mahjong'

export function App() {
  const booting = useStore((state) => state.booting)
  const user = useStore((state) => state.user)
  const room = useStore((state) => state.room)
  const result = useStore((state) => state.result)
  const boot = useStore((state) => state.boot)
  const mj = useStore((state) => state.mj)

  useEffect(() => {
    void boot()
  }, [boot])

  const view = result ?? room
  const target: SceneKey = booting ? 'boot' : !user ? 'login' : mj ? 'mahjong' : view ? 'table' : 'lobby'

  // 转场：殿门合上 → 换场景 → 殿门打开
  const [shown, setShown] = useState<SceneKey>(target)
  const [doors, setDoors] = useState<'open' | 'closing' | 'opening'>('open')
  const lastView = useRef(view)
  if (view) lastView.current = view
  const lastMj = useRef(mj)
  if (mj) lastMj.current = mj
  useEffect(() => {
    if (target === shown) return
    if (shown === 'boot') {
      setShown(target)
      return
    }
    setDoors('closing')
    sfx.doors()
    const swap = window.setTimeout(() => {
      setShown(target)
      setDoors('opening')
    }, 380)
    const done = window.setTimeout(() => setDoors('open'), 380 + 520)
    return () => {
      window.clearTimeout(swap)
      window.clearTimeout(done)
    }
  }, [target]) // eslint-disable-line react-hooks/exhaustive-deps

  const tableView = view ?? (shown === 'table' ? lastView.current : null)
  return (
    <Stage>
      <div className={`cosmetics ${user?.cardback ? `cb-${user.cardback}` : ''}`}>
        <GoldDust count={shown === 'table' || shown === 'mahjong' ? 22 : 70} />
        {shown === 'login' && !user && <Login />}
        {shown === 'lobby' && user && <Lobby />}
        {shown === 'table' && user && tableView && <Table room={tableView} live={room} />}
        {shown === 'mahjong' && user && (mj ?? lastMj.current) && <Mahjong table={(mj ?? lastMj.current)!} />}
        <RecoveryModal />
      </div>
      <div className={`doors doors-${doors}`}>
        <i className="door door-left" />
        <i className="door door-right" />
      </div>
      <Toasts />
      <ConnBanner />
    </Stage>
  )
}
