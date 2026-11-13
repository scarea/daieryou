// 平台大厅：选游戏 → 选场次 → 开一桌（人机、快速匹配、好友约局），以及签到、任务、商城、好友等。
import { useEffect, useState } from 'react'
import { HALLS, RELIEF_THRESHOLD, formatCoins, hallById, levelOf, titleOf } from '../../shared/economy.ts'
import { GAMES, GameId, gameById } from '../../shared/games.ts'
import { DEFAULT_OPTIONS, MjOptions } from '../../shared/mahjong/game.ts'
import { MJ_LEVELS, MJ_LEVEL_DESC, MJ_LEVEL_NAME, MjLevel } from '../../shared/mahjong/view.ts'
import { BOT_LEVEL_NAME, BotLevel, LobbyRoom } from '../../shared/protocol.ts'
import { AdminModal, FriendsModal, GrowthModal, ShopModal, Tutorial } from '../components/features.tsx'
import { LeaderboardModal, ProfileModal, RecordsModal, RulesModal, SigninModal } from '../components/panels.tsx'
import { useStage } from '../components/Stage.tsx'
import { Avatar, Button, Coins, Modal, MusicToggle, SoundToggle, TitleBadge } from '../components/ui.tsx'
import { useStore } from '../store.ts'
import { sfx } from '../sound.ts'

type ModalKey = 'signin' | 'rank' | 'records' | 'rules' | 'profile' | 'shop' | 'growth' | 'friends' | 'admin' | 'tutorial' | 'tables' | null

const HALL_GLYPH: Record<string, string> = { qingyun: '云', liujin: '金', longfeng: '凤', lingxiao: '霄' }
const BOT_LEVELS: BotLevel[] = ['easy', 'normal', 'hard', 'peek']
const BOT_TIP: Record<BotLevel, string> = {
  easy: '新手：只会凑大牌，适合熟悉玩法',
  normal: '老手：懂得避开第二名，偶有失手',
  hard: '高手：精于算计，既争头名也会垫底',
  peek: '千王：能透视你的手牌（娱乐难度）',
}
const TIPS: Record<GameId, string[]> = {
  mahjong: [
    '只能自摸，没有点炮 —— 不用防守，专心把牌效打好。',
    '杀鬼（胡牌时手里没有红中）分数翻倍。',
    '放杠要付 3 分：手里捏着三张的牌，别人大概率也在等。',
    '抓鸟看点数：一、九、红中 10 分，其余点数加一。',
    '人机试炼里打开「教练提示」，能看到每张牌打出去之后的进张数。',
  ],
  d2y: [
    '第二名才是输家 —— 牌不够大时，不妨干脆出最小的。',
    '越往后分值越高，好牌留到第四、五轮更值钱。',
    '第四轮的公牌是暗牌，留什么牌进终局同样关键。',
    '大小王是赖子，能自动变成最合适的那张牌。',
  ],
}

const read = <T,>(key: string, parse: (value: string) => T | null, fallback: T): T => {
  try {
    const value = localStorage.getItem(key)
    return (value !== null ? parse(value) : null) ?? fallback
  } catch {
    return fallback
  }
}
const save = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value)
  } catch {
    // ignore
  }
}

function TableList({ rooms, onJoin, onWatch }: { rooms: LobbyRoom[]; onJoin: (id: string) => void; onWatch: (id: string) => void }) {
  if (rooms.length === 0) return <div className="empty">还没有人开桌<br /><small>开一桌，把房号发给朋友</small></div>
  return (
    <>
      {rooms.map((room) => {
        const joinable = room.status === 'waiting' && room.players.length < room.seats
        return (
          <div key={room.id} className="room-row">
            <span className={`game-tag game-${room.game}`}>{gameById(room.game)?.glyph}</span>
            <div className="room-avatars">
              {room.players.map((player, index) => <Avatar key={index} index={player.avatar} size={30} ring={false} />)}
              {Array.from({ length: room.seats - room.players.length }, (_, index) => <span key={index} className="seat-empty" />)}
            </div>
            <div className="room-meta">
              <b>{room.hostName} 的牌桌</b>
              <small>{gameById(room.game)?.name} · {hallById(room.hallId)?.name} · #{room.id}</small>
            </div>
            {joinable
              ? <Button kind="jade" size="sm" onClick={() => onJoin(room.id)}>加入</Button>
              : room.status === 'playing' && room.game === 'd2y'
                ? <Button kind="ghost" size="sm" onClick={() => onWatch(room.id)}>观战</Button>
                : <span className="room-state">{room.status === 'waiting' ? '已满' : '对局中'}</span>}
          </div>
        )
      })}
    </>
  )
}

