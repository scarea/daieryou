// 红中麻将牌桌：掷骰定庄、摸打碰杠、教练提示、结算与复盘。
import { PointerEvent, useEffect, useMemo, useRef, useState } from 'react'
import { formatCoins, hallById } from '../../shared/economy.ts'
import { analyzeDiscards, shanten, waits } from '../../shared/mahjong/hand.ts'
import type { DiceRound, Meld, MjAction } from '../../shared/mahjong/game.ts'
import { KIND_COUNT, ZHONG, countKinds, kindName, kindOf, kindShort, sortTiles } from '../../shared/mahjong/tiles.ts'
import { MJ_LEVEL_NAME, MjSeatView, MjView } from '../../shared/mahjong/view.ts'
import { Avatar, Button, Coins, CountUp, Modal, MusicToggle, SoundToggle } from '../components/ui.tsx'
import { useStore } from '../store.ts'
import { sfx, voice } from '../sound.ts'
import { MahjongRules } from './MahjongRules.tsx'
import { ReviewModal } from './ReviewModal.tsx'
import { Tile, preloadTiles } from './Tile.tsx'

type Side = 'bottom' | 'right' | 'top' | 'left'
const SIDES: Side[] = ['bottom', 'right', 'top', 'left']
const COACH_KEY = 'daieryou.mjCoach'

const readFlag = (key: string, fallback: boolean) => {
  try {
    const value = localStorage.getItem(key)
    return value === null ? fallback : value === '1'
  } catch {
    return fallback
  }
}

/** 根据我能看到的牌，算出每种牌还剩几张 */
function remainingFromView(table: MjView): number[] {
  const seen = countKinds(table.hand)
  for (const seat of table.seats) {
    for (const tile of seat.discards) seen[kindOf(tile)] += 1
    for (const meld of seat.melds) if (meld.kind >= 0) seen[meld.kind] += meld.tiles.length
  }
  return seen.map((count) => Math.max(0, 4 - count))
}

// ------------------------------ 骰子 ------------------------------

const PIPS: Record<number, [number, number][]> = {
  1: [[1, 1]],
  2: [[0, 0], [2, 2]],
  3: [[0, 0], [1, 1], [2, 2]],
  4: [[0, 0], [0, 2], [2, 0], [2, 2]],
  5: [[0, 0], [0, 2], [1, 1], [2, 0], [2, 2]],
  6: [[0, 0], [0, 2], [1, 0], [1, 2], [2, 0], [2, 2]],
}

function Die({ value, rolling }: { value: number; rolling: boolean }) {
  return (
    <span className={`mj-die ${rolling ? 'rolling' : ''} ${value === 1 || value === 4 ? 'red' : ''}`}>
      {PIPS[value].map(([row, col], index) => <i key={index} style={{ gridRow: row + 1, gridColumn: col + 1 }} />)}
    </span>
  )
}

