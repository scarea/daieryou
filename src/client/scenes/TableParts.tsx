// 牌桌上的各个部件：座位牌、等待面板、战况表、结算面板。
import { useEffect, useState } from 'react'
import { formatCoins, hallById, titleOf } from '../../shared/economy.ts'
import type { RoundResult } from '../../shared/engine.ts'
import { HAND_NAME, describeHand } from '../../shared/hand.ts'
import { BOT_LEVEL_NAME, BotLevel, EMOTES, RoomView, SeatInfo } from '../../shared/protocol.ts'
import { api } from '../net.ts'
import { Avatar, Button, Coins, CountUp, Modal, TitleBadge } from '../components/ui.tsx'
import { useStore } from '../store.ts'
import { sfx } from '../sound.ts'

export type Side = 'me' | 'left' | 'right'

const signed = (value: number) => (value > 0 ? `+${value}` : `${value}`)

// ------------------------------ 座位牌 ------------------------------

export function SeatPlate({
  info, side, total, status, progress, isHost, canKick, onKick,
}: {
  info: SeatInfo | null
  side: Side
  total: number | null
  status: 'idle' | 'thinking' | 'done' | 'ready'
  /** 倒计时剩余比例 0~1；null 不显示 */
  progress: number | null
  isHost: boolean
  canKick: boolean
  onKick: () => void
}) {
  const bubble = useStore((state) => state.emotes.find((item) => info && item.seat === info.seat))
  if (!info) {
    return (
      <div className={`seat seat-${side} seat-vacant`}>
        <div className="seat-avatar"><div className="vacant-ring">虚位</div></div>
        <div className="seat-name muted">等待入座…</div>
      </div>
    )
  }
  return (
    <div className={`seat seat-${side} ${status === 'thinking' ? 'is-thinking' : ''} ${bubble ? 'is-talking' : ''}`}>
      <div className="seat-avatar">
        {progress !== null && <i className="seat-timer" style={{ ['--p' as string]: progress }} />}
        <Avatar index={info.avatar} size={side === 'me' ? 84 : 76} dim={!info.online} frame={info.frame} />
        {isHost && <span className="seat-host">房主</span>}
        {info.trustee && <span className="seat-trustee">托管</span>}
        {status === 'done' && <span className="seat-done">✓</span>}
        {canKick && <button type="button" className="seat-kick" onClick={onKick} title="请离座位">✕</button>}
      </div>
      <div className="seat-info">
        <div className="seat-name">
          <span>{info.nickname}</span>
          {info.isBot && <em className="bot-tag">{BOT_LEVEL_NAME[info.botLevel ?? 'normal'].split('·')[0]}</em>}
        </div>
        <div className="seat-sub">
          <TitleBadge honor={info.honor} small />
          {info.coins !== null && <Coins value={info.coins} size={14} />}
        </div>
        {total !== null && (
          <div className={`seat-score ${total > 0 ? 'up' : total < 0 ? 'down' : ''}`}>
            <small>本局</small>
            <b key={total} className="num pop">{signed(total)}</b>
          </div>
        )}
        {status === 'thinking' && <div className="seat-status">思考中<i>.</i><i>.</i><i>.</i></div>}
        {status === 'ready' && <div className="seat-status ready">已准备</div>}
      </div>
      {bubble && <div key={bubble.id} className="bubble">{EMOTES[bubble.key]}</div>}
    </div>
  )
}

// ------------------------------ 等待面板 ------------------------------

const BOT_LEVELS: BotLevel[] = ['easy', 'normal', 'hard', 'peek']

export function WaitingPanel({ room }: { room: RoomView }) {
  const send = useStore((state) => state.send)
  const toast = useStore((state) => state.toast)
  const hall = hallById(room.hallId)
  const isHost = room.hostSeat === room.mySeat
  const seated = room.seats.filter(Boolean).length
  const waitingReady = room.status === 'finished'

  const clockOffset = useStore((state) => state.clockOffset)
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(timer)
  }, [])

  const copy = async (text: string, message: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast(message, 'gold')
    } catch {
      toast(`房号：${room.id}`)
    }
  }

  if (room.matching) {
    const left = room.deadlineAt ? Math.max(0, Math.ceil((room.deadlineAt - (now + clockOffset)) / 1000)) : 0
    return (
      <div className="waiting matching">
        <div className="waiting-hall gold-text">{hall?.name}</div>
        <div className="match-radar"><i /><i /><i /><b className="num">{left}</b></div>
        <div className="waiting-hint">正在寻找对手… {seated}/3</div>
        <div className="waiting-meta">底注 <Coins value={room.stake} size={16} /> <span>·</span> 凑齐三人立即开局，超时由机器人补位</div>
      </div>
    )
  }

  return (
    <div className="waiting">
      <div className="waiting-hall gold-text">{hall?.name}</div>
      <button type="button" className="waiting-code" onClick={() => void copy(room.id, '房号已复制，发给好友即可加入')} title="点击复制房号">
        <small>房号</small>
        <b className="num">{room.id}</b>
        <em>复制</em>
      </button>
      <div className="waiting-meta">
        底注 <Coins value={room.stake} size={16} /> <span>·</span> {room.isPrivate ? '私密牌桌' : '公开牌桌'} <span>·</span> {seated}/3 人
      </div>
      {waitingReady ? (
        <div className="waiting-hint">等待其他玩家准备…</div>
      ) : isHost ? (
        <>
          {seated < 3 && (
            <div className="waiting-bots">
              <span>添加机器人</span>
              {BOT_LEVELS.map((level) => (
                <button key={level} type="button" className="chip" onClick={() => { sfx.click(); void send({ op: 'addBot', level }) }}>
                  {BOT_LEVEL_NAME[level].split('·')[0]}
                </button>
              ))}
            </div>
          )}
          <div className="waiting-actions">
            <Button kind="ghost" size="md" onClick={() => void copy(`${location.origin}/?room=${room.id}`, '邀请链接已复制，朋友打开就能入座')}>复制邀请链接</Button>
            <Button kind="gold" size="lg" disabled={seated < 3} onClick={() => void send({ op: 'start' })}>
              {seated < 3 ? '等待满员' : '开始游戏'}
            </Button>
          </div>
        </>
      ) : (
        <div className="waiting-hint">等待房主开始游戏…</div>
      )}
    </div>
  )
}

