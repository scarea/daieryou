// 常宁六胡抢牌桌：翻牌定庄、摸牌亮牌、吃碰笑提跑、听牌提示与结算。
import { PointerEvent, useEffect, useMemo, useRef, useState } from 'react'
import { formatCoins, hallById } from '../../shared/economy.ts'
import type { LhAction, LhMeld } from '../../shared/liuhu/game.ts'
import { GROUP_NAME, checkWin } from '../../shared/liuhu/hand.ts'
import { lhKind, lhName } from '../../shared/liuhu/tiles.ts'
import { LH_LEVEL_NAME, LhView } from '../../shared/liuhu/view.ts'
import { stageUp, useStage } from '../components/Stage.tsx'
import { Avatar, Button, Coins, CountUp, Modal, MusicToggle, SoundToggle } from '../components/ui.tsx'
import { api } from '../net.ts'
import { useStore } from '../store.ts'
import { sfx, voice } from '../sound.ts'
import { LiuhuRules } from './LiuhuRules.tsx'
import { Zi, arrangeHand } from './Zi.tsx'

type Side = 'bottom' | 'right' | 'top' | 'left'
const SIDES: Side[] = ['bottom', 'right', 'top', 'left']
const WHO = ['我', '下家', '对家', '上家']
const COACH_KEY = 'daieryou.lhCoach'
const KIND_TITLE = { zimo: '自摸', pao: '胡牌', gong: '抢胡' }

const readFlag = (key: string, fallback: boolean) => {
  try {
    const value = localStorage.getItem(key)
    return value === null ? fallback : value === '1'
  } catch {
    return fallback
  }
}

function MeldColumn({ meld, size }: { meld: LhMeld; size: string }) {
  return (
    <span className={`lh-meld ${meld.type}`}>
      {meld.tiles.map((tile, index) => <Zi key={index} kind={tile < 0 ? -1 : lhKind(tile)} className={size} />)}
      {meld.hu > 0 && <em className="num">{meld.hu}</em>}
    </span>
  )
}

/** 现在这手牌在等哪些牌（按别人打出来算，最保守） */
function waitsOf(melds: LhMeld[], hand: number[]): number[] {
  const kinds: number[] = []
  for (let kind = 0; kind < 20; kind += 1) if (checkWin(melds, hand, kind * 4, false)) kinds.push(kind)
  return kinds
}

