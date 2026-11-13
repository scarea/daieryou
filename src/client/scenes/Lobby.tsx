// 大厅：选择场次、人机对战、好友约战、签到 / 排行 / 战绩 / 个人中心。
import { useEffect, useState } from 'react'
import { HALLS, RELIEF_THRESHOLD, formatCoins, hallById, levelOf, titleOf } from '../../shared/economy.ts'
import { BOT_LEVEL_NAME, BotLevel } from '../../shared/protocol.ts'
import { Avatar, Button, Coins, MusicToggle, SoundToggle, TitleBadge } from '../components/ui.tsx'
import { AdminModal, FriendsModal, GrowthModal, ShopModal, Tutorial, tutorialSeen } from '../components/features.tsx'
import { LeaderboardModal, ProfileModal, RecordsModal, RulesModal, SigninModal } from '../components/panels.tsx'
import { DEFAULT_OPTIONS, MjOptions } from '../../shared/mahjong/game.ts'
import { MJ_LEVELS, MJ_LEVEL_DESC, MJ_LEVEL_NAME, MjLevel } from '../../shared/mahjong/view.ts'
import { MahjongRules } from '../mahjong/MahjongRules.tsx'
import { useStore } from '../store.ts'
import { sfx } from '../sound.ts'

type ModalKey = 'mjrules' | 'signin' | 'rank' | 'records' | 'rules' | 'profile' | 'shop' | 'growth' | 'friends' | 'admin' | 'tutorial' | null

const HALL_GLYPH: Record<string, string> = { qingyun: '云', liujin: '金', longfeng: '凤', lingxiao: '霄' }
const BOT_LEVELS: BotLevel[] = ['easy', 'normal', 'hard', 'peek']
const LEVEL_KEY = 'daieryou.botLevel'
const TIPS = [
  '第二名才是输家 —— 牌不够大时，不妨干脆出最小的。',
  '越往后分值越高，好牌留到第四、五轮更值钱。',
  '第四轮的公牌是暗牌，留什么牌进终局同样关键。',
  '大小王是赖子，能自动变成最合适的那张牌。',
  '豹子撞豹子，那一笔输赢翻倍。',
]

