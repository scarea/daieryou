import { useEffect, useRef, useState } from 'react'
import { Stage } from './components/Stage.tsx'
import { GoldDust } from './components/GoldDust.tsx'
import { RecoveryModal } from './components/features.tsx'
import { Button, ConnBanner, Modal, Toasts } from './components/ui.tsx'
import { Login } from './scenes/Login.tsx'
import { Lobby } from './scenes/Lobby.tsx'
import { Table } from './scenes/Table.tsx'
import { Mahjong } from './mahjong/Mahjong.tsx'
import { Liuhu } from './liuhu/Liuhu.tsx'
import { useStore } from './store.ts'
import { sfx } from './sound.ts'

type SceneKey = 'boot' | 'login' | 'lobby' | 'table' | 'mahjong' | 'liuhu'

export function App() {
  const booting = useStore((state) => state.booting)
  const user = useStore((state) => state.user)
  const room = useStore((state) => state.room)
  const result = useStore((state) => state.result)
  const boot = useStore((state) => state.boot)
  const mj = useStore((state) => state.mj)
  const lh = useStore((state) => state.lh)

  useEffect(() => {
    void boot()
  }, [boot])

  const view = result ?? room
  const target: SceneKey = booting ? 'boot' : !user ? 'login' : mj ? 'mahjong' : lh ? 'liuhu' : view ? 'table' : 'lobby'

  // 转场：殿门合上 → 换场景 → 殿门打开
  const [shown, setShown] = useState<SceneKey>(target)
  const [doors, setDoors] = useState<'open' | 'closing' | 'opening'>('open')
  const lastView = useRef(view)
  if (view) lastView.current = view
  const lastMj = useRef(mj)
  if (mj) lastMj.current = mj
  const lastLh = useRef(lh)
  if (lh) lastLh.current = lh
  useEffect(() => {
    if (target === shown) {
      // 刚要切场景又切了回来（比如连点两次开局）：把合到一半的殿门重新打开
      setDoors((current) => (current === 'closing' ? 'open' : current))
      return
    }
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

  // 手机上很容易误触返回（返回键、边缘滑动）：先拦下来问一句
  const [backAsk, setBackAsk] = useState(false)
  const inTable = Boolean(mj || lh || room)
  const inTableRef = useRef(inTable)
  inTableRef.current = inTable
  const leaving = useRef(false)
  useEffect(() => {
    history.pushState({ guard: true }, '')
    const onPop = () => {
      if (leaving.current) return
      history.pushState({ guard: true }, '')
      setBackAsk(true)
    }
    // 刷新、关标签页：在牌桌上时让浏览器再确认一次
    const onUnload = (event: BeforeUnloadEvent) => {
      if (!inTableRef.current || leaving.current) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('popstate', onPop)
    window.addEventListener('beforeunload', onUnload)
    return () => {
      window.removeEventListener('popstate', onPop)
      window.removeEventListener('beforeunload', onUnload)
    }
  }, [])
  const exitApp = () => {
    leaving.current = true
    setBackAsk(false)
    // 跳过拦截用的那一条记录，回到进来之前的页面
    history.go(-2)
  }

  const tableView = view ?? (shown === 'table' ? lastView.current : null)
  return (
    <Stage compact allowTall={shown === 'login' || shown === 'boot'}>
      <div className={`cosmetics ${user?.cardback ? `cb-${user.cardback}` : ''}`}>
        <GoldDust count={shown === 'table' || shown === 'mahjong' || shown === 'liuhu' ? 22 : 70} />
        {shown === 'login' && !user && <Login />}
        {shown === 'lobby' && user && <Lobby />}
        {shown === 'table' && user && tableView && <Table room={tableView} live={room} />}
        {shown === 'mahjong' && user && (mj ?? lastMj.current) && <Mahjong table={(mj ?? lastMj.current)!} />}
        {shown === 'liuhu' && user && (lh ?? lastLh.current) && <Liuhu table={(lh ?? lastLh.current)!} />}
        <RecoveryModal />
        {backAsk && (
          <Modal title="要退出吗" onClose={() => setBackAsk(false)} width={520}>
            <p className="modal-lead">{inTable
              ? <>你还在牌桌上。现在退出，这一局会由机器人替你打完，<br />输赢照常算在你头上。</>
              : <>刚才按到了返回。确定要离开金殿棋牌吗？</>}</p>
            <div className="modal-actions">
              <Button kind="ghost" size="md" onClick={exitApp}>退出</Button>
              <Button kind="gold" size="md" onClick={() => setBackAsk(false)}>{inTable ? '继续打' : '留下'}</Button>
            </div>
          </Modal>
        )}
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