function DiceStage({ rounds, dealer, seats }: { rounds: DiceRound[]; dealer: number; seats: MjSeatView[] }) {
  // step：已经掷完的人数（跨所有轮次累计）
  const [step, setStep] = useState(0)
  const [rollingSeat, setRollingSeat] = useState(-1)
  const [done, setDone] = useState(false)
  const order = useMemo(() => rounds.flatMap((round, roundIndex) => round.seats.map((seat, index) => ({ roundIndex, seat, roll: round.rolls[index] }))), [rounds])

  useEffect(() => {
    const timers: number[] = []
    let at = 500
    order.forEach((item, index) => {
      // 首轮每人依次掷；重掷的轮次节奏快一些
      const span = item.roundIndex === 0 ? 1050 : 620
      timers.push(window.setTimeout(() => { setRollingSeat(item.seat); sfx.diceRoll() }, at))
      timers.push(window.setTimeout(() => { setRollingSeat(-1); setStep(index + 1); sfx.pop() }, at + span - 220))
      at += span
    })
    timers.push(window.setTimeout(() => { setDone(true); sfx.gong() }, at + 150))
    return () => timers.forEach((timer) => window.clearTimeout(timer))
  }, [order])

  // 每个座位当前显示的点数：取已经掷完的最近一次
  const shown = new Map<number, { roll: [number, number]; roundIndex: number }>()
  order.slice(0, step).forEach((item) => shown.set(item.seat, { roll: item.roll, roundIndex: item.roundIndex }))
  const currentRound = step < order.length ? order[step].roundIndex : rounds.length - 1

  return (
    <div className="mj-dice-stage">
      <div className="mj-dice-title gold-text">掷骰定庄</div>
      <p className="mj-dice-sub">{currentRound === 0 ? '每人掷两颗骰子，点数最大者坐庄' : '点数并列，继续掷'}</p>
      <div className="mj-dice-seats">
        {seats.map((seat) => {
          const result = shown.get(seat.seat)
          const rolling = rollingSeat === seat.seat
          const out = currentRound > 0 && !rounds[currentRound].seats.includes(seat.seat)
          return (
            <div key={seat.seat} className={`mj-dice-seat ${done && seat.seat === dealer ? 'win' : ''} ${out && !done ? 'out' : ''} ${done && seat.seat !== dealer ? 'out' : ''}`}>
              <Avatar index={seat.avatar} size={54} frame={seat.frame} />
              <b>{seat.name}</b>
              <div className="mj-dice-pair">
                <Die value={rolling ? 1 + ((seat.seat * 3) % 6) : result?.roll[0] ?? 1} rolling={rolling} />
                <Die value={rolling ? 1 + ((seat.seat * 5 + 2) % 6) : result?.roll[1] ?? 1} rolling={rolling} />
              </div>
              <span className="mj-dice-sum num">{result && !rolling ? result.roll[0] + result.roll[1] : '—'}</span>
              {done && seat.seat === dealer && <i className="mj-dealer-stamp">庄</i>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ------------------------------ 副露（碰 / 杠） ------------------------------

function Melds({ melds, size }: { melds: Meld[]; size: string }) {
  return (
    <div className="mj-melds">
      {melds.map((meld, index) => (
        <div key={index} className={`mj-meld mj-meld-${meld.type}`}>
          {meld.tiles.map((tile, tileIndex) => {
            // 暗杠：自己的两头盖住中间亮；别人的全盖
            const hidden = meld.type === 'ankan' && (meld.kind < 0 || tileIndex === 0 || tileIndex === 3)
            return <Tile key={tileIndex} kind={hidden ? -1 : kindOf(tile)} className={size} />
          })}
        </div>
      ))}
    </div>
  )
}

// ------------------------------ 主场景 ------------------------------

export function Mahjong({ table }: { table: MjView }) {
  const send = useStore((state) => state.send)
  const user = useStore((state) => state.user)!
  const [selected, setSelected] = useState<number | null>(null)
  const [coach, setCoach] = useState(() => readFlag(COACH_KEY, true))
  const [voiceOn, setVoiceOn] = useState(voice.isOn())
  const [modal, setModal] = useState<'rules' | 'review' | 'leave' | null>(null)
  const [burst, setBurst] = useState<{ seat: number; text: string; key: number } | null>(null)
  const [resultStage, setResultStage] = useState(0)
  const [busy, setBusy] = useState(false)
  const drag = useRef<{ tile: number; y: number } | null>(null)
  const sceneRef = useRef<HTMLDivElement>(null)

  useEffect(() => preloadTiles(), [])

  // 光源跟着指针走：桌面上的光斑、牌的高光与投影方向都随之变化
  useEffect(() => {
    const scene = sceneRef.current
    if (!scene) return
    let frame = 0
    const move = (event: globalThis.PointerEvent) => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        const box = scene.getBoundingClientRect()
        const x = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width))
        const y = Math.min(1, Math.max(0, (event.clientY - box.top) / box.height))
        scene.style.setProperty('--lx', `${(x * 100).toFixed(1)}%`)
        scene.style.setProperty('--ly', `${(y * 100).toFixed(1)}%`)
        // 投影落在光源的反方向
        scene.style.setProperty('--sx', `${((0.5 - x) * 14).toFixed(1)}px`)
        scene.style.setProperty('--sy', `${(6 + (0.5 - y) * 8).toFixed(1)}px`)
      })
    }
    window.addEventListener('pointermove', move)
    return () => {
      window.removeEventListener('pointermove', move)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [])

  /** 手牌随指针微微倾斜，高光跟着移动 */
  const tilt = (event: PointerEvent<HTMLButtonElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    const x = (event.clientX - box.left) / box.width - 0.5
    const y = (event.clientY - box.top) / box.height - 0.5
    event.currentTarget.style.setProperty('--ry', `${(x * 22).toFixed(1)}deg`)
    event.currentTarget.style.setProperty('--rx', `${(-y * 16).toFixed(1)}deg`)
    event.currentTarget.style.setProperty('--gx', `${((x + 0.5) * 100).toFixed(0)}%`)
  }
  const untilt = (event: PointerEvent<HTMLButtonElement>) => {
    event.currentTarget.style.setProperty('--ry', '0deg')
    event.currentTarget.style.setProperty('--rx', '0deg')
  }

  const hall = hallById(table.hallId)
  const me = table.seats[0]
  const myTurn = table.phase === 'play' && table.turn === 0
  const myClaim = table.phase === 'claim' && table.claimSeat === 0
  const canDiscard = myTurn && table.choices.discards.length > 0

  // ------------------------------ 事件 → 音效、语音、演出 ------------------------------
  const lastSeq = useRef(0)
  useEffect(() => {
    if (table.seq === lastSeq.current) return
    lastSeq.current = table.seq
    setBusy(false)
    const event = table.lastEvent
    if (!event) return
    const show = (seat: number, text: string) => setBurst({ seat, text, key: table.seq })
    switch (event.t) {
      case 'discard':
        sfx.tileDiscard()
        voice.say(kindName(kindOf(event.tile)))
        break
      case 'draw':
        if (event.seat === 0) sfx.tileDraw()
        break
      case 'pung':
        sfx.tileMeld(3)
        voice.say('碰', { urgent: true, rate: 1 })
        show(event.seat, '碰')
        break
      case 'kong':
      case 'ankan':
      case 'bukan':
        sfx.tileMeld(4)
        window.setTimeout(() => sfx.coins(), 350)
        voice.say('杠', { urgent: true, rate: 1 })
        show(event.seat, '杠')
        break
      case 'hu':
        sfx.mahjongWin()
        voice.say(table.result?.shaGui ? '杀鬼，自摸' : '自摸', { urgent: true, rate: 0.95 })
        show(event.seat, table.result?.shaGui ? '杀鬼' : '自摸')
        break
      case 'drawn-game':
        sfx.lose()
        voice.say('流局', { urgent: true, rate: 1 })
        break
      default:
        break
    }
  }, [table.seq]) // eslint-disable-line react-hooks/exhaustive-deps

  // 新的一局开牌：洗牌声
  useEffect(() => {
    if (table.phase !== 'dice') sfx.tileShuffle()
    setSelected(null)
    setResultStage(0)
  }, [table.handNo]) // eslint-disable-line react-hooks/exhaustive-deps
  const wasDice = useRef(table.phase === 'dice')
  useEffect(() => {
    if (wasDice.current && table.phase !== 'dice') sfx.tileShuffle()
    wasDice.current = table.phase === 'dice'
  }, [table.phase])

  useEffect(() => {
    if (!burst) return
    const timer = window.setTimeout(() => setBurst(null), 1500)
    return () => window.clearTimeout(timer)
  }, [burst])

  // 结算演出：亮牌 → 翻鸟 → 算分
  useEffect(() => {
    if (table.phase !== 'over') return
    const timers = [
      window.setTimeout(() => setResultStage(1), table.result && table.result.winner >= 0 ? 1500 : 900),
      window.setTimeout(() => { setResultStage(2); if (table.result && table.result.winner >= 0) { sfx.flip(); sfx.pop() } }, 2500),
      window.setTimeout(() => { setResultStage(3); sfx.coins() }, 3500),
    ]
    return () => timers.forEach((timer) => window.clearTimeout(timer))
  }, [table.phase, table.handNo]) // eslint-disable-line react-hooks/exhaustive-deps

  // ------------------------------ 手牌与教练 ------------------------------
  const handOrder = useMemo(() => {
    const rest = table.drawn !== null ? table.hand.filter((tile) => tile !== table.drawn) : table.hand
    return sortTiles(rest)
  }, [table.hand, table.drawn])

  const remaining = useMemo(() => remainingFromView(table), [table.seq]) // eslint-disable-line react-hooks/exhaustive-deps
  const counts = useMemo(() => countKinds(table.hand), [table.hand])

  const advice = useMemo(() => {
    if (!canDiscard) return null
    const options = analyzeDiscards([...counts], me.melds.length, remaining, table.options)
    const real = options.filter((option) => option.kind !== ZHONG)
    const top = real[0] ?? options[0]
    // 进张相同的打法里，优先打最孤立、最靠边的牌（留着的用处最小）
    const loneliness = (kind: number) => {
      const rank = (kind % 9) + 1
      let near = (counts[kind] - 1) * 3
      for (const offset of [-2, -1, 1, 2]) {
        const target = rank + offset
        if (target >= 1 && target <= 9) near += counts[kind + offset] * (Math.abs(offset) === 1 ? 2 : 1)
      }
      return near * 10 + (rank >= 3 && rank <= 7 ? 2 : rank === 2 || rank === 8 ? 1 : 0)
    }
    const ties = real.filter((option) => option.shanten === top.shanten && option.ukeire === top.ukeire).sort((a, b) => loneliness(a.kind) - loneliness(b.kind))
    const best = ties[0] ?? top
    const bestKinds = new Set(ties.filter((option) => loneliness(option.kind) === loneliness(best.kind)).slice(0, 2).map((option) => option.kind))
    const tieCount = ties.length
    return { options, best, bestKinds, tieCount, byKind: new Map(options.map((option) => [option.kind, option])) }
  }, [canDiscard, counts, me.melds.length, remaining, table.options])

  const tenpai = useMemo(() => {
    if (table.phase === 'over' || table.phase === 'dice' || table.hand.length % 3 !== 1) return null
    if (shanten([...counts], me.melds.length, table.options) !== 0) return null
    return waits([...counts], me.melds.length, remaining, table.options)
  }, [table.phase, table.hand.length, counts, me.melds.length, remaining, table.options])

  const currentShanten = useMemo(() => {
    if (table.phase === 'dice' || table.hand.length === 0) return null
    return advice ? advice.best.shanten : shanten([...counts], me.melds.length, table.options)
  }, [advice, counts, me.melds.length, table.options, table.phase, table.hand.length])

  // ------------------------------ 操作 ------------------------------
  const act = async (action: MjAction) => {
    if (busy) return
    setBusy(true)
    setSelected(null)
    const ok = await send({ op: 'mj:act', action })
    if (!ok) setBusy(false)
  }

  const discard = (tile: number) => {
    if (!canDiscard || !table.choices.discards.includes(tile)) return
    void act({ type: 'discard', tile })
  }

  const onTileDown = (event: PointerEvent, tile: number) => {
    if (!canDiscard) return
    drag.current = { tile, y: event.clientY }
  }
  const onTileUp = (event: PointerEvent, tile: number) => {
    if (!canDiscard) return
    const start = drag.current
    drag.current = null
    // 往上甩出去：直接打出
    if (start && start.tile === tile && start.y - event.clientY > 46) return discard(tile)
    if (selected === tile) return discard(tile)
    sfx.tilePick()
    setSelected(tile)
  }

  const toggleCoach = () => {
    const next = !coach
    setCoach(next)
    try {
      localStorage.setItem(COACH_KEY, next ? '1' : '0')
    } catch {
      // ignore
    }
    sfx.click()
  }

  const leave = async () => {
    setModal(null)
    await send({ op: 'mj:leave' })
  }

  const selectedOption = selected !== null && advice ? advice.byKind.get(kindOf(selected)) : null
  const result = table.result
  const winner = result && result.winner >= 0 ? table.seats[result.winner] : null
  const lastTile = table.lastDiscard

  const renderHandTile = (tile: number, extra = '') => {
    const kind = kindOf(tile)
    const option = coach && advice ? advice.byKind.get(kind) : null
    const best = coach && advice?.bestKinds.has(kind)
    const blocked = canDiscard && !table.choices.discards.includes(tile)
    return (
      <button
        key={tile}
        type="button"
        className={`mj-hand-tile ${extra} ${selected === tile ? 'selected' : ''} ${canDiscard ? 'live' : ''} ${best ? 'best' : ''} ${blocked ? 'blocked' : ''}`}
        onPointerDown={(event) => onTileDown(event, tile)}
        onPointerUp={(event) => onTileUp(event, tile)}
        onPointerMove={tilt}
        onPointerLeave={untilt}
        onDoubleClick={() => discard(tile)}
      >
        <Tile kind={kind} />
        {option && kind !== ZHONG && (
          <span className={`mj-ukeire ${best ? 'best' : ''}`}>{best ? '荐 ' : ''}{option.shanten > advice!.best.shanten ? '退' : option.ukeire}</span>
        )}
      </button>
    )
  }

  return (
    <div ref={sceneRef} className={`scene mj-scene ${user.felt ? `felt-${user.felt}` : ''}`}>
      {/* ------------------------------ 顶栏 ------------------------------ */}
      <header className="table-top">
        <div className="table-top-left">
          <Button kind="ghost" size="sm" onClick={() => (table.phase === 'over' || table.phase === 'dice' ? void leave() : setModal('leave'))}>‹ 离开</Button>
          <div className="table-hall">
            <b className="gold-text">红中麻将</b>
            <span>{hall?.name} · 每分 <Coins value={table.stake} size={15} /></span>
            <span className="muted">第 {table.handNo} 局 · {MJ_LEVEL_NAME[table.level]}试炼</span>
          </div>
        </div>
        <div className="table-top-right">
          <button type="button" className={`mj-switch ${coach ? 'on' : ''}`} onClick={toggleCoach} title="出牌时显示每种打法的进张数">教练提示</button>
          <button
            type="button"
            className={`mj-switch ${voiceOn ? 'on' : ''}`}
            title="语音报牌"
            onClick={() => { voice.setOn(!voiceOn); setVoiceOn(!voiceOn); sfx.click() }}
          >语音</button>
          <Button kind="ghost" size="sm" onClick={() => setModal('rules')}>规则</Button>
          <MusicToggle />
          <SoundToggle />
        </div>
      </header>

      {/* ------------------------------ 牌桌平面（带透视）：桌面、牌墙余量、对手手牌、副露、弃牌 ------------------------------ */}
      <div className="mj-plane">
        <div className="mj-felt"><div className="mj-felt-inner"><i className="mj-spot" /></div></div>

        {table.phase !== 'dice' && (
          <div className="mj-center">
            <div className="mj-wall">
              <small>余牌</small>
              <b className={`num ${table.wallCount <= 12 ? 'low' : ''}`}>{table.wallCount}</b>
            </div>
            {table.seats.map((seat) => {
              const active = table.phase === 'claim' ? table.claimSeat === seat.seat : table.phase === 'play' && table.turn === seat.seat
              return (
                <div key={seat.seat} className={`mj-compass mj-compass-${SIDES[seat.seat]} ${active ? 'active' : ''}`}>
                  {table.dealer === seat.seat && <i>庄</i>}
                  <b key={seat.total} className={`num pop ${seat.total > 0 ? 'up' : seat.total < 0 ? 'down' : ''}`}>{seat.total > 0 ? `+${seat.total}` : seat.total}</b>
                </div>
              )
            })}
          </div>
        )}

        {table.phase !== 'dice' && table.seats.map((seat) => {
          const side = SIDES[seat.seat]
          return (
            <div key={seat.seat} className={`mj-seat mj-seat-${side}`}>
              {side !== 'bottom' && (
                <div className={`mj-opp-hand ${seat.hand ? 'shown' : ''}`}>
                  {seat.hand
                    ? sortTiles(seat.hand).map((tile) => <Tile key={tile} kind={kindOf(tile)} className="xs" />)
                    : Array.from({ length: seat.handCount }, (_, index) => (side === 'top' ? <Tile key={index} kind={-1} className="xs stand" /> : <span key={index} className="mj-slab" />))}
                </div>
              )}
              {side !== 'bottom' && <Melds melds={seat.melds} size="xs" />}
              <div className="mj-river">
                {seat.discards.map((tile, index) => {
                  const isLast = lastTile?.seat === seat.seat && index === seat.discards.length - 1
                  return <Tile key={tile} kind={kindOf(tile)} className={`sm ${isLast ? 'last' : ''}`} />
                })}
              </div>
            </div>
          )
        })}
      </div>

      {/* ------------------------------ 悬浮层（不带透视）：头像与碰杠胡的大字 ------------------------------ */}
      {table.phase !== 'dice' && table.seats.map((seat) => {
        const side = SIDES[seat.seat]
        const active = table.phase === 'claim' ? table.claimSeat === seat.seat : table.phase === 'play' && table.turn === seat.seat
        return (
          <div key={seat.seat} className={`mj-seat mj-seat-${side} ${active ? 'active' : ''}`}>
            <div className="mj-player">
              <Avatar index={seat.avatar} size={side === 'bottom' ? 66 : 54} frame={seat.frame} />
              <div className="mj-player-info">
                <b>{seat.name}</b>
                <small>{seat.isBot ? MJ_LEVEL_NAME[table.level] : `${formatCoins(user.coins)} 金币`}</small>
              </div>
              {table.dealer === seat.seat && <i className="mj-dealer">庄</i>}
            </div>
            {burst?.seat === seat.seat && <div key={burst.key} className={`mj-burst ${burst.text.length > 1 ? 'wide' : ''}`}>{burst.text}</div>}
          </div>
        )
      })}

      {/* ------------------------------ 我的手牌 ------------------------------ */}
      {table.phase !== 'dice' && (
        <div className={`mj-hand ${table.phase === 'over' ? 'revealed' : ''}`}>
          <div className="mj-hand-tiles">
            {handOrder.map((tile) => renderHandTile(tile))}
            {table.drawn !== null && renderHandTile(table.drawn, 'drawn')}
          </div>
          <Melds melds={me.melds} size="md" />
        </div>
      )}

      {/* ------------------------------ 操作按钮 ------------------------------ */}
      {(myClaim || (myTurn && (table.choices.hu || table.choices.ankan.length > 0 || table.choices.bukan.length > 0))) && (
        <div className="mj-actions">
          {table.choices.hu && <button type="button" className="mj-act hu" onClick={() => void act({ type: 'hu' })}>胡</button>}
          {table.choices.kong && <button type="button" className="mj-act kong" onClick={() => void act({ type: 'kong' })}>杠</button>}
          {table.choices.ankan.map((kind) => (
            <button key={`a${kind}`} type="button" className="mj-act kong" onClick={() => void act({ type: 'ankan', kind })}>杠<small>{kindShort(kind)}</small></button>
          ))}
          {table.choices.bukan.map((kind) => (
            <button key={`b${kind}`} type="button" className="mj-act kong" onClick={() => void act({ type: 'bukan', kind })}>杠<small>{kindShort(kind)}</small></button>
          ))}
          {table.choices.pung && <button type="button" className="mj-act pung" onClick={() => void act({ type: 'pung' })}>碰</button>}
          {table.choices.pass && <button type="button" className="mj-act pass" onClick={() => void act({ type: 'pass' })}>过</button>}
        </div>
      )}

      {/* ------------------------------ 教练面板 ------------------------------ */}
      {coach && table.phase !== 'dice' && table.phase !== 'over' && (
        <div className="mj-coach">
          <div className="mj-coach-head">
            <i>师</i>
            <b>{currentShanten === null ? '' : currentShanten <= 0 ? (canDiscard ? '打对牌即可听牌' : '已听牌') : `${currentShanten} 向听`}</b>
            <small>{currentShanten !== null && currentShanten > 0 ? `差 ${currentShanten} 张有效牌听牌` : ''}</small>
          </div>
          {canDiscard && advice && (
            <p>
              {selectedOption ? (
                <>打 <em>{kindShort(selectedOption.kind)}</em>：{selectedOption.shanten > advice.best.shanten ? '向听数后退，不建议' : `进张 ${selectedOption.ukeire} 张`}
                  {selectedOption.accepts.length > 0 && <span className="mj-coach-tiles">{selectedOption.accepts.slice(0, 14).map((kind) => <Tile key={kind} kind={kind} className="xxs" />)}</span>}
                </>
              ) : (
                <>建议打 <em>{[...advice.bestKinds].map(kindShort).join(' / ')}</em>，进张 {advice.best.ukeire} 张{advice.tieCount > advice.bestKinds.size ? `（另有 ${advice.tieCount - advice.bestKinds.size} 种打法进张相同）` : ''}</>
              )}
            </p>
          )}
          {!canDiscard && tenpai && tenpai.length > 0 && (
            <p>
              听：
              <span className="mj-coach-tiles">
                {tenpai.map((wait) => <span key={wait.kind} className="mj-wait"><Tile kind={wait.kind} className="xxs" /><small className="num">×{wait.left}</small></span>)}
              </span>
            </p>
          )}
          {myClaim && <p>别人打出 <em>{lastTile ? kindShort(kindOf(lastTile.tile)) : ''}</em>：碰了能更近一步才划算；能杠就杠，白拿 3 分。</p>}
        </div>
      )}
      {!coach && tenpai && tenpai.length > 0 && table.phase !== 'over' && <div className="mj-tenpai">已听牌</div>}

      {/* ------------------------------ 掷骰 ------------------------------ */}
      {table.phase === 'dice' && table.dice && <DiceStage rounds={table.dice} dealer={table.dealer} seats={table.seats} />}

      {/* ------------------------------ 结算 ------------------------------ */}
      {table.phase === 'over' && result && resultStage >= 1 && (
        <div className={`mj-result-mask ${result.winner === 0 ? 'is-win' : ''}`}>
          {result.winner === 0 && <div className="result-rays" />}
          <div className="mj-result">
            <h2 className={`mj-result-title ${result.winner < 0 ? 'draw' : ''}`}>
              {Array.from(result.winner < 0 ? '流局' : result.winner === 0 ? (result.shaGui ? '杀鬼自摸' : '自摸胡牌') : `${winner!.name} 自摸`).map((char, index) => (
                <span key={index} style={{ animationDelay: `${index * 0.09}s` }}>{char}</span>
              ))}
            </h2>

            {winner && (
              <div className="mj-result-hand">
                {sortTiles(winner.hand ?? []).map((tile) => <Tile key={tile} kind={kindOf(tile)} className="md" />)}
                <Melds melds={winner.melds} size="md" />
              </div>
            )}

            {winner && (
              <div className="mj-bird">
                <div className={`mj-bird-tile ${resultStage >= 2 ? 'open' : ''}`}>
                  <Tile kind={resultStage >= 2 ? kindOf(result.bird) : -1} className="lg" />
                  <small>抓鸟</small>
                </div>
                {resultStage >= 2 && (
                  <div className="mj-bird-math">
                    <span><b className="num">{result.birdScore}</b><small>{kindName(kindOf(result.bird))}</small></span>
                    {result.shaGui && <><i>×</i><span className="sha"><b className="num">2</b><small>杀鬼</small></span></>}
                    <i>=</i>
                    <span className="total"><b className="num">{result.perPlayer}</b><small>分 / 家</small></span>
                  </div>
                )}
              </div>
            )}
            {!winner && <p className="mj-result-note">牌摸完了没人胡，庄家连庄。已经结算的杠分照常保留。</p>}

            {resultStage >= 3 && (
              <table className="mj-score">
                <thead>
                  <tr><th /><th>杠分</th><th>胡牌</th><th>本局</th><th>本桌累计</th></tr>
                </thead>
                <tbody>
                  {table.seats.map((seat) => {
                    const kong = table.kongs.reduce((sum, item) => sum + item.deltas[seat.seat], 0)
                    const win = result.winDeltas[seat.seat]
                    const sign = (value: number) => (value > 0 ? `+${value}` : `${value}`)
                    return (
                      <tr key={seat.seat} className={`${seat.seat === 0 ? 'me' : ''} ${seat.seat === result.winner ? 'winner' : ''}`}>
                        <td><Avatar index={seat.avatar} size={30} ring={false} /> {seat.name}{table.dealer === seat.seat && <i className="mj-dealer">庄</i>}</td>
                        <td className={kong > 0 ? 'up' : kong < 0 ? 'down' : ''}>{kong === 0 ? '—' : sign(kong)}</td>
                        <td className={win > 0 ? 'up' : win < 0 ? 'down' : ''}>{win === 0 ? '—' : sign(win)}</td>
                        <td className={`big ${seat.score > 0 ? 'up' : seat.score < 0 ? 'down' : ''}`}>{sign(seat.score)}</td>
                        <td className={seat.total > 0 ? 'up' : seat.total < 0 ? 'down' : ''}>{sign(seat.total)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}

            {resultStage >= 3 && (
              <>
                <div className="mj-result-coins">
                  {table.settlement ? (
                    <>
                      金币 <span className={`coins ${table.settlement.coinsDelta > 0 ? 'up' : table.settlement.coinsDelta < 0 ? 'down' : ''}`} style={{ fontSize: 24 }}>
                        <b><CountUp value={table.settlement.coinsDelta} from={0} signed duration={900} tick /></b>
                      </span>
                      <small className="muted">荣誉 {table.settlement.honorDelta >= 0 ? '+' : ''}{table.settlement.honorDelta} · 经验 +{table.settlement.expGain}</small>
                    </>
                  ) : <small className="muted">结算中…</small>}
                </div>
                <div className="result-actions">
                  <Button kind="ghost" size="md" onClick={() => void leave()}>离开</Button>
                  <Button kind="gold" size="lg" onClick={() => void send({ op: 'mj:next' })}>下一局</Button>
                  <Button kind="jade" size="md" disabled={!table.record || !table.settlement} onClick={() => setModal('review')}>复盘这一局</Button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {modal === 'review' && table.record && table.settlement && (
        <ReviewModal
          record={table.record}
          matchId={table.settlement.matchId}
          outcome={result && result.winner === 0 ? `我自摸胡牌${result.shaGui ? '（杀鬼）' : ''}，本局 +${me.score} 分` : result && result.winner > 0 ? `${winner?.name} 自摸，我本局 ${me.score} 分` : `流局，我本局 ${me.score} 分`}
          onClose={() => setModal(null)}
        />
      )}
      {modal === 'rules' && <MahjongRules onClose={() => setModal(null)} />}
      {modal === 'leave' && (
        <Modal title="离开牌桌" onClose={() => setModal(null)} width={520}>
          <p className="modal-lead">这一局还没打完。现在离开，这局已经结算的杠分照常入账，<br />未胡的部分不计输赢。</p>
          <div className="modal-actions">
            <Button kind="ghost" size="md" onClick={() => void leave()}>仍要离开</Button>
            <Button kind="gold" size="md" onClick={() => setModal(null)}>继续打</Button>
          </div>
        </Modal>
      )}
    </div>
  )
}

export { KIND_COUNT }