export function Lobby() {
  const user = useStore((state) => state.user)!
  const signin = useStore((state) => state.signin)
  const lobby = useStore((state) => state.lobby)
  const send = useStore((state) => state.send)
  const toast = useStore((state) => state.toast)
  const refreshMe = useStore((state) => state.refreshMe)
  const [modal, setModal] = useState<ModalKey>(null)
  const [hallId, setHallId] = useState(() => {
    const affordable = HALLS.filter((hall) => user.coins >= hall.minCoins)
    return (affordable[Math.min(affordable.length - 1, 1)] ?? HALLS[0]).id
  })
  const [botLevel, setBotLevel] = useState<BotLevel>(() => {
    const saved = localStorage.getItem(LEVEL_KEY) as BotLevel | null
    return saved && BOT_LEVELS.includes(saved) ? saved : 'normal'
  })
  const [isPrivate, setIsPrivate] = useState(false)
  const [game, setGame] = useState<'poker' | 'mahjong'>(() => (localStorage.getItem('daieryou.game') === 'mahjong' ? 'mahjong' : 'poker'))
  const [mjLevel, setMjLevel] = useState<MjLevel>(() => {
    const saved = localStorage.getItem('daieryou.mjLevel') as MjLevel | null
    return saved && MJ_LEVELS.includes(saved) ? saved : 'normal'
  })
  const [mjOptions, setMjOptions] = useState<MjOptions>(() => {
    try {
      return { ...DEFAULT_OPTIONS, ...JSON.parse(localStorage.getItem('daieryou.mjOptions') || '{}') }
    } catch {
      return DEFAULT_OPTIONS
    }
  })
  const pickGame = (value: 'poker' | 'mahjong') => {
    sfx.select()
    setGame(value)
    localStorage.setItem('daieryou.game', value)
  }
  const setOption = (key: keyof MjOptions, value: boolean) => {
    const next = { ...mjOptions, [key]: value }
    setMjOptions(next)
    localStorage.setItem('daieryou.mjOptions', JSON.stringify(next))
  }
  const [roomCode, setRoomCode] = useState('')
  const [tipIndex, setTipIndex] = useState(() => Math.floor(Math.random() * TIPS.length))

  useEffect(() => {
    const timer = window.setInterval(() => setTipIndex((value) => (value + 1) % TIPS.length), 6000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    refreshMe().catch(() => {})
  }, [refreshMe])

  // 新玩家先看教学；否则今日未签到时自动弹出签到
  useEffect(() => {
    if (user.games === 0 && !tutorialSeen()) {
      setModal((current) => current ?? 'tutorial')
      return
    }
    if (signin && !signin.signedToday && !sessionStorage.getItem('daieryou.signinShown')) {
      sessionStorage.setItem('daieryou.signinShown', '1')
      setModal('signin')
    }
  }, [signin]) // eslint-disable-line react-hooks/exhaustive-deps

  const hall = hallById(hallId) ?? HALLS[0]
  const level = levelOf(user.exp)
  const rank = titleOf(user.honor)
  const canEnter = user.coins >= hall.minCoins
  const broke = user.coins < RELIEF_THRESHOLD

  const pickLevel = (value: BotLevel) => {
    sfx.select()
    setBotLevel(value)
    localStorage.setItem(LEVEL_KEY, value)
  }

  const guardEnter = (): boolean => {
    if (canEnter) return true
    toast(`金币不足：${hall.name}至少需要 ${formatCoins(hall.minCoins)} 金币`, 'error')
    if (broke) setModal('signin')
    return false
  }

  return (
    <div className="scene lobby">
      {/* ------------------------------ 顶栏 ------------------------------ */}
      <header className="lobby-top">
        <button type="button" className="me-card" onClick={() => { sfx.click(); setModal('profile') }}>
          <Avatar index={user.avatar} size={62} frame={user.frame} />
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
          <span className="gold-text">逮二游</span>
          <em>金殿</em>
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

      {/* ------------------------------ 左侧功能 ------------------------------ */}
      <nav className="lobby-menu">
        {([
          ['signin', '签', '每日签到', Boolean(signin && !signin.signedToday)],
          ['growth', '勋', '功名录', false],
          ['shop', '宝', '珍宝阁', false],
          ['friends', '友', '好友', false],
          ['rank', '榜', '风云榜', false],
          ['records', '录', '我的战绩', false],
          ['rules', '规', '玩法规则', false],
          ...(user.isAdmin ? [['admin', '管', '运营后台', false]] : []),
        ] as [Exclude<ModalKey, null>, string, string, boolean][]).map(([key, glyph, label, dot]) => (
          <button key={key} type="button" className="menu-item" onClick={() => { sfx.click(); setModal(key) }}>
            <span className="menu-glyph">{glyph}</span>
            <span className="menu-label">{label}</span>
            {dot && <i className="menu-dot" />}
          </button>
        ))}
        <div className="online">
          <i /> 在线 <b className="num">{Math.max(1, lobby.online)}</b> 人
        </div>
      </nav>

      {/* ------------------------------ 场次牌匾 ------------------------------ */}
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
              <span className="hall-tagline">{item.tagline.split(' · ')[0]}</span>
              <span className="hall-stake">
                <small>底注</small>
                <b className="num">{formatCoins(item.stake)}</b>
              </span>
              <span className="hall-min">{locked ? `需 ${formatCoins(item.minCoins)} 金币` : `${formatCoins(item.minCoins)} 金币入场`}</span>
              {locked && <span className="hall-lock">未解锁</span>}
            </button>
          )
        })}
      </section>

      <div className="lobby-tip">
        <b>牌桌秘诀</b>
        <span>{TIPS[tipIndex]}</span>
      </div>

      {/* ------------------------------ 开局面板 ------------------------------ */}
      <aside className="panel play-panel with-switch">
        <div className="panel-title gold-text">{hall.name} · 开局</div>
        <div className="game-switch">
          <button type="button" className={game === 'poker' ? 'on' : ''} onClick={() => pickGame('poker')}>逮二游</button>
          <button type="button" className={game === 'mahjong' ? 'on' : ''} onClick={() => pickGame('mahjong')}>红中麻将</button>
        </div>
        <div className="divider" />
        {game === 'mahjong' && (
          <div className="play-body">
            <div className="play-row">
              <span className="muted">每分</span>
              <Coins value={hall.stake} size={17} />
              <span className="muted" style={{ marginLeft: 'auto' }}>人机试炼 · 1 人 + 3 机器人</span>
            </div>
            <div className="seg">
              {MJ_LEVELS.map((value) => (
                <button key={value} type="button" className={mjLevel === value ? 'on' : ''} onClick={() => { sfx.select(); setMjLevel(value); localStorage.setItem('daieryou.mjLevel', value) }}>
                  {MJ_LEVEL_NAME[value]}
                </button>
              ))}
            </div>
            <p className="seg-tip">{MJ_LEVEL_DESC[mjLevel]}</p>
            <Button kind="gold" size="lg" className="play-main" onClick={() => { if (guardEnter()) void send({ op: 'mj:start', hallId, level: mjLevel, options: mjOptions }) }}>
              开始试炼
            </Button>
            <div className="mj-options">
              <label className="check"><input type="checkbox" checked={mjOptions.sevenPairs} onChange={(e) => setOption('sevenPairs', e.target.checked)} /><i />七对算胡</label>
              <label className="check"><input type="checkbox" checked={mjOptions.fourZhong} onChange={(e) => setOption('fourZhong', e.target.checked)} /><i />四红中直接胡</label>
              <label className="check"><input type="checkbox" checked={mjOptions.zhongDiscard} onChange={(e) => setOption('zhongDiscard', e.target.checked)} /><i />红中可打出</label>
            </div>
            <Button kind="ghost" size="sm" className="play-main" onClick={() => setModal('mjrules')}>查看红中麻将规则</Button>
          </div>
        )}
        <div className="play-body" style={{ display: game === 'poker' ? undefined : 'none' }}>
          <div className="play-row">
            <span className="muted">底注</span>
            <Coins value={hall.stake} size={17} />
            <span className="muted" style={{ marginLeft: 'auto' }}>单局约 ±{formatCoins(hall.stake * 15)}</span>
          </div>
          <div className="seg">
            {BOT_LEVELS.map((value) => (
              <button key={value} type="button" className={botLevel === value ? 'on' : ''} onClick={() => pickLevel(value)}>
                {BOT_LEVEL_NAME[value].split('·')[0]}
              </button>
            ))}
          </div>
          <p className="seg-tip">
            {botLevel === 'easy' && '新手：只会凑大牌，适合熟悉玩法'}
            {botLevel === 'normal' && '老手：懂得避开第二名，偶有失手'}
            {botLevel === 'hard' && '高手：精于算计，既争头名也会垫底'}
            {botLevel === 'peek' && '千王：能透视你的手牌（娱乐难度）'}
          </p>
          <div className="play-duo">
            <Button kind="gold" size="lg" onClick={() => { if (guardEnter()) void send({ op: 'quick', hallId, botLevel }) }}>
              人机对战
            </Button>
            <Button kind="jade" size="lg" onClick={() => { if (guardEnter()) void send({ op: 'match', hallId }) }}>
              快速匹配
            </Button>
          </div>
          <div className="play-friends">
            <Button kind="red" size="md" onClick={() => { if (guardEnter()) void send({ op: 'create', hallId, isPrivate }) }}>
              创建牌桌
            </Button>
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
              void send({ op: 'join', roomId: roomCode.trim() })
            }}
          >
            <input className="input plain" value={roomCode} onChange={(e) => setRoomCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="输入房号加入牌桌" inputMode="numeric" />
            <button type="submit" className="btn btn-ghost btn-sm"><span>加入</span></button>
          </form>
        </div>
      </aside>

      {/* ------------------------------ 牌桌列表 ------------------------------ */}
      <aside className="panel rooms-panel">
        <div className="panel-title gold-text">正在开桌</div>
        <div className="divider" />
        <div className="rooms-list scroll">
          {lobby.rooms.length === 0 && <div className="empty">暂无公开牌桌<br /><small>创建一桌，邀好友来战</small></div>}
          {lobby.rooms.map((room) => {
            const roomHall = hallById(room.hallId)
            const joinable = room.status === 'waiting' && room.players.length < 3
            return (
              <div key={room.id} className="room-row">
                <div className="room-avatars">
                  {room.players.map((player, index) => <Avatar key={index} index={player.avatar} size={30} ring={false} />)}
                  {Array.from({ length: 3 - room.players.length }, (_, index) => <span key={index} className="seat-empty" />)}
                </div>
                <div className="room-meta">
                  <b>{room.hostName} 的牌桌</b>
                  <small>{roomHall?.name} · 底注 {formatCoins(room.stake)} · #{room.id}</small>
                </div>
                {joinable
                  ? <Button kind="jade" size="sm" onClick={() => void send({ op: 'join', roomId: room.id })}>加入</Button>
                  : room.status === 'playing'
                    ? <Button kind="ghost" size="sm" onClick={() => void send({ op: 'spectate', roomId: room.id })}>观战</Button>
                    : <span className="room-state">已满</span>}
              </div>
            )
          })}
        </div>
      </aside>

      {modal === 'signin' && <SigninModal onClose={() => setModal(null)} />}
      {modal === 'rank' && <LeaderboardModal onClose={() => setModal(null)} />}
      {modal === 'records' && <RecordsModal onClose={() => setModal(null)} />}
      {modal === 'mjrules' && <MahjongRules onClose={() => setModal(null)} />}
      {modal === 'rules' && <RulesModal onClose={() => setModal(null)} onTutorial={() => setModal('tutorial')} />}
      {modal === 'profile' && <ProfileModal onClose={() => setModal(null)} />}
      {modal === 'shop' && <ShopModal onClose={() => setModal(null)} />}
      {modal === 'growth' && <GrowthModal onClose={() => setModal(null)} />}
      {modal === 'friends' && <FriendsModal onClose={() => setModal(null)} />}
      {modal === 'admin' && <AdminModal onClose={() => setModal(null)} />}
      {modal === 'tutorial' && <Tutorial onClose={() => setModal(null)} />}
    </div>
  )
}