// ------------------------------ 战况表 ------------------------------

export function RoundsTable({ room, results }: { room: RoomView; results: RoundResult[] }) {
  const base = room.mySeat < 0 ? 0 : room.mySeat
  const order = [base, (base + 1) % 3, (base + 2) % 3]
  return (
    <table className="rounds">
      <thead>
        <tr>
          <th>回合</th>
          {order.map((seat) => <th key={seat} className={seat === room.mySeat ? 'me' : ''}>{room.seats[seat]?.nickname ?? '—'}</th>)}
        </tr>
      </thead>
      <tbody>
        {results.map((result) => (
          <tr key={result.round}>
            <td>第{result.round}轮 <small>×{result.score}</small></td>
            {order.map((seat) => {
              const entry = result.entries[seat]
              const caught = result.losers.includes(seat)
              return (
                <td key={seat} className={entry.delta > 0 ? 'up' : entry.delta < 0 ? 'down' : ''}>
                  <span className={`hand-chip type-${entry.evaluation.type}`}>{describeHand(entry.evaluation)}</span>
                  <b className="num">{signed(entry.delta)}</b>
                  {caught && <i className="caught-dot">逮</i>}
                </td>
              )
            })}
          </tr>
        ))}
        {results.length === 0 && <tr><td colSpan={4} className="muted">尚未开始</td></tr>}
      </tbody>
      {results.length > 0 && (
        <tfoot>
          <tr>
            <td>合计</td>
            {order.map((seat) => {
              const total = results.reduce((sum, result) => sum + result.entries[seat].delta, 0)
              return <td key={seat} className={total > 0 ? 'up' : total < 0 ? 'down' : ''}><b className="num">{signed(total)}</b></td>
            })}
          </tr>
        </tfoot>
      )}
    </table>
  )
}

export function HistoryModal({ room, onClose }: { room: RoomView; onClose: () => void }) {
  return (
    <Modal title="本局战况" onClose={onClose} width={760}>
      <RoundsTable room={room} results={room.game?.results ?? []} />
      <p className="modal-lead" style={{ marginTop: 16 }}>
        牌型：{Object.values(HAND_NAME).join(' > ')}
      </p>
    </Modal>
  )
}

// ------------------------------ 结算面板 ------------------------------

const RAIN = Array.from({ length: 30 }, (_, index) => ({
  left: (index * 37 + 11) % 100,
  delay: ((index * 53) % 30) / 10,
  duration: 2.2 + ((index * 17) % 14) / 10,
  size: 16 + ((index * 7) % 14),
}))