export function Lobby() {
  const user = useStore((state) => state.user)!
  const signin = useStore((state) => state.signin)
  const lobby = useStore((state) => state.lobby)
  const send = useStore((state) => state.send)
  const toast = useStore((state) => state.toast)
  const refreshMe = useStore((state) => state.refreshMe)
  const { mode } = useStage()
  const [modal, setModal] = useState<ModalKey>(null)
  const [game, setGame] = useState<GameId>(() => read('daieryou.game', (value) => (gameById(value) ? (value as GameId) : null), GAMES[0].id))
  const [hallId, setHallId] = useState(() => {
    const affordable = HALLS.filter((hall) => user.coins >= hall.minCoins)
    return (affordable[Math.min(affordable.length - 1, 1)] ?? HALLS[0]).id
  })
  const [botLevel, setBotLevel] = useState<BotLevel>(() => read('daieryou.botLevel', (value) => (BOT_LEVELS.includes(value as BotLevel) ? (value as BotLevel) : null), 'normal'))
  const [mjLevel, setMjLevel] = useState<MjLevel>(() => read('daieryou.mjLevel', (value) => (MJ_LEVELS.includes(value as MjLevel) ? (value as MjLevel) : null), 'normal'))
  const [mjOptions, setMjOptions] = useState<MjOptions>(() => read('daieryou.mjOptions', (value) => ({ ...DEFAULT_OPTIONS, ...JSON.parse(value) }), DEFAULT_OPTIONS))
  const [isPrivate, setIsPrivate] = useState(false)
  const [roomCode, setRoomCode] = useState('')
  const [tipIndex, setTipIndex] = useState(0)

  useEffect(() => {
    refreshMe().catch(() => {})
  }, [refreshMe])

  useEffect(() => {
    const timer = window.setInterval(() => setTipIndex((value) => value + 1), 6000)
    return () => window.clearInterval(timer)
  }, [])

  // 今日未签到：进大厅时提醒一次
  useEffect(() => {
    if (signin && !signin.signedToday && !sessionStorage.getItem('daieryou.signinShown')) {
      sessionStorage.setItem('daieryou.signinShown', '1')
      setModal((current) => current ?? 'signin')
    }
  }, [signin])

  const info = gameById(game) ?? GAMES[0]
  const hall = hallById(hallId) ?? HALLS[0]
  const level = levelOf(user.exp)
  const rank = titleOf(user.honor)
  const tips = TIPS[game]

  const guard = (): boolean => {
    if (user.coins >= hall.minCoins) return true
    toast(`金币不足：${hall.name}至少需要 ${formatCoins(hall.minCoins)} 金币`, 'error')
    if (user.coins < RELIEF_THRESHOLD) setModal('signin')
    return false
  }
  const pickGame = (value: GameId) => {
    sfx.select()
    setGame(value)
    save('daieryou.game', value)
  }
  const setOption = (key: keyof MjOptions, value: boolean) => {
    const next = { ...mjOptions, [key]: value }
    setMjOptions(next)
    save('daieryou.mjOptions', JSON.stringify(next))
  }
  const join = (roomId: string) => void send({ op: 'join', roomId }).then((ok) => { if (ok) setModal(null) })
  const watch = (roomId: string) => void send({ op: 'spectate', roomId }).then((ok) => { if (ok) setModal(null) })

  const playWithBots = () => {
    if (!guard()) return
    void send(game === 'mahjong' ? { op: 'mj:start', hallId, level: mjLevel, options: mjOptions } : { op: 'quick', hallId, botLevel })
  }
  const quickMatch = () => {
    if (!guard()) return
    void send(game === 'mahjong' ? { op: 'mj:match', hallId } : { op: 'match', hallId })
  }
  const createTable = () => {
    if (!guard()) return
    void send(game === 'mahjong' ? { op: 'mj:create', hallId, isPrivate, level: mjLevel, options: mjOptions } : { op: 'create', hallId, isPrivate })
  }

  const menu: [Exclude<ModalKey, null>, string, string, boolean][] = [
    ['signin', '签', '每日签到', Boolean(signin && !signin.signedToday)],
    ['tables', '桌', '找牌桌', lobby.rooms.some((room) => room.status === 'waiting')],
    ['friends', '友', '好友', false],
    ['growth', '勋', '任务成就', false],
    ['shop', '宝', '珍宝阁', false],
    ['rank', '榜', '风云榜', false],
    ['records', '录', '我的战绩', false],
    ['rules', '规', '玩法规则', false],
    ...(user.isAdmin ? [['admin', '管', '运营后台', false] as [Exclude<ModalKey, null>, string, string, boolean]] : []),
  ]

  return (
    <div className="scene lobby">
      {/* ------------------------------ 顶栏 ------------------------------ */}
      <header className="lobby-top">
        <button type="button" className="me-card" onClick={() => { sfx.click(); setModal('profile') }}>
          <Avatar index={user.avatar} size={mode === 'phone' ? 48 : 62} frame={user.frame} />
          <div className="me-info">
            <div className="me-name">
              <span>{user.nickname}</span>
              <TitleBadge honor={user.honor} small />
            </div>
            <div className="me-level">
              <span className="level-tag">Lv.{level.level}</span>
              <div className="bar"><i style={{ width: `${(level.current / level.need) * 100}%` }} /></div>
            </div>
          </div>
        </button>

        <div className="lobby-logo">
          <span className="gold-text">金殿</span>
          <em>棋牌</em>
        </div>

        <div className="lobby-wallet">
          <div className="pill" title="金币">
            <Coins value={user.coins} size={20} />
            <button type="button" className="pill-plus" onClick={() => { sfx.click(); setModal('signin') }}>+</button>
          </div>
          <div className="pill" title={rank.next ? `距离「${rank.next.name}」还差 ${rank.next.min - user.honor} 荣誉` : '已登峰造极'}>
            <span className="honor-icon">誉</span>
            <b className="num">{user.honor}</b>
          </div>
          <MusicToggle />
          <SoundToggle />
        </div>
      </header>

      {/* ------------------------------ 功能菜单 ------------------------------ */}
      <nav className="lobby-menu">
        {menu.map(([key, glyph, label, dot]) => (
          <button key={key} type="button" className="menu-item" onClick={() => { sfx.click(); setModal(key) }}>
            <span className="menu-glyph">{glyph}</span>
            <span className="menu-label">{label}</span>
            {dot && <i className="menu-dot" />}
          </button>
        ))}
        <div className="online"><i /> 在线 <b className="num">{Math.max(1, lobby.online)}</b> 人</div>
      </nav>

      {/* ------------------------------ 选游戏 ------------------------------ */}
      <section className="game-cards">
        {GAMES.map((item) => {
          const open = lobby.rooms.filter((room) => room.game === item.id && room.status === 'waiting').length
          return (
            <button key={item.id} type="button" className={`game-card game-${item.id} ${game === item.id ? 'on' : ''}`} onClick={() => pickGame(item.id)}>
              <span className="game-glyph">{item.glyph}</span>
              <span className="game-text">
                <b className="gold-text">{item.name}</b>
                <small>{item.tagline}</small>
              </span>
              {open > 0 && <i className="game-open">{open} 桌等人</i>}
            </button>
          )
        })}
      </section>

      {/* ------------------------------ 选场次 ------------------------------ */}
      <section className="halls">
        {HALLS.map((item, index) => {
          const locked = user.coins < item.minCoins
          return (
            <button
              key={item.id}
              type="button"
              className={`hall hall-${index} ${hallId === item.id ? 'on' : ''} ${locked ? 'locked' : ''}`}
              style={{ animationDelay: `${0.08 * index}s` }}
              onClick={() => { sfx.select(); setHallId(item.id) }}
            >
              <span className="hall-cap" />
              <span className="hall-glyph">{HALL_GLYPH[item.id]}</span>
              <span className="hall-name gold-text">{item.name}</span>
              <span className="hall-stake">
                <small>{game === 'mahjong' ? '每分' : '底注'}</small>
                <b className="num">{formatCoins(item.stake)}</b>
              </span>
              <span className="hall-min">{locked ? `需 ${formatCoins(item.minCoins)} 金币` : `${formatCoins(item.minCoins)} 金币入场`}</span>
              {locked && <span className="hall-lock">未解锁</span>}
            </button>
          )
        })}
      </section>

      <div className="lobby-tip">
        <b>{info.name}</b>
        <span key={`${game}-${tipIndex}`}>{tips[tipIndex % tips.length]}</span>
      </div>

      {/* ------------------------------ 开一桌 ------------------------------ */}
      <aside className="panel play-panel">
        <div className="panel-title gold-text">{info.name} · {hall.name}</div>
        <div className="divider" />
        <div className="play-body">
          <div className="play-row">
            <span className="muted">{game === 'mahjong' ? '每分' : '底注'}</span>
            <Coins value={hall.stake} size={17} />
            <span className="muted" style={{ marginLeft: 'auto' }}>{info.seats} 人一桌 · 空位可由机器人补</span>
          </div>

          <div className="seg">
            {game === 'mahjong'
              ? MJ_LEVELS.map((value) => (
                <button key={value} type="button" className={mjLevel === value ? 'on' : ''} onClick={() => { sfx.select(); setMjLevel(value); save('daieryou.mjLevel', value) }}>{MJ_LEVEL_NAME[value]}</button>
              ))
              : BOT_LEVELS.map((value) => (
                <button key={value} type="button" className={botLevel === value ? 'on' : ''} onClick={() => { sfx.select(); setBotLevel(value); save('daieryou.botLevel', value) }}>{BOT_LEVEL_NAME[value].split('·')[0]}</button>
              ))}
          </div>
          <p className="seg-tip">机器人水平 · {game === 'mahjong' ? MJ_LEVEL_DESC[mjLevel].split('：')[1] : BOT_TIP[botLevel].split('：')[1]}</p>

          <div className="play-duo">
            <Button kind="gold" size="lg" onClick={playWithBots}>{game === 'mahjong' ? '人机试炼' : '人机对战'}</Button>
            <Button kind="jade" size="lg" onClick={quickMatch}>快速匹配</Button>
          </div>
          <div className="play-friends">
            <Button kind="red" size="md" onClick={createTable}>和朋友开一桌</Button>
            <label className="check">
              <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} />
              <i />
              私密
            </label>
          </div>
          <form
            className="join-row"
            onSubmit={(event) => {
              event.preventDefault()
              if (!/^\d{6}$/.test(roomCode.trim())) return toast('请输入 6 位房号', 'error')
              join(roomCode.trim())
            }}
          >
            <input className="input plain" value={roomCode} onChange={(e) => setRoomCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="输入朋友给的 6 位房号" inputMode="numeric" />
            <button type="submit" className="btn btn-ghost btn-sm"><span>加入</span></button>
          </form>

          {game === 'mahjong' && (
            <div className="mj-options">
              <label className="check"><input type="checkbox" checked={mjOptions.sevenPairs} onChange={(e) => setOption('sevenPairs', e.target.checked)} /><i />七对算胡</label>
              <label className="check"><input type="checkbox" checked={mjOptions.fourZhong} onChange={(e) => setOption('fourZhong', e.target.checked)} /><i />四红中直接胡</label>
              <label className="check"><input type="checkbox" checked={mjOptions.zhongDiscard} onChange={(e) => setOption('zhongDiscard', e.target.checked)} /><i />红中可打出</label>
            </div>
          )}
        </div>
      </aside>

      {/* ------------------------------ 正在等人的牌桌（电脑上常驻，手机上在「找牌桌」里） ------------------------------ */}
      <aside className="panel rooms-panel">
        <div className="panel-title gold-text">正在开桌</div>
        <div className="divider" />
        <div className="rooms-list scroll"><TableList rooms={lobby.rooms} onJoin={join} onWatch={watch} /></div>
      </aside>

      {modal === 'tables' && (
        <Modal title="找牌桌" onClose={() => setModal(null)} width={640}>
          <div className="tables-modal scroll"><TableList rooms={lobby.rooms} onJoin={join} onWatch={watch} /></div>
        </Modal>
      )}
      {modal === 'signin' && <SigninModal onClose={() => setModal(null)} />}
      {modal === 'rank' && <LeaderboardModal onClose={() => setModal(null)} />}
      {modal === 'records' && <RecordsModal onClose={() => setModal(null)} />}
      {modal === 'rules' && <RulesModal initial={game} onClose={() => setModal(null)} onTutorial={() => setModal('tutorial')} />}
      {modal === 'profile' && <ProfileModal onClose={() => setModal(null)} />}
      {modal === 'shop' && <ShopModal onClose={() => setModal(null)} />}
      {modal === 'growth' && <GrowthModal onClose={() => setModal(null)} />}
      {modal === 'friends' && <FriendsModal onClose={() => setModal(null)} />}
      {modal === 'admin' && <AdminModal onClose={() => setModal(null)} />}
      {modal === 'tutorial' && <Tutorial onClose={() => setModal(null)} />}
    </div>
  )
}