export function Liuhu({ table }: { table: LhView }) {
  const send = useStore((state) => state.send)
  const user = useStore((state) => state.user)!
  const toast = useStore((state) => state.toast)
  const [selected, setSelected] = useState<number | null>(null)
  const [coach, setCoach] = useState(() => readFlag(COACH_KEY, true))
  const [voiceOn, setVoiceOn] = useState(voice.isOn())
  const [modal, setModal] = useState<'rules' | 'leave' | null>(null)
  const [burst, setBurst] = useState<{ seat: number; text: string; key: number } | null>(null)
  const [chiOpen, setChiOpen] = useState(false)
  const [resultStage, setResultStage] = useState(0)
  const [flipDone, setFlipDone] = useState(false)
  const [busy, setBusy] = useState(false)
  const [added, setAdded] = useState<string[]>([])
  const [now, setNow] = useState(Date.now())
  const drag = useRef<{ tile: number; x: number; y: number } | null>(null)
  const { rotated } = useStage()
  const practice = table.mode === 'practice'
  const playing = table.phase === 'discard' || table.phase === 'claim' || table.phase === 'over'

  // 倒计时：用服务器时钟校准
  const clockOffset = useRef(0)
  useEffect(() => {
    clockOffset.current = table.serverNow - Date.now()
  }, [table.seq, table.serverNow])
  useEffect(() => {
    if (!table.deadlineAt) return
    const timer = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(timer)
  }, [table.deadlineAt])
  const remain = table.deadlineAt ? Math.max(0, Math.ceil((table.deadlineAt - (now + clockOffset.current)) / 1000)) : null
  const lastTick = useRef(0)
  useEffect(() => {
    if (remain !== null && remain > 0 && remain <= 5 && lastTick.current !== remain && table.actor === 0) {
      lastTick.current = remain
      sfx.tick()
    }
  }, [remain]) // eslint-disable-line react-hooks/exhaustive-deps

  const hall = hallById(table.hallId)
  const me = table.seats[0]
  const myMove = table.actor === 0
  const canDiscard = table.phase === 'discard' && myMove
  const myClaim = table.phase === 'claim' && myMove
  const shown = table.shown

  // ------------------------------ 事件 → 音效、语音、演出 ------------------------------
  const lastSeq = useRef(0)
  useEffect(() => {
    if (table.seq === lastSeq.current) return
    lastSeq.current = table.seq
    setBusy(false)
    setChiOpen(false)
    const event = table.lastEvent
    if (!event) return
    const show = (seat: number, text: string) => setBurst({ seat, text, key: table.seq })
    switch (event.t) {
      case 'open':
        sfx.flip()
        break
      case 'draw':
        sfx.tileDraw()
        voice.say(lhName(lhKind(event.tile)))
        break
      case 'discard':
        sfx.tileDiscard()
        voice.say(lhName(lhKind(event.tile)))
        break
      case 'drop':
        sfx.tileDiscard()
        break
      case 'chi':
        sfx.tileMeld(3)
        voice.say('吃', { urgent: true, rate: 1 })
        show(event.seat, '吃')
        break
      case 'meld': {
        const text = event.again ? '重跑' : GROUP_NAME[event.type]
        sfx.tileMeld(event.type === 'ti' || event.type === 'pao' ? 4 : 3)
        voice.say(text, { urgent: true, rate: 1 })
        show(event.seat, text)
        break
      }
      case 'hu': {
        const text = table.result?.kind === 'zimo' ? '自摸' : '胡'
        sfx.mahjongWin()
        voice.say(table.result?.kind === 'zimo' ? '自摸' : '胡了', { urgent: true, rate: 0.95 })
        show(event.seat, text)
        break
      }
      case 'drawn-game':
        sfx.lose()
        voice.say('荒庄', { urgent: true, rate: 1 })
        break
      default:
        break
    }
  }, [table.seq]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (table.phase !== 'flip' && table.phase !== 'waiting') sfx.tileShuffle()
    setSelected(null)
    setResultStage(0)
  }, [table.handNo]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (table.phase !== 'flip') return
    setFlipDone(false)
    sfx.flip()
    const timer = window.setTimeout(() => { setFlipDone(true); sfx.pop() }, 1500)
    return () => window.clearTimeout(timer)
  }, [table.phase])

  useEffect(() => {
    if (!burst) return
    const timer = window.setTimeout(() => setBurst(null), 1500)
    return () => window.clearTimeout(timer)
  }, [burst])

  // 结算演出：亮牌 → 算胡数 → 算分
  useEffect(() => {
    if (table.phase !== 'over') return
    const won = Boolean(table.result && table.result.winner >= 0)
    const timers = [
      window.setTimeout(() => setResultStage(1), won ? 1500 : 900),
      window.setTimeout(() => { setResultStage(2); if (won) sfx.pop() }, 2400),
      window.setTimeout(() => { setResultStage(3); sfx.coins() }, 3300),
    ]
    return () => timers.forEach((timer) => window.clearTimeout(timer))
  }, [table.phase, table.handNo]) // eslint-disable-line react-hooks/exhaustive-deps

  // ------------------------------ 手牌、听牌与教练 ------------------------------
  const columns = useMemo(() => arrangeHand(table.hand), [table.hand])
  const waiting = useMemo(() => {
    if (!playing || table.phase === 'over' || canDiscard || table.hand.length === 0) return null
    return waitsOf(me.melds, table.hand)
  }, [table.seq]) // eslint-disable-line react-hooks/exhaustive-deps
  /** 教练：每张能打的牌打出去之后，听几种牌 */
  const advice = useMemo(() => {
    if (!canDiscard || !coach || !practice) return null
    const byKind = new Map<number, number>()
    for (const tile of table.choices.discards) {
      const kind = lhKind(tile)
      if (byKind.has(kind)) continue
      byKind.set(kind, waitsOf(me.melds, table.hand.filter((item) => item !== tile)).length)
    }
    const best = Math.max(0, ...byKind.values())
    return { byKind, best }
  }, [table.seq, canDiscard, coach, practice]) // eslint-disable-line react-hooks/exhaustive-deps

  // ------------------------------ 操作 ------------------------------
  const act = async (action: LhAction) => {
    if (busy) return
    setBusy(true)
    setSelected(null)
    setChiOpen(false)
    const ok = await send({ op: 'lh:act', action })
    if (!ok) setBusy(false)
  }
  const discard = (tile: number) => {
    if (!canDiscard) return
    if (!table.choices.discards.includes(tile)) return toast('起手的坎不能拆着打', 'error')
    void act({ type: 'discard', tile })
  }
  const onTileDown = (event: PointerEvent, tile: number) => {
    if (!canDiscard) return
    drag.current = { tile, x: event.clientX, y: event.clientY }
  }
  const onTileUp = (event: PointerEvent, tile: number) => {
    if (!canDiscard) return
    const start = drag.current
    drag.current = null
    if (start && start.tile === tile && stageUp(rotated, event.clientX - start.x, event.clientY - start.y) > 40) return discard(tile)
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
    await send({ op: 'lh:leave' })
  }
  const chi = () => {
    if (table.choices.chi.length === 1) return void act({ type: 'chi', option: 0 })
    sfx.click()
    setChiOpen((open) => !open)
  }

  const result = table.result
  const winner = result && result.winner >= 0 ? table.seats[result.winner] : null
  const flipTiles = useMemo(() => {
    const tiles = new Map<number, number>()
    for (const round of table.flip ?? []) round.seats.forEach((seat, index) => tiles.set(seat, round.tiles[index]))
    return tiles
  }, [table.flip])
  const sign = (value: number) => (value > 0 ? `+${value}` : `${value}`)

  return (
    <div className={`scene lh-scene ${user.felt ? `felt-${user.felt}` : ''}`}>
      {/* ------------------------------ 顶栏 ------------------------------ */}
      <header className="table-top">
        <div className="table-top-left">
          <Button kind="ghost" size="sm" onClick={() => (table.phase === 'discard' || table.phase === 'claim' ? setModal('leave') : void leave())}>‹ 离开</Button>
          <div className="table-hall">
            <b className="gold-text">六胡抢</b>
            <span>{hall?.name} · 每分 <Coins value={table.stake} size={15} /></span>
            <span className="muted">{practice ? `第 ${table.handNo} 局 · ${LH_LEVEL_NAME[table.level]}试炼` : table.phase === 'waiting' ? `房号 ${table.roomId}` : `第 ${table.handNo} 局 · 房号 ${table.roomId}`}</span>
          </div>
        </div>
        <div className="table-top-right">
          {practice && <button type="button" className={`mj-switch ${coach ? 'on' : ''}`} onClick={toggleCoach} title="打牌时提示每张牌打出去之后听几种牌">教练提示</button>}
          <button type="button" className={`mj-switch ${voiceOn ? 'on' : ''}`} title="语音报牌" onClick={() => { voice.setOn(!voiceOn); setVoiceOn(!voiceOn); sfx.click() }}>语音</button>
          <Button kind="ghost" size="sm" onClick={() => setModal('rules')}>规则</Button>
          <MusicToggle />
          <SoundToggle />
        </div>
      </header>

      {/* ------------------------------ 立体牌桌 ------------------------------ */}
      <div className="lh-cam">
        <div className="lh-plane">
          <div className="lh-felt"><i>常宁 · 六胡抢</i></div>
          {playing && (
            <>
              <div className={`lh-deck ${table.wallCount === 0 ? 'empty' : ''}`} style={{ ['--layers' as string]: Math.min(10, Math.ceil(table.wallCount / 3)) }}>
                <Zi kind={-1} className="xl" />
                <b className="num">{table.wallCount}</b>
                <small>墩</small>
              </div>
              {table.seats.slice(1).map((seat) => (
                <div key={seat.seat} className={`lh-zone lh-zone-${SIDES[seat.seat]}`}>
                  <div className={`lh-fan ${seat.hand ? 'open' : ''}`}>
                    {seat.hand
                      ? arrangeHand(seat.hand).flat().map((tile) => <Zi key={tile} kind={lhKind(tile)} className="s" />)
                      : Array.from({ length: seat.handCount }, (_, index) => <Zi key={index} kind={-1} className="s" />)}
                  </div>
                  <div className="lh-melds">{seat.melds.map((meld, index) => <MeldColumn key={index} meld={meld} size="s" />)}</div>
                  <div className="lh-pile">{seat.discards.map((tile) => <Zi key={tile} kind={lhKind(tile)} className="s" />)}</div>
                </div>
              ))}
              <div className="lh-pile lh-pile-me">{me.discards.map((tile) => <Zi key={tile} kind={lhKind(tile)} className="s" />)}</div>
              {shown && table.phase === 'claim' && (
                <div key={shown.tile} className={`lh-shown from-${SIDES[shown.from]} ${shown.source}`}>
                  <Zi kind={lhKind(shown.tile)} className="xl" />
                  <em>{shown.source === 'open' ? `${WHO[shown.from]}的挡底` : `${WHO[shown.from]}${shown.source === 'draw' ? '摸出' : '打出'}`}</em>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* ------------------------------ 头像 ------------------------------ */}
      {playing && table.seats.map((seat) => {
        const side = SIDES[seat.seat]
        const active = table.phase !== 'over' && table.actor === seat.seat
        return (
          <div key={seat.seat} className={`lh-seat lh-seat-${side} ${active ? 'active' : ''}`}>
            <div className="mj-player">
              <Avatar index={seat.avatar} size={side === 'bottom' ? 60 : 52} frame={seat.frame} dim={seat.trustee} />
              {active && remain !== null && <i className={`mj-clock num ${remain <= 5 ? 'urgent' : ''}`}>{remain}</i>}
              {seat.trustee && <i className="mj-trustee">托管</i>}
              <div className="mj-player-info">
                <b>{seat.name}</b>
                <small>{seat.seat === 0 ? `${formatCoins(user.coins)} 金币 · 亮 ${seat.hu} 胡` : `${seat.isBot ? LH_LEVEL_NAME[table.level] : seat.trustee ? '托管' : '玩家'} · ${seat.handCount} 张 · 亮 ${seat.hu} 胡`}</small>
              </div>
              {table.dealer === seat.seat && <i className="mj-dealer">庄</i>}
            </div>
            {burst?.seat === seat.seat && <div key={burst.key} className={`mj-burst ${burst.text.length > 1 ? 'wide' : ''}`}>{burst.text}</div>}
          </div>
        )
      })}

      {/* ------------------------------ 我的门子与手牌 ------------------------------ */}
      {playing && !(table.phase === 'over' && resultStage >= 1) && (
        <div className={`lh-hand ${canDiscard ? 'live' : ''}`}>
          {me.melds.length > 0 && <div className="lh-my-melds">{me.melds.map((meld, index) => <MeldColumn key={index} meld={meld} size="m" />)}</div>}
          <div className="lh-columns">
            {columns.map((column) => (
              <div key={column[0]} className="lh-column">
                {column.map((tile) => {
                  const kind = lhKind(tile)
                  const blocked = canDiscard && !table.choices.discards.includes(tile)
                  const waits = advice?.byKind.get(kind) ?? 0
                  const best = Boolean(advice && advice.best > 0 && waits === advice.best && !blocked)
                  return (
                    <button
                      key={tile}
                      type="button"
                      className={`lh-card ${selected === tile ? 'selected' : ''} ${blocked ? 'blocked' : ''} ${best ? 'best' : ''}`}
                      onPointerDown={(event) => onTileDown(event, tile)}
                      onPointerUp={(event) => onTileUp(event, tile)}
                      onDoubleClick={() => discard(tile)}
                    >
                      <Zi kind={kind} className="h" />
                      {advice && waits > 0 && !blocked && <span className={`lh-tip ${best ? 'best' : ''}`}>听{waits}</span>}
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ------------------------------ 提示条 ------------------------------ */}
      {playing && table.phase !== 'over' && (
        <div className="lh-status">
          {canDiscard && <b>轮到你打牌{selected !== null ? ' · 再点一下打出' : ' · 点牌选中，再点打出（或往上甩）'}</b>}
          {myClaim && <b>{table.choices.hu ? '可以胡了！' : table.choices.peng ? '要不要碰？放过就成臭牌' : '要不要吃？放过就成臭牌'}</b>}
          {!myMove && table.actor >= 0 && <span>等 {table.seats[table.actor].name} {table.phase === 'discard' ? '打牌' : '表态'}…</span>}
          {waiting && waiting.length > 0 && (
            <span className="lh-waits">听 {waiting.map((kind) => <Zi key={kind} kind={kind} className="s" />)}</span>
          )}
        </div>
      )}

      {/* ------------------------------ 操作按钮 ------------------------------ */}
      {myClaim && (
        <div className="mj-actions lh-actions">
          {table.choices.hu && <button type="button" className="mj-act hu" onClick={() => void act({ type: 'hu' })}>胡</button>}
          {table.choices.peng && <button type="button" className="mj-act pung" onClick={() => void act({ type: 'peng' })}>碰</button>}
          {table.choices.chi.length > 0 && <button type="button" className="mj-act chi" onClick={chi}>吃</button>}
          {table.choices.pass && <button type="button" className="mj-act pass" onClick={() => void act({ type: 'pass' })}>过</button>}
        </div>
      )}
      {myClaim && chiOpen && (
        <div className="lh-chi">
          <b>选一种吃法{table.choices.chi.some((option) => option.groups.length > 1) ? '（多出来的是下伙）' : ''}</b>
          <div>
            {table.choices.chi.map((option, index) => (
              <button key={index} type="button" onClick={() => void act({ type: 'chi', option: index })}>
                {option.groups.map((group, at) => (
                  <span key={at} className="lh-meld">{group.map((kind, i) => <Zi key={i} kind={kind} className="m" />)}</span>
                ))}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ------------------------------ 等人入座 ------------------------------ */}
      {table.phase === 'waiting' && (
        <div className={`waiting mj-waiting ${table.matching ? 'matching' : ''}`}>
          <div className="waiting-hall gold-text">六胡抢 · {hall?.name}</div>
          {table.matching ? (
            <div className="match-radar"><i /><i /><i /><b className="num">{remain ?? ''}</b></div>
          ) : (
            <button
              type="button"
              className="waiting-code"
              title="点击复制房号"
              onClick={() => void navigator.clipboard.writeText(table.roomId).then(() => toast('房号已复制，发给朋友就能加入', 'gold')).catch(() => toast(`房号：${table.roomId}`))}
            >
              <small>房号</small>
              <b className="num">{table.roomId}</b>
              <em>复制</em>
            </button>
          )}
          <div className="mj-waiting-seats">
            {table.seats.map((seat) => (
              <div key={seat.seat} className={`mj-waiting-seat ${seat.empty ? 'empty' : ''}`}>
                {seat.empty ? <span className="vacant-ring">空位</span> : <Avatar index={seat.avatar} size={64} frame={seat.frame} />}
                <b>{seat.empty ? '等人入座' : seat.name}</b>
                {!seat.empty && table.hostSeat === seat.seat && !table.matching && <i className="seat-host">房主</i>}
              </div>
            ))}
          </div>
          <div className="waiting-meta">每分 <Coins value={table.stake} size={16} /> <span>·</span> {table.matching ? '凑齐四人立即开局，等不到就由机器人补位' : table.isPrivate ? '私密牌桌，凭房号加入' : '公开牌桌，大厅可见'}</div>
          {!table.matching && (
            <div className="waiting-actions">
              <Button
                kind="ghost"
                size="md"
                onClick={() => void navigator.clipboard.writeText(`${location.origin}/?room=${table.roomId}`).then(() => toast('邀请链接已复制，朋友打开就能入座', 'gold')).catch(() => toast(`房号：${table.roomId}`))}
              >复制邀请链接</Button>
              {table.hostSeat === 0
                ? <Button kind="gold" size="lg" onClick={() => void send({ op: 'lh:begin' })}>{table.seats.some((seat) => seat.empty) ? '开始（空位补机器人）' : '开始'}</Button>
                : <div className="waiting-hint">等房主开始…</div>}
            </div>
          )}
        </div>
      )}

      {/* ------------------------------ 翻牌定庄 ------------------------------ */}
      {table.phase === 'flip' && (
        <div className="lh-flip">
          <h2 className="gold-text">翻牌定庄</h2>
          <div className="lh-flip-seats">
            {table.seats.map((seat) => (
              <div key={seat.seat} className={`lh-flip-seat ${flipDone && seat.seat === table.dealer ? 'dealer' : ''}`} style={{ animationDelay: `${seat.seat * 0.12}s` }}>
                <Zi kind={flipTiles.has(seat.seat) ? lhKind(flipTiles.get(seat.seat) as number) : -1} className="xl" />
                <Avatar index={seat.avatar} size={48} frame={seat.frame} />
                <b>{seat.name}</b>
              </div>
            ))}
          </div>
          <p>{flipDone ? `${table.seats[table.dealer].name} 点数最大，坐庄` : '每人翻一张，点数最大的坐庄'}</p>
        </div>
      )}

      {/* ------------------------------ 结算 ------------------------------ */}
      {table.phase === 'over' && result && resultStage >= 1 && (
        <div className={`mj-result-mask ${result.winner === 0 ? 'is-win' : ''}`}>
          {result.winner === 0 && <div className="result-rays" />}
          <div className="mj-result lh-result">
            <h2 className={`mj-result-title ${result.winner < 0 ? 'draw' : ''}`}>
              {Array.from(result.winner < 0 ? '荒庄' : result.winner === 0 ? (result.kind === 'zimo' ? '自摸胡牌' : '胡牌') : `${winner!.name} ${KIND_TITLE[result.kind]}`).map((char, index) => (
                <span key={index} style={{ animationDelay: `${index * 0.09}s` }}>{char}</span>
              ))}
            </h2>

            {winner && (
              <div className="lh-result-top">
                <div className="lh-result-groups">
                  {result.groups.map((group, index) => (
                    <span key={index} className={`lh-result-group ${group.hu > 0 ? 'scored' : ''}`} style={{ animationDelay: `${index * 0.08}s` }}>
                      <span className="lh-meld">{group.kinds.map((kind, i) => <Zi key={i} kind={kind} className="m" />)}</span>
                      <small>{GROUP_NAME[group.type]}</small>
                      <b className="num">{group.hu}</b>
                    </span>
                  ))}
                </div>
                <div className={`mj-bird-math lh-math ${resultStage >= 2 ? 'on' : ''}`}>
                  <span><b className="num">{result.hu}</b><small>胡</small></span>
                  <i>×</i>
                  <span className={result.redName === '平胡' ? '' : 'sha'}><b className="num">{result.mult / (result.kind === 'zimo' ? 2 : 1)}</b><small>{result.redName} · 红 {result.reds} 张</small></span>
                  {result.kind === 'zimo' && <><i>×</i><span className="sha"><b className="num">2</b><small>自摸</small></span></>}
                  <i>=</i>
                  <span className="total"><b className="num">{result.share}</b><small>分 / 份</small></span>
                </div>
              </div>
            )}
            {winner && resultStage >= 2 && (
              <p className="mj-result-note">
                胡的是 {lhName(lhKind(result.tile))}。
                {result.kind === 'zimo' && '自摸：三家各付一份。'}
                {result.kind === 'pao' && `${table.seats[result.loser].name} 放炮，一个人付三份。`}
                {result.kind === 'gong' && '胡的是别人摸出来的牌（或挡底）：三家各付一份，不翻倍。'}
              </p>
            )}
            {!winner && <p className="mj-result-note">墩上的牌摸完了没人胡，庄家连庄，无人付分。</p>}

            {resultStage >= 3 && (
              <table className="mj-score">
                <thead>
                  <tr><th /><th>本局</th><th>本桌累计</th></tr>
                </thead>
                <tbody>
                  {table.seats.map((seat) => (
                    <tr key={seat.seat} className={`${seat.seat === 0 ? 'me' : ''} ${seat.seat === result.winner ? 'winner' : ''}`}>
                      <td>
                        <Avatar index={seat.avatar} size={30} ring={false} /> {seat.name}{table.dealer === seat.seat && <i className="mj-dealer">庄</i>}
                        {seat.seat === result.loser && <em className="lh-pao">放炮</em>}
                        {!practice && seat.ready && !seat.isBot && <em className="mj-ready">已准备</em>}
                        {seat.seat !== 0 && seat.userId && !added.includes(seat.userId) && (
                          <button
                            type="button"
                            className="mj-add-friend"
                            onClick={() => void api('/friends/add', { userId: seat.userId }).then(() => { setAdded((list) => [...list, seat.userId]); toast('已加为好友', 'gold') }).catch((error) => toast((error as Error).message, 'error'))}
                          >+ 好友</button>
                        )}
                      </td>
                      <td className={`big ${seat.score > 0 ? 'up' : seat.score < 0 ? 'down' : ''}`}>{sign(seat.score)}</td>
                      <td className={seat.total > 0 ? 'up' : seat.total < 0 ? 'down' : ''}>{sign(seat.total)}</td>
                    </tr>
                  ))}
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
                  <Button kind="gold" size="lg" disabled={me.ready} onClick={() => void send({ op: 'lh:next' })}>{me.ready ? '等其他人准备…' : '下一局'}</Button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {modal === 'rules' && <LiuhuRules onClose={() => setModal(null)} />}
      {modal === 'leave' && (
        <Modal title="离开牌桌" onClose={() => setModal(null)} width={520}>
          <p className="modal-lead">{practice
            ? <>这一局还没打完。现在离开，这一局不计输赢。</>
            : <>这一局还没打完。现在离开，你的座位会由机器人替你打完，<br />这一局的输赢照常算在你头上。</>}</p>
          <div className="modal-actions">
            <Button kind="ghost" size="md" onClick={() => void leave()}>仍要离开</Button>
            <Button kind="gold" size="md" onClick={() => setModal(null)}>继续打</Button>
          </div>
        </Modal>
      )}
    </div>
  )
}
