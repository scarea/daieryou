// 牌桌：发牌、选牌、亮牌、逮二、结算的全部演出。
// 所有牌都是舞台上的绝对定位元素，按状态计算坐标并用 CSS 过渡移动。
import { useEffect, useMemo, useRef, useState } from 'react'
import { Card, isJoker, sortHand } from '../../shared/cards.ts'
import { hallById } from '../../shared/economy.ts'
import { HIDDEN_ROUND, MAX_ROUNDS, ROUND_SCORES, RoundResult } from '../../shared/engine.ts'
import { HAND_NAME, ResolvedCard, describeHand, evaluateHand } from '../../shared/hand.ts'
import { EMOTES, RoomView } from '../../shared/protocol.ts'
import { CardView } from '../components/CardView.tsx'
import { RulesModal } from '../components/panels.tsx'
import { Button, Coins, Modal, MusicToggle, SoundToggle } from '../components/ui.tsx'
import { useStore } from '../store.ts'
import { sfx } from '../sound.ts'
import { HistoryModal, ResultOverlay, SeatPlate, Side, WaitingPanel } from './TableParts.tsx'

const CARD_W = 104
const CARD_H = 146
const HAND_Y = 612
const DEAL_FROM = { x: 640, y: 96 }
const SLOT: Record<Side, { x: number; y: number }> = {
  me: { x: 640, y: 410 },
  left: { x: 338, y: 326 },
  right: { x: 942, y: 326 },
}
const OPP_HAND: Record<Side, { x: number; y: number }> = {
  me: { x: 640, y: 628 },
  left: { x: 236, y: 196 },
  right: { x: 1044, y: 196 },
}
const PUBLIC_POS = (index: number) => ({ x: 640 + (index - 1.5) * 90, y: 226 })

interface Entity {
  key: string
  x: number
  y: number
  rot?: number
  scale: number
  z: number
  card?: Card | null
  faceUp: boolean
  cls?: string
  wildAs?: ResolvedCard | null
  tag?: string
  dealDelay?: number
  onClick?: () => void
}

/** 把原始牌中的赖子对应到它变成的牌 */
function wildMap(result: RoundResult, seat: number): Map<string, ResolvedCard> {
  const entry = result.entries[seat]
  const wilds = entry.evaluation.cards.filter((card) => card.wild)
  const map = new Map<string, ResolvedCard>()
  entry.cards.filter(isJoker).forEach((card, index) => { if (wilds[index]) map.set(card.id, wilds[index]) })
  return map
}

