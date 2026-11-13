// 红中麻将牌桌：人机试炼（1 名真人 + 3 个机器人），服务端权威。
import { randomUUID } from 'node:crypto'
import { AVATARS, Hall, formatCoins, hallById } from '../shared/economy.ts'
import {
  DEFAULT_OPTIONS, DiceRound, MjAction, MjEvent, MjOptions, MjState, SEATS, applyAction, choicesFor, dealGame, rollForDealer,
} from '../shared/mahjong/game.ts'
import { kindName, kindOf } from '../shared/mahjong/tiles.ts'
import { MJ_LEVELS, MJ_LEVEL_NAME, MjLevel, MjSeatView, MjSettlement, MjView } from '../shared/mahjong/view.ts'
import type { ServerEvent } from '../shared/protocol.ts'
import { Accounts, AppError } from './accounts.ts'
import { botAction } from './mjBot.ts'

interface MjHub {
  send(userId: string, event: ServerEvent): void
  isOnline(userId: string): boolean
}

export interface MjTimings {
  /** 掷骰动画：首轮时长 + 每多一轮追加的时长 */
  diceMs: number
  diceExtraMs: number
  botMinMs: number
  botMaxMs: number
  claimMs: number
  idleMs: number
}

export const MJ_TIMINGS: MjTimings = { diceMs: 5200, diceExtraMs: 2600, botMinMs: 650, botMaxMs: 1250, claimMs: 550, idleMs: 20 * 60 * 1000 }

interface Table {
  userId: string
  hall: Hall
  level: MjLevel
  options: MjOptions
  seats: { name: string; avatar: number; frame: string; isBot: boolean }[]
  handNo: number
  dealer: number
  dice: DiceRound[] | null
  state: MjState | null
  totals: number[]
  settlement: MjSettlement | null
  settled: boolean
  seq: number
  timer: NodeJS.Timeout | null
  idleTimer: NodeJS.Timeout | null
}

const BOT_NAMES = ['牌桌老江湖', '清一色阿姨', '杠上开花哥', '自摸小王子', '听牌专业户', '碰碰胡大叔', '红中收藏家', '海底捞月姐', '稳如泰山伯', '快手三哥']

export class MahjongManager {
  private tables = new Map<string, Table>()
  /** 所有操作排队串行，避免数据库读写期间状态被并发修改 */
  private queue: Promise<unknown> = Promise.resolve()

  constructor(
    private accounts: Accounts,
    private hub: MjHub,
    private timings: MjTimings = MJ_TIMINGS,
    private random: () => number = Math.random,
  ) {}

  private run<T>(task: () => Promise<T> | T): Promise<T> {
    const result = this.queue.then(task)
    this.queue = result.catch(() => {})
    return result
  }

  has(userId: string): boolean {
    return this.tables.has(userId)
  }

  get tableCount(): number {
    return this.tables.size
  }

  // ------------------------------ 对外操作 ------------------------------

  start(userId: string, hallId: string, level: MjLevel, options: Partial<MjOptions> | undefined): Promise<void> {
    return this.run(async () => {
      if (!MJ_LEVELS.includes(level)) throw new AppError('难度无效')
      const hall = hallById(hallId)
      if (!hall) throw new AppError('场次不存在')
      const user = await this.accounts.requireUser(userId)
      if (user.coins < hall.minCoins) throw new AppError(`金币不足：进入${hall.name}至少需要 ${formatCoins(hall.minCoins)} 金币`)
      const existing = this.tables.get(userId)
      if (existing) await this.close(existing, true)

      const names = [...BOT_NAMES].sort(() => this.random() - 0.5).slice(0, 3)
      const table: Table = {
        userId,
        hall,
        level,
        options: {
          sevenPairs: options?.sevenPairs ?? DEFAULT_OPTIONS.sevenPairs,
          fourZhong: options?.fourZhong ?? DEFAULT_OPTIONS.fourZhong,
          zhongDiscard: options?.zhongDiscard ?? DEFAULT_OPTIONS.zhongDiscard,
        },
        seats: [
          { name: user.nickname, avatar: user.avatar, frame: user.frame || '', isBot: false },
          ...names.map((name) => ({ name, avatar: Math.floor(this.random() * AVATARS.length), frame: '', isBot: true })),
        ],
        handNo: 1,
        dealer: 0,
        dice: null,
        state: null,
        totals: [0, 0, 0, 0],
        settlement: null,
        settled: false,
        seq: 0,
        timer: null,
        idleTimer: null,
      }
      this.tables.set(userId, table)
      // 首局掷骰定庄：四人各掷两颗骰子，点数最大者坐庄
      const { rounds, dealer } = rollForDealer(this.random)
      table.dice = rounds
      table.dealer = dealer
      this.push(table, null)
      this.touch(table)
      this.schedule(table, this.timings.diceMs + (rounds.length - 1) * this.timings.diceExtraMs, () => this.deal(table))
    })
  }