export function ResultOverlay({ room, onAgain, onLeave }: { room: RoomView; onAgain: () => void; onLeave: () => void }) {
  const user = useStore((state) => state.user)
  const toast = useStore((state) => state.toast)
  const [showDetail, setShowDetail] = useState(false)
  const [added, setAdded] = useState<string[]>([])
  const [settled, setSettled] = useState(false)
  const spectating = room.mySeat < 0
  const entries = [...(room.settlement ?? [])].sort((a, b) => a.placement - b.placement || b.total - a.total)
  const mine = spectating ? undefined : entries.find((entry) => entry.seat === room.mySeat)
  const lastPlacement = Math.max(1, ...entries.map((entry) => entry.placement))
  const won = Boolean(mine && mine.placement === 1 && lastPlacement > 1)
  const lost = Boolean(mine && mine.placement === lastPlacement && lastPlacement > 1)
  const headline = !mine ? '对局结束' : won ? '旗开得胜' : lost ? '惜败一局' : mine.total > 0 ? '小有斩获' : mine.total < 0 ? '有惊无险' : '握手言和'

  // 爵位是否在这一局晋升
  const honorNow = user?.honor ?? 0
  const honorBefore = mine ? honorNow - mine.honorDelta : honorNow
  const rankNow = titleOf(honorNow)
  const rankBefore = titleOf(honorBefore)
  const promoted = Boolean(mine) && rankNow.index > rankBefore.index

  useEffect(() => {
    if (won) sfx.win()
    else if (lost) sfx.lose()
    else sfx.reward()
    const settle = window.setTimeout(() => setSettled(true), 1500)
    const cheer = promoted ? window.setTimeout(() => sfx.fanfare(), 2300) : 0
    return () => {
      window.clearTimeout(settle)
      window.clearTimeout(cheer)
    }
  }, [won, lost, promoted])

  const addFriend = async (userId: string) => {
    try {
      await api('/friends/add', { userId })
      setAdded((list) => [...list, userId])
      toast('已加为好友', 'gold')
    } catch (error) {
      toast((error as Error).message, 'error')
    }
  }

  return (
    <div className={`result-mask ${won ? 'is-win' : lost ? 'is-lose' : ''}`}>
      {won && <div className="result-rays" />}
      {won && (
        <div className="coin-rain">
          {RAIN.map((coin, index) => (
            <i key={index} style={{ left: `${coin.left}%`, width: coin.size, height: coin.size, animationDelay: `${coin.delay}s`, animationDuration: `${coin.duration}s` }} />
          ))}
        </div>
      )}
      <div className="result">
        <h2 className="result-title">
          {Array.from(headline).map((char, index) => <span key={index} style={{ animationDelay: `${0.1 + index * 0.12}s` }}>{char}</span>)}
        </h2>
        <div className="result-cols">
          {entries.map((entry, index) => {
            const info = room.seats[entry.seat]
            const isMe = !spectating && entry.seat === room.mySeat
            const first = entry.placement === 1 && lastPlacement > 1
            const canAdd = info && !info.isBot && !isMe && !added.includes(info.userId)
            return (
              <div key={entry.seat} className={`panel result-col place-${entry.placement} ${isMe ? 'me' : ''} ${first ? 'first' : ''}`} style={{ animationDelay: `${0.5 + index * 0.16}s` }}>
                <span className="result-place">{first ? '头名' : entry.placement === lastPlacement && lastPlacement > 1 ? '垫底' : '居中'}</span>
                {first && <i className="result-crown">♛</i>}
                <Avatar index={info?.avatar ?? 0} size={72} frame={info?.frame} />
                <b className="result-name">{info?.nickname ?? '已离席'}</b>
                <span className={`result-score num ${entry.total > 0 ? 'up' : entry.total < 0 ? 'down' : ''}`}>
                  <CountUp value={entry.total} from={0} signed duration={900} delay={900 + index * 160} /><small>分</small>
                </span>
                <span className={`coins ${entry.coinsDelta > 0 ? 'up' : entry.coinsDelta < 0 ? 'down' : ''}`} style={{ fontSize: 21 }}>
                  <b><CountUp value={entry.coinsDelta} from={0} signed duration={1100} delay={1100 + index * 160} tick={isMe} /></b>
                </span>
                <span className="result-extra">
                  {info?.isBot ? '机器人' : <>荣誉 <b className={entry.honorDelta >= 0 ? 'up' : 'down'}>{signed(entry.honorDelta)}</b> · 经验 <b className="up">+{entry.expGain}</b></>}
                </span>
                {canAdd && <button type="button" className="result-add" onClick={() => void addFriend(info.userId)}>+ 好友</button>}
              </div>
            )
          })}
        </div>
        {mine && user && (
          <div className="result-wallet">
            <span>金币 <span className="coins" style={{ fontSize: 19 }}><b><CountUp value={user.coins} from={user.coins - mine.coinsDelta} duration={1400} delay={1500} /></b></span></span>
            <span className="result-honor">
              <TitleBadge honor={settled ? honorNow : honorBefore} small />
              <span className="bar honor"><i style={{ width: `${(settled ? rankNow.progress : promoted ? 1 : rankBefore.progress) * 100}%` }} /></span>
              <small className="muted">{rankNow.next ? `距「${rankNow.next.name}」还差 ${rankNow.next.min - honorNow}` : '已登峰造极'}</small>
            </span>
          </div>
        )}
        {promoted && settled && <div className="promotion">晋升 <b>「{rankNow.title.name}」</b></div>}
        <div className="result-actions">
          <Button kind="ghost" size="md" onClick={onLeave}>返回大厅</Button>
          {!spectating && <Button kind="gold" size="lg" onClick={onAgain}>再来一局</Button>}
          <Button kind="ghost" size="md" onClick={() => setShowDetail(true)}>逐轮回顾</Button>
        </div>
        <p className="result-note">底注 {formatCoins(room.stake)} · 金币变化 = 总分 × 底注</p>
      </div>
      {showDetail && <HistoryModal room={room} onClose={() => setShowDetail(false)} />}
    </div>
  )
}