export function Table({ room, live }: { room: RoomView; live: RoomView | null }) {
  const send = useStore((state) => state.send)
  const result = useStore((state) => state.result)
  const dismissResult = useStore((state) => state.dismissResult)
  const clockOffset = useStore((state) => state.clockOffset)

  const user = useStore((state) => state.user)
  const game = room.game
  const spectating = room.mySeat < 0
  /** 观战时以 0 号座位的视角看牌桌 */
  const mySeat = spectating ? 0 : room.mySeat
  const rightSeat = (mySeat + 1) % 3
  const leftSeat = (mySeat + 2) % 3
  const sideOf = (seat: number): Side => (seat === mySeat ? 'me' : seat === rightSeat ? 'right' : 'left')
  const hall = hallById(room.hallId)
  const playing = room.status === 'playing' && Boolean(game)
  const showTable = Boolean(game) && (room.status === 'playing' || Boolean(result))
  const round = game?.round ?? 0
  const phase = game?.phase ?? 'selecting'
  const picked = spectating ? null : game?.picked ?? null
  const lastResult = game && game.results.length > 0 ? game.results[game.results.length - 1] : null
  const inShowdown = showTable && (phase === 'showdown' || phase === 'finished') && Boolean(lastResult)

  const [selected, setSelected] = useState<string[]>([])
  const [stage, setStage] = useState(0)
  const [now, setNow] = useState(Date.now())
  const [modal, setModal] = useState<'history' | 'rules' | 'leave' | null>(null)
  const [emoteOpen, setEmoteOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [shake, setShake] = useState(false)
  const [banner, setBanner] = useState(0)

  // 回合切换：清空选择
  useEffect(() => {
    setSelected([])
    setSubmitting(false)
    if (playing && phase === 'selecting' && round > 1 && round < MAX_ROUNDS) sfx.deal(2)
    if (playing && phase === 'selecting' && round === 1) sfx.deal(5)
    // 回合横幅 + 提示音
    if (playing && phase === 'selecting' && round >= 1) {
      setBanner(round)
      if (round === MAX_ROUNDS) sfx.gong()
      else if (round === HIDDEN_ROUND) sfx.mystery()
      else sfx.round(round)
      const timer = window.setTimeout(() => setBanner(0), 1900)
      return () => window.clearTimeout(timer)
    }
  }, [round, playing]) // eslint-disable-line react-hooks/exhaustive-deps

  // 倒计时
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(timer)
  }, [])
  const remainMs = room.deadlineAt ? Math.max(0, room.deadlineAt - (now + clockOffset)) : 0
  const remainSec = Math.ceil(remainMs / 1000)
  const urgent = playing && !spectating && phase === 'selecting' && round < MAX_ROUNDS && !picked && remainSec <= 5 && remainSec > 0
  const lastTick = useRef(0)

  // 对手落牌的声音
  const oppPicked = game && phase === 'selecting' && round < MAX_ROUNDS ? game.seats.filter((seat, index) => (spectating || index !== mySeat) && seat.picked).length : 0
  const lastOppPicked = useRef(0)
  useEffect(() => {
    if (oppPicked > lastOppPicked.current) sfx.oppPlay()
    lastOppPicked.current = oppPicked
  }, [oppPicked])
  useEffect(() => {
    if (playing && phase === 'selecting' && round < MAX_ROUNDS && !picked && remainSec <= 5 && remainSec > 0 && lastTick.current !== remainSec) {
      lastTick.current = remainSec
      sfx.tick()
    }
  }, [remainSec, playing, phase, round, picked])

  // 亮牌演出的时间线
  const revealOrder = [rightSeat, leftSeat, mySeat]
  const isHiddenRound = lastResult?.round === HIDDEN_ROUND
  const showdownKey = inShowdown ? `${lastResult?.round}-${phase}` : ''
  useEffect(() => {
    if (!inShowdown || !lastResult) {
      setStage(0)
      return
    }
    if (phase === 'finished') {
      setStage(6)
      return
    }
    setStage(0)
    const base = isHiddenRound ? 1500 : 550
    const steps: [number, number][] = [[base, 2], [base + 650, 3], [base + 1300, 4], [base + 2150, 5], [base + 3200, 6]]
    if (isHiddenRound) steps.unshift([600, 1])
    const timers = steps.map(([ms, value]) =>
      window.setTimeout(() => {
        setStage(value)
        if (value >= 1 && value <= 4) sfx.flip()
        if (value >= 2 && value <= 4 && lastResult.entries[revealOrder[value - 2]]?.evaluation.type === 'leopard') sfx.leopard()
        if (value === 5) {
          if (lastResult.losers.length > 0) {
            sfx.stamp()
            setShake(true)
            window.setTimeout(() => setShake(false), 460)
            window.setTimeout(() => sfx.coins(), 320)
          } else {
            sfx.pop()
          }
        }
      }, ms),
    )
    return () => timers.forEach((timer) => window.clearTimeout(timer))
  }, [showdownKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const revealed = (seat: number) => stage >= 2 + revealOrder.indexOf(seat)
  const verdict = stage >= 5

  // ------------------------------ 选牌 ------------------------------
  const hand = useMemo(() => (game ? sortHand(game.hand) : []), [game?.hand]) // eslint-disable-line react-hooks/exhaustive-deps
  const canPick = playing && phase === 'selecting' && round < MAX_ROUNDS && !picked && !spectating
  const publicCard = game && round <= 4 ? game.publicCards[round - 1] : null

  const toggle = (id: string) => {
    if (!canPick) return
    sfx.select()
    setSelected((current) => {
      if (current.includes(id)) return current.filter((item) => item !== id)
      return [...current, id].slice(-2)
    })
  }

  const preview = useMemo(() => {
    if (!canPick || selected.length !== 2) return null
    if (!publicCard) return { text: '暗牌回合 · 公牌未知', type: 'hidden' }
    const cards = selected.map((id) => hand.find((card) => card.id === id)).filter(Boolean) as Card[]
    if (cards.length !== 2) return null
    const evaluation = evaluateHand([...cards, publicCard])
    return { text: describeHand(evaluation), type: evaluation.type as string }
  }, [canPick, selected, publicCard, hand])

  const suggest = (mode: 'max' | 'min') => {
    if (!canPick || !publicCard) return
    let best: [string, string] | null = null
    let bestKey = mode === 'max' ? -Infinity : Infinity
    for (let i = 0; i < hand.length; i += 1) {
      for (let j = i + 1; j < hand.length; j += 1) {
        const key = evaluateHand([hand[i], hand[j], publicCard]).key
        if (mode === 'max' ? key > bestKey : key < bestKey) {
          bestKey = key
          best = [hand[i].id, hand[j].id]
        }
      }
    }
    if (best) {
      sfx.select()
      setSelected(best)
    }
  }

  const confirm = async () => {
    if (!canPick || selected.length !== 2 || submitting) return
    setSubmitting(true)
    sfx.play()
    const ok = await send({ op: 'play', round, cardIds: selected })
    if (!ok) setSubmitting(false)
  }

  // ------------------------------ 计算所有牌的位置 ------------------------------
  const entities: Entity[] = []
  if (showTable && game) {
    // 公牌
    game.publicCards.forEach((card, index) => {
      const pos = PUBLIC_POS(index)
      const isCurrent = phase !== 'finished' && round <= 4 && index === round - 1
      const isPast = index < round - 1 || phase === 'finished' || round === MAX_ROUNDS
      const hiddenFlip = index === HIDDEN_ROUND - 1 && inShowdown && isHiddenRound && phase !== 'finished' && stage < 1
      entities.push({
        key: `pub-${index}`,
        x: pos.x,
        y: pos.y + (isCurrent ? 4 : 0),
        scale: isCurrent ? 0.88 : 0.68,
        z: isCurrent ? 6 : 5,
        card,
        faceUp: Boolean(card) && !hiddenFlip,
        cls: `pub ${isCurrent ? 'current' : ''} ${isPast && !isCurrent ? 'past' : ''}`,
        dealDelay: 0.5 + index * 0.08,
      })
    })

    const slotPos = (side: Side, index: number, count = 3) => ({
      x: SLOT[side].x + (index - (count - 1) / 2) * 80,
      y: SLOT[side].y,
    })

    for (let seat = 0; seat < 3; seat += 1) {
      const side = sideOf(seat)
      const seatView = game.seats[seat]
      const entry = inShowdown && lastResult ? lastResult.entries[seat] : null
      const wilds = inShowdown && lastResult ? wildMap(lastResult, seat) : null
      const shown = revealed(seat) || phase === 'finished'
      const finalRound = (lastResult?.round ?? round) === MAX_ROUNDS && inShowdown
      const lose = verdict && lastResult?.losers.includes(seat)
      const win = verdict && lastResult?.winners.includes(seat)
      const slotCls = `slot ${lose ? 'lose' : ''} ${win ? 'win' : ''}`

      if (side === 'me' && !spectating) {
        const pickedIds = inShowdown && entry ? (finalRound ? entry.cards.map((card) => card.id) : entry.cards.slice(0, 2).map((card) => card.id)) : picked ?? []
        const inHand = hand.filter((card) => !pickedIds.includes(card.id))
        inHand.forEach((card, index) => {
          const offset = index - (inHand.length - 1) / 2
          const isSelected = selected.includes(card.id)
          entities.push({
            key: card.id,
            x: 640 + offset * 96,
            y: HAND_Y + Math.abs(offset) * 5 - (isSelected ? 34 : 0),
            rot: offset * 2.4,
            scale: 1,
            z: 30 + index,
            card,
            faceUp: true,
            cls: `hand ${canPick ? 'pickable' : ''} ${isSelected ? 'selected' : ''} ${game.drawn.includes(card.id) && round > 1 ? 'fresh' : ''} ${inShowdown ? 'resting' : ''}`,
            dealDelay: game.drawn.includes(card.id) ? 0.15 + game.drawn.indexOf(card.id) * 0.2 : index * 0.09,
            onClick: canPick ? () => toggle(card.id) : undefined,
          })
        })
        const slotCards = entry ? entry.cards : hand.filter((card) => pickedIds.includes(card.id))
        slotCards.forEach((card, index) => {
          const isPublicCopy = Boolean(entry) && !finalRound && index === 2
          const pos = isPublicCopy && !shown ? { ...PUBLIC_POS(lastResult!.round - 1), y: PUBLIC_POS(0).y + 4 } : slotPos('me', index)
          entities.push({
            key: isPublicCopy ? `me-pub-${lastResult!.round}` : card.id,
            x: pos.x,
            y: pos.y,
            scale: isPublicCopy && !shown ? 0.88 : 0.8,
            z: 12 + index,
            card,
            faceUp: true,
            cls: `${slotCls} ${isPublicCopy && !shown ? 'ghost' : ''}`,
            wildAs: shown ? wilds?.get(card.id) : null,
            tag: isPublicCopy ? '公' : undefined,
          })
        })
        continue
      }

      // 对手：只知道张数
      const oppSide = side
      const big = side === 'me'
      const total = seatView.handCount
      const keyOf = (index: number) => `o${seat}-r${round}-${index}`
      const playedCount = round < MAX_ROUNDS ? (seatView.picked || inShowdown ? 2 : 0) : inShowdown ? 3 : 0
      const restCount = total - playedCount
      for (let index = 0; index < total; index += 1) {
        if (index < restCount) {
          const offset = index - (restCount - 1) / 2
          entities.push({
            key: keyOf(index),
            x: OPP_HAND[oppSide].x + offset * (big ? 46 : 17),
            y: OPP_HAND[oppSide].y + Math.abs(offset) * (big ? 4 : 1.5),
            rot: offset * (big ? 2.4 : 3 * (oppSide === 'left' ? 1 : -1)),
            scale: big ? 0.7 : 0.42,
            z: 8 + index,
            faceUp: false,
            cls: 'opp',
            dealDelay: index * 0.09 + (oppSide === 'left' ? 0.05 : 0.1),
          })
        } else {
          const slotIndex = index - restCount
          const pos = slotPos(side, slotIndex)
          const card = entry ? entry.cards[slotIndex] : null
          entities.push({
            key: keyOf(index),
            x: pos.x,
            y: pos.y,
            scale: 0.8,
            z: 12 + slotIndex,
            card,
            faceUp: Boolean(card) && shown,
            cls: slotCls,
            wildAs: card && shown ? wilds?.get(card.id) : null,
          })
        }
      }
      if (entry && !finalRound) {
        const pos = shown ? slotPos(side, 2) : { ...PUBLIC_POS(lastResult!.round - 1), y: PUBLIC_POS(0).y + 4 }
        entities.push({
          key: `o${seat}-pub-${lastResult!.round}`,
          x: pos.x,
          y: pos.y,
          scale: shown ? 0.8 : 0.88,
          z: 14,
          card: entry.cards[2],
          faceUp: true,
          cls: `${slotCls} ${shown ? '' : 'ghost'}`,
          tag: '公',
        })
      }
    }
  }

  // ------------------------------ 提示文案 ------------------------------
  let prompt = ''
  if (showTable && game) {
    if (inShowdown) prompt = verdict ? (lastResult!.losers.length ? '逮住第二名！' : '三家打平，本轮不结算') : isHiddenRound && stage < 1 ? '翻开暗牌…' : '亮牌！'
    else if (round === MAX_ROUNDS) prompt = '终局对决 · 剩余三张直接比牌'
    else if (picked) prompt = '已出牌，等待其他玩家…'
    else if (round === HIDDEN_ROUND) prompt = '暗牌回合 · 公牌尚未翻开，选 2 张手牌'
    else prompt = '选 2 张手牌，与高亮的公牌组成三张'
  }

  const totalOf = (seat: number): number | null => {
    if (!showTable || !game) return null
    const value = game.seats[seat].total
    // 亮牌揭晓前先不剧透本轮分数
    if (inShowdown && phase !== 'finished' && stage < 6 && lastResult) return value - lastResult.entries[seat].delta
    return value
  }

  const statusOf = (seat: number): 'idle' | 'thinking' | 'done' | 'ready' => {
    const info = room.seats[seat]
    if (!info) return 'idle'
    if (!showTable) return room.status === 'finished' && info.ready ? 'ready' : 'idle'
    if (!game || phase !== 'selecting' || round === MAX_ROUNDS) return 'idle'
    return game.seats[seat].picked ? 'done' : 'thinking'
  }

  const progressOf = (seat: number): number | null => {
    if (!playing || !game || phase !== 'selecting' || round === MAX_ROUNDS || game.seats[seat].picked || !room.deadlineAt) return null
    return Math.max(0, Math.min(1, remainMs / 40000))
  }

  // 第一局的随局提示
  let coach = ''
  if (user && user.games === 0 && !spectating && showTable && game && playing) {
    if (inShowdown) coach = verdict ? '记住：牌最大和最小的都赢，只有第二名输分' : ''
    else if (round === MAX_ROUNDS) coach = '终局不用选牌，剩下的三张直接比'
    else if (picked) coach = '出牌后等其他人，三家都出完就亮牌'
    else if (round === HIDDEN_ROUND) coach = '这轮公牌盖着。留在手里的 3 张，就是你的终局牌'
    else if (selected.length === 2) coach = '右下角显示了你凑出的牌型，满意就点「出牌」'
    else coach = '点两张手牌，或直接用右下角的「出最大 / 出最小」'
  }

  const isHostMe = !spectating && room.hostSeat === mySeat && room.status !== 'playing'
  const liveRoom = live ?? room

  const leave = async () => {
    setModal(null)
    await send({ op: 'leave' })
    dismissResult()
  }

  return (
    <div className={`scene table-scene ${user?.felt ? `felt-${user.felt}` : ''} ${shake ? 'shake' : ''} ${urgent ? 'urgent' : ''}`}>
      {/* ------------------------------ 顶栏 ------------------------------ */}
      <header className="table-top">
        <div className="table-top-left">
          <Button kind="ghost" size="sm" onClick={() => (playing && !spectating ? setModal('leave') : void leave())}>‹ 离开</Button>
          <div className="table-hall">
            <b className="gold-text">{hall?.name}</b>
            <span>底注 <Coins value={room.stake} size={15} /></span>
            <span className="muted">#{room.id}</span>
          </div>
        </div>
        {showTable && game && (
          <div className="rounds-track">
            {ROUND_SCORES.map((score, index) => {
              const done = game.results[index]
              const delta = done && !spectating && (index + 1 < round || phase === 'finished' || stage >= 6) ? done.entries[mySeat].delta : null
              const current = index + 1 === round && phase !== 'finished'
              return (
                <div key={index} className={`track-pip ${current ? 'current' : ''} ${delta !== null ? (delta > 0 ? 'up' : delta < 0 ? 'down' : 'even') : ''}`}>
                  <b className="num">{delta !== null ? (delta > 0 ? `+${delta}` : delta) : `×${score}`}</b>
                  <small>{index === MAX_ROUNDS - 1 ? '终局' : index === HIDDEN_ROUND - 1 ? '暗牌' : `第${index + 1}轮`}</small>
                </div>
              )
            })}
          </div>
        )}
        <div className="table-top-right">
          {showTable && <Button kind="ghost" size="sm" onClick={() => setModal('history')}>战况</Button>}
          <Button kind="ghost" size="sm" onClick={() => setModal('rules')}>规则</Button>
          <MusicToggle />
          <SoundToggle />
        </div>
      </header>

      {/* ------------------------------ 牌桌 ------------------------------ */}
      <div className="felt">
        <div className="felt-inner">
          <div className="felt-emblem">逮</div>
        </div>
      </div>

      {showTable && game && (
        <>
          <div className={`prompt ${verdict && lastResult?.losers.length ? 'hot' : ''}`} key={prompt}>{prompt}</div>
          {game.publicCards.map((_, index) => {
            const pos = PUBLIC_POS(index)
            const current = phase !== 'finished' && index === round - 1
            return (
              <div key={index} className={`pub-label ${current ? 'current' : ''}`} style={{ left: pos.x, top: pos.y + (current ? 76 : 58) }}>
                {index === HIDDEN_ROUND - 1 ? '暗牌' : `第${index + 1}轮`} ×{ROUND_SCORES[index]}
              </div>
            )
          })}
        </>
      )}

      {!showTable && <WaitingPanel room={liveRoom} />}

      {banner > 0 && showTable && (
        <div key={banner} className={`round-banner ${banner === MAX_ROUNDS ? 'final' : banner === HIDDEN_ROUND ? 'hidden' : ''}`}>
          <small>{banner === MAX_ROUNDS ? '剩余三张 · 直接比牌' : banner === HIDDEN_ROUND ? '公牌盖着 · 出完才翻开' : `每分 ×${ROUND_SCORES[banner - 1]}`}</small>
          <b>{banner === MAX_ROUNDS ? '终局对决' : banner === HIDDEN_ROUND ? '暗牌回合' : `第 ${'一二三'[banner - 1]} 轮`}</b>
          <em className="num">×{ROUND_SCORES[banner - 1]}</em>
        </div>
      )}
      {urgent && <div className="urgent-vignette" />}
      {coach && <div key={coach} className="coach"><i>师</i>{coach}</div>}

      {/* ------------------------------ 座位 ------------------------------ */}
      {[leftSeat, rightSeat, mySeat].map((seat) => (
        <SeatPlate
          key={seat}
          info={(showTable ? room : liveRoom).seats[seat]}
          side={sideOf(seat)}
          total={totalOf(seat)}
          status={statusOf(seat)}
          progress={progressOf(seat)}
          isHost={(showTable ? room : liveRoom).hostSeat === seat && !showTable}
          canKick={isHostMe && !showTable && seat !== mySeat && Boolean(liveRoom.seats[seat])}
          onKick={() => void send({ op: 'kick', seat })}
        />
      ))}

      {/* ------------------------------ 牌 ------------------------------ */}
      <div className="card-layer">
        {entities.map((entity) => (
          <div
            key={entity.key}
            className={`ent ${entity.cls ?? ''}`}
            style={{
              transform: `translate(${entity.x - CARD_W / 2}px, ${entity.y - CARD_H / 2}px) rotate(${entity.rot ?? 0}deg) scale(${entity.scale})`,
              zIndex: entity.z,
            }}
            onClick={entity.onClick}
          >
            <div
              className="ent-in"
              style={{
                ['--fx' as string]: `${(DEAL_FROM.x - entity.x) / entity.scale}px`,
                ['--fy' as string]: `${(DEAL_FROM.y - entity.y) / entity.scale}px`,
                animationDelay: `${entity.dealDelay ?? 0}s`,
              }}
            >
              <CardView card={entity.card} faceUp={entity.faceUp} wildAs={entity.wildAs} tag={entity.tag} />
            </div>
          </div>
        ))}
      </div>

      {/* ------------------------------ 亮牌结果 ------------------------------ */}
      {inShowdown && lastResult && [leftSeat, rightSeat, mySeat].map((seat) => {
        const side = sideOf(seat)
        const entry = lastResult.entries[seat]
        const shown = revealed(seat) || phase === 'finished'
        if (!shown) return null
        const lose = lastResult.losers.includes(seat)
        const win = lastResult.winners.includes(seat)
        return (
          <div key={`${lastResult.round}-${seat}`} className={`verdict verdict-${side}`} style={{ left: SLOT[side].x, top: SLOT[side].y }}>
            {entry.evaluation.type === 'leopard' && <div className="leopard-burst">豹子！</div>}
            {verdict && win && <div className="win-sparks">{Array.from({ length: 8 }, (_, index) => <i key={index} style={{ ['--a' as string]: `${index * 45}deg` }} />)}</div>}
            <div className={`hand-plaque type-${entry.evaluation.type}`}>
              <b>{HAND_NAME[entry.evaluation.type]}</b>
              <span>{describeHand(entry.evaluation).split(' ')[1]}</span>
            </div>
            {verdict && (
              <>
                {lose && <div className="stamp">逮</div>}
                <div className={`rank-ribbon ${lose ? 'lose' : win ? 'win' : 'even'}`}>
                  {lose ? '第二名 · 被逮' : win ? (entry.rank === 1 ? '头名' : '末位 · 逃脱') : '平手'}
                </div>
                {entry.delta !== 0 && <div className={`delta num ${entry.delta > 0 ? 'up' : 'down'}`}>{entry.delta > 0 ? `+${entry.delta}` : entry.delta}</div>}
              </>
            )}
          </div>
        )
      })}

      {/* 金币飞行 */}
      {inShowdown && verdict && phase !== 'finished' && lastResult?.transfers.map((transfer, tIndex) => {
        const from = SLOT[sideOf(transfer.from)]
        const to = SLOT[sideOf(transfer.to)]
        return Array.from({ length: transfer.doubled ? 12 : 7 }, (_, index) => (
          <i
            key={`${lastResult.round}-${tIndex}-${index}`}
            className="fly-coin"
            style={{
              left: from.x + ((index * 37) % 60) - 30,
              top: from.y + ((index * 53) % 40) - 20,
              ['--dx' as string]: `${to.x - from.x}px`,
              ['--dy' as string]: `${to.y - from.y}px`,
              animationDelay: `${0.25 + index * 0.07 + tIndex * 0.12}s`,
            }}
          />
        ))
      })}

      {/* ------------------------------ 操作区 ------------------------------ */}
      {showTable && game && playing && !spectating && (
        <div className="actions">
          {canPick ? (
            <>
              <div className={`preview ${preview ? `type-${preview.type}` : ''}`}>
                {preview ? <b>{preview.text}</b> : <span>已选 {selected.length} / 2 张</span>}
              </div>
              <div className="action-row">
                {publicCard && (
                  <div className="quick-picks">
                    <button type="button" className="chip" onClick={() => suggest('max')}>出最大</button>
                    <button type="button" className="chip" onClick={() => suggest('min')}>出最小</button>
                  </div>
                )}
                <Button kind="gold" size="lg" disabled={selected.length !== 2 || submitting} onClick={() => void confirm()}>
                  出牌 <small className={`num ${remainSec <= 5 ? 'urgent' : ''}`}>{remainSec}</small>
                </Button>
              </div>
            </>
          ) : phase === 'selecting' && round < MAX_ROUNDS ? (
            <div className="preview waiting-others"><b>已出牌</b><span>等待亮牌…</span></div>
          ) : null}
        </div>
      )}

      {/* 快捷发言 */}
      {spectating && <div className="spectate-tag">观战中 · 只能看到公开的牌</div>}
      {!spectating && (
        <div className="emote-box">
          <button type="button" className="icon-btn" onClick={() => { sfx.click(); setEmoteOpen((value) => !value) }} title="快捷发言">言</button>
          {emoteOpen && (
            <div className="panel emote-menu">
              {Object.entries(EMOTES).map(([key, text]) => (
                <button key={key} type="button" onClick={() => { setEmoteOpen(false); void send({ op: 'emote', key }) }}>{text}</button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ------------------------------ 弹层 ------------------------------ */}
      {result && (
        <ResultOverlay
          room={result}
          onAgain={async () => {
            if (await send({ op: 'again' })) dismissResult()
          }}
          onLeave={() => void leave()}
        />
      )}
      {modal === 'history' && <HistoryModal room={room} onClose={() => setModal(null)} />}
      {modal === 'rules' && <RulesModal onClose={() => setModal(null)} />}
      {modal === 'leave' && (
        <Modal title="离开牌桌" onClose={() => setModal(null)} width={520}>
          <p className="modal-lead">对局尚未结束。现在离开将由 AI 替你托管，<br />本局输赢仍会照常结算。</p>
          <div className="modal-actions">
            <Button kind="ghost" size="md" onClick={() => void leave()}>仍要离开</Button>
            <Button kind="gold" size="md" onClick={() => setModal(null)}>继续对局</Button>
          </div>
        </Modal>
      )}
    </div>
  )
}