  act(userId: string, action: MjAction): Promise<void> {
    return this.run(async () => {
      const table = this.tables.get(userId)
      const state = table?.state
      if (!table || !state || state.phase === 'over') throw new AppError('当前没有进行中的牌局')
      const actor = state.phase === 'claim' ? state.claim?.seat : state.turn
      if (actor !== 0) throw new AppError('还没轮到你')
      this.touch(table)
      await this.apply(table, 0, action)
    })
  }

  next(userId: string): Promise<void> {
    return this.run(async () => {
      const table = this.tables.get(userId)
      if (!table || !table.state || table.state.phase !== 'over') throw new AppError('这一局还没有结束')
      const user = await this.accounts.requireUser(userId)
      if (user.coins < table.hall.minCoins) {
        throw new AppError(`金币不足：${table.hall.name}至少需要 ${formatCoins(table.hall.minCoins)} 金币`)
      }
      // 赢家坐庄；流局庄家连庄
      table.dealer = table.state.result?.nextDealer ?? table.dealer
      table.handNo += 1
      table.dice = null
      this.touch(table)
      this.deal(table)
    })
  }

  leave(userId: string): Promise<void> {
    return this.run(async () => {
      const table = this.tables.get(userId)
      if (table) await this.close(table, true)
      this.hub.send(userId, { ev: 'mj', table: null })
    })
  }

  /** 用户重新连上：把牌桌现状推给他 */
  onConnect(userId: string): void {
    const table = this.tables.get(userId)
    this.hub.send(userId, { ev: 'mj', table: table ? this.view(table, null) : null })
  }

  shutdown(): void {
    for (const table of this.tables.values()) {
      if (table.timer) clearTimeout(table.timer)
      if (table.idleTimer) clearTimeout(table.idleTimer)
    }
  }

  // ------------------------------ 牌局流程 ------------------------------

  private schedule(table: Table, ms: number, fn: () => void | Promise<void>): void {
    if (table.timer) clearTimeout(table.timer)
    table.timer = setTimeout(() => {
      table.timer = null
      void this.run(async () => {
        if (this.tables.get(table.userId) !== table) return
        try {
          await fn()
        } catch (error) {
          console.error('[mahjong]', error)
        }
      })
    }, ms)
  }

  /** 长时间没有操作：结算当前分数并收桌 */
  private touch(table: Table): void {
    if (table.idleTimer) clearTimeout(table.idleTimer)
    table.idleTimer = setTimeout(() => {
      void this.run(async () => {
        if (this.tables.get(table.userId) !== table) return
        await this.close(table, true)
        this.hub.send(table.userId, { ev: 'mj', table: null })
      })
    }, this.timings.idleMs)
    table.idleTimer.unref?.()
  }

  private deal(table: Table): void {
    table.state = dealGame(table.dealer, table.options, this.random)
    table.settlement = null
    table.settled = false
    this.push(table, table.state.events[0] ?? null)
    this.advance(table)
  }

  /** 轮到机器人就安排它出手；轮到真人就等 */
  private advance(table: Table): void {
    const state = table.state
    if (!state || state.phase === 'over') return
    const actor = state.phase === 'claim' ? (state.claim?.seat ?? 0) : state.turn
    if (actor === 0) return
    const { botMinMs, botMaxMs, claimMs } = this.timings
    const delay = state.phase === 'claim' ? claimMs : botMinMs + this.random() * (botMaxMs - botMinMs)
    this.schedule(table, delay, async () => {
      if (table.state !== state || state.phase === 'over') return
      await this.apply(table, actor, botAction(state, actor, table.level, this.random))
    })
  }

  private async apply(table: Table, seat: number, action: MjAction): Promise<void> {
    const state = table.state as MjState
    const before = state.events.length
    try {
      applyAction(state, seat, action)
    } catch (error) {
      throw new AppError((error as Error).message)
    }
    // 一次操作可能连带产生多个事件（如打牌后下家摸牌），逐个推送，客户端按序播放
    const events = state.events.slice(before)
    if (state.phase === 'over') {
      await this.settle(table)
      this.push(table, events[events.length - 1] ?? null)
      return
    }
    this.push(table, this.headline(events))
    this.advance(table)
  }

  /** 这次操作里最值得客户端演出的那个事件 */
  private headline(events: MjEvent[]): MjEvent | null {
    return events.find((event) => event.t !== 'draw' && event.t !== 'pass') ?? events[events.length - 1] ?? null
  }

  private summary(table: Table): string {
    const state = table.state as MjState
    const result = state.result
    if (!result || result.winner < 0) return '流局'
    const who = result.winner === 0 ? '自摸' : `${table.seats[result.winner].name}自摸`
    return `${who}${result.shaGui ? ' · 杀鬼' : ''} · 鸟 ${kindName(kindOf(result.bird))} ${result.perPlayer}分/家`
  }

  /** 一局结束（或中途离开）：按当前分数结算金币，写入战绩 */
  private async settle(table: Table): Promise<void> {
    const state = table.state
    if (!state || table.settled) return
    table.settled = true
    const scores = state.players.map((player) => player.score)
    scores.forEach((score, seat) => { table.totals[seat] += score })
    const matchId = randomUUID()
    const finished = state.phase === 'over'
    try {
      const entries = await this.accounts.settleMatch(
        table.hall,
        table.seats.map((seat, index) => ({
          seat: index,
          userId: index === 0 ? table.userId : `mjbot-${index}`,
          nickname: seat.name,
          avatar: seat.avatar,
          isBot: seat.isBot,
          total: scores[index],
          caught: 0,
          leopards: 0,
        })),
        [],
        {
          matchId,
          game: 'mahjong',
          label: '红中麻将',
          summary: finished ? this.summary(table) : '中途离桌',
          record: {
            init: state.init, events: state.events, options: table.options,
            names: table.seats.map((seat) => seat.name), level: table.level,
          },
        },
      )
      const mine = entries.find((entry) => entry.seat === 0)
      table.settlement = mine ? { matchId, coinsDelta: mine.coinsDelta, honorDelta: mine.honorDelta, expGain: mine.expGain } : null
      this.hub.send(table.userId, { ev: 'me', user: await this.accounts.profile(table.userId) })
    } catch (error) {
      console.error('[mahjong] 结算失败', error)
    }
  }

  private async close(table: Table, settlePartial: boolean): Promise<void> {
    if (table.timer) clearTimeout(table.timer)
    if (table.idleTimer) clearTimeout(table.idleTimer)
    table.timer = null
    // 中途离开：已经当场结算的杠分照常入账
    if (settlePartial && table.state && table.state.phase !== 'over' && table.state.players.some((player) => player.score !== 0)) {
      await this.settle(table)
    }
    this.tables.delete(table.userId)
  }

  // ------------------------------ 视图 ------------------------------

  private push(table: Table, event: MjEvent | null): void {
    table.seq += 1
    this.hub.send(table.userId, { ev: 'mj', table: this.view(table, event) })
  }

  private view(table: Table, event: MjEvent | null): MjView {
    const state = table.state
    const over = state?.phase === 'over'
    const seats: MjSeatView[] = table.seats.map((seat, index) => {
      const player = state?.players[index]
      return {
        seat: index,
        name: seat.name,
        avatar: seat.avatar,
        frame: seat.frame,
        isBot: seat.isBot,
        handCount: player?.hand.length ?? 0,
        hand: over && player ? player.hand : null,
        // 别人的暗杠对局中不亮牌
        melds: (player?.melds ?? []).map((meld) => (meld.type === 'ankan' && index !== 0 && !over ? { ...meld, kind: -1, tiles: meld.tiles.map(() => -1) } : meld)),
        discards: player?.discards ?? [],
        score: player?.score ?? 0,
        total: table.totals[index] + (table.settled ? 0 : player?.score ?? 0),
      }
    })
    // 别人摸到什么牌不能让客户端知道
    const safeEvent = event && event.t === 'draw' && event.seat !== 0 ? { ...event, tile: -1 } : event
    return {
      hallId: table.hall.id,
      stake: table.hall.stake,
      level: table.level,
      options: table.options,
      handNo: table.handNo,
      phase: state ? state.phase : 'dice',
      dice: table.dice,
      dealer: table.dealer,
      turn: state?.turn ?? table.dealer,
      wallCount: state?.wall.length ?? 0,
      hand: state?.players[0].hand ?? [],
      drawn: state && state.turn === 0 ? state.drawn : null,
      choices: state ? choicesFor(state, 0) : { discards: [], hu: false, ankan: [], bukan: [], pung: false, kong: false, pass: false },
      seats,
      lastDiscard: state?.lastDiscard ?? null,
      claimSeat: state?.phase === 'claim' ? (state.claim?.seat ?? -1) : -1,
      kongs: state?.kongs ?? [],
      result: state?.result ?? null,
      settlement: table.settlement,
      seq: table.seq,
      lastEvent: safeEvent,
      record: over && state
        ? { init: state.init, events: state.events, options: table.options, names: table.seats.map((seat) => seat.name), level: table.level }
        : null,
    }
  }
}

export { MJ_LEVEL_NAME, SEATS }
