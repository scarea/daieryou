// 红中麻将牌桌服务：房间制，支持人机试炼、好友约局、快速匹配。服务端权威。
// 每位玩家拿到的视图都换算成"以自己为 0 号位"，客户端不用关心绝对座位。
import { randomUUID } from 'node:crypto'
import { AVATARS, Hall, formatCoins, hallById } from '../shared/economy.ts'
import {
  DEFAULT_OPTIONS, DiceRound, Meld, MjAction, MjEvent, MjOptions, MjState, SEATS, applyAction, choicesFor, dealGame, rollForDealer,
} from '../shared/mahjong/game.ts'
import { kindName, kindOf } from '../shared/mahjong/tiles.ts'
import { MJ_LEVELS, MjLevel, MjRecord, MjSeatView, MjSettlement, MjView } from '../shared/mahjong/view.ts'
import type { LobbyRoom, RoomStatus, ServerEvent } from '../shared/protocol.ts'
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
  /** 真人房间里：出牌 / 碰杠的思考时限 */
  turnMs: number
  claimTurnMs: number
  /** 掉线的人多久之后由机器人代打 */
  offlineMs: number
  /** 快速匹配等真人的时间 */
  matchMs: number
  idleMs: number
}

export const MJ_TIMINGS: MjTimings = {
  diceMs: 5200, diceExtraMs: 2600, botMinMs: 650, botMaxMs: 1250, claimMs: 550,
  turnMs: 20000, claimTurnMs: 10000, offlineMs: 3500, matchMs: 12000, idleMs: 20 * 60 * 1000,
}

interface Seat {
  userId: string
  name: string
  avatar: number
  frame: string
  isBot: boolean
  /** 真人中途离开：这一局由机器人代打，结算后变成机器人座位 */
  away: boolean
  ready: boolean
}

interface Table {
  id: string
  mode: 'practice' | 'room'
  isPrivate: boolean
  matching: boolean
  hall: Hall
  level: MjLevel
  options: MjOptions
  seats: (Seat | null)[]
  hostSeat: number
  phase: 'waiting' | 'dice' | 'playing'
  handNo: number
  dealer: number
  dice: DiceRound[] | null
  state: MjState | null
  totals: number[]
  settlements: Map<string, MjSettlement>
  settled: boolean
  seq: number
  deadlineAt: number | null
  timer: NodeJS.Timeout | null
  idleTimer: NodeJS.Timeout | null
}

const BOT_NAMES = ['牌桌老江湖', '清一色阿姨', '杠上开花哥', '自摸小王子', '听牌专业户', '碰碰胡大叔', '红中收藏家', '海底捞月姐', '稳如泰山伯', '快手三哥']
const NO_CHOICES = { discards: [], hu: false, ankan: [], bukan: [], pung: false, kong: false, pass: false }

export class MahjongManager {
  private tables = new Map<string, Table>()
  private userTable = new Map<string, string>()
  /** 所有操作排队串行，避免数据库读写期间状态被并发修改 */
  private queue: Promise<unknown> = Promise.resolve()
  /** 大厅列表有变化时通知应用层 */
  onLobbyChange: (() => void) | null = null
  /** 房号是否已被别的游戏占用 */
  idTaken: ((id: string) => boolean) | null = null

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

  // ------------------------------ 查询 ------------------------------

  has(userId: string): boolean {
    return this.userTable.has(userId)
  }

  hasRoom(roomId: string): boolean {
    return this.tables.has(roomId)
  }

  get tableCount(): number {
    return this.tables.size
  }

  private tableOf(userId: string): Table | undefined {
    const id = this.userTable.get(userId)
    return id ? this.tables.get(id) : undefined
  }

  private statusOf(table: Table): RoomStatus {
    return table.phase === 'waiting' ? 'waiting' : table.state?.phase === 'over' ? 'finished' : 'playing'
  }

  /** 公开的真人牌桌，显示在大厅列表里 */
  lobbyRooms(): LobbyRoom[] {
    const rooms: LobbyRoom[] = []
    for (const table of this.tables.values()) {
      if (table.mode !== 'room' || table.isPrivate || table.matching) continue
      const members = table.seats.filter(Boolean) as Seat[]
      if (!members.some((seat) => !seat.isBot)) continue
      rooms.push({
        id: table.id,
        game: 'mahjong',
        seats: SEATS,
        hallId: table.hall.id,
        stake: table.hall.stake,
        status: this.statusOf(table),
        hostName: table.seats[table.hostSeat]?.name ?? '',
        players: members.map((seat) => ({ nickname: seat.name, avatar: seat.avatar, isBot: seat.isBot })),
      })
    }
    return rooms
  }

  /** 好友列表用：某玩家所在的公开牌桌 */
  publicRoomOf(userId: string): { id: string; status: RoomStatus; joinable: boolean; game: 'mahjong' } | null {
    const table = this.tableOf(userId)
    if (!table || table.mode !== 'room' || table.isPrivate) return null
    return { id: table.id, status: this.statusOf(table), joinable: table.phase === 'waiting' && table.seats.some((seat) => seat === null), game: 'mahjong' }
  }

  // ------------------------------ 建桌 / 入座 ------------------------------

  private newId(): string {
    for (let attempt = 0; attempt < 80; attempt += 1) {
      // 9 开头的 6 位数：与逮二游的房号区间错开
      const id = String(900000 + Math.floor(this.random() * 100000))
      if (!this.tables.has(id) && !this.idTaken?.(id)) return id
    }
    throw new AppError('房号分配失败，请重试')
  }

  private async requireHall(hallId: string, userId: string): Promise<Hall> {
    const hall = hallById(hallId)
    if (!hall) throw new AppError('场次不存在')
    const user = await this.accounts.requireUser(userId)
    if (user.coins < hall.minCoins) throw new AppError(`金币不足：进入${hall.name}至少需要 ${formatCoins(hall.minCoins)} 金币`)
    return hall
  }

  private async humanSeat(userId: string): Promise<Seat> {
    const user = await this.accounts.requireUser(userId)
    return { userId, name: user.nickname, avatar: user.avatar, frame: user.frame || '', isBot: false, away: false, ready: false }
  }

  private botSeat(table: Table, index: number): Seat {
    const taken = new Set(table.seats.filter(Boolean).map((seat) => (seat as Seat).name))
    const names = BOT_NAMES.filter((name) => !taken.has(name))
    return {
      userId: `mjbot-${table.id}-${index}`,
      name: names[Math.floor(this.random() * names.length)] ?? `机器人${index}`,
      avatar: Math.floor(this.random() * AVATARS.length),
      frame: '',
      isBot: true,
      away: false,
      ready: true,
    }
  }

  private cleanOptions(options: Partial<MjOptions> | undefined): MjOptions {
    return {
      sevenPairs: options?.sevenPairs ?? DEFAULT_OPTIONS.sevenPairs,
      fourZhong: options?.fourZhong ?? DEFAULT_OPTIONS.fourZhong,
      zhongDiscard: options?.zhongDiscard ?? DEFAULT_OPTIONS.zhongDiscard,
    }
  }

  private async createTable(userId: string, hall: Hall, config: Pick<Table, 'mode' | 'isPrivate' | 'matching' | 'level' | 'options'>): Promise<Table> {
    const table: Table = {
      id: this.newId(),
      ...config,
      hall,
      seats: [await this.humanSeat(userId), null, null, null],
      hostSeat: 0,
      phase: 'waiting',
      handNo: 0,
      dealer: 0,
      dice: null,
      state: null,
      totals: [0, 0, 0, 0],
      settlements: new Map(),
      settled: false,
      seq: 0,
      deadlineAt: null,
      timer: null,
      idleTimer: null,
    }
    this.tables.set(table.id, table)
    this.userTable.set(userId, table.id)
    return table
  }

  /** 进新桌之前先离开原来的桌子 */
  private async release(userId: string): Promise<void> {
    if (this.userTable.has(userId)) await this.doLeave(userId)
  }

  /** 人机试炼：1 名真人 + 3 个机器人，立刻开局，不限时 */
  start(userId: string, hallId: string, level: MjLevel, options: Partial<MjOptions> | undefined): Promise<void> {
    return this.run(async () => {
      if (!MJ_LEVELS.includes(level)) throw new AppError('难度无效')
      const hall = await this.requireHall(hallId, userId)
      await this.release(userId)
      const table = await this.createTable(userId, hall, { mode: 'practice', isPrivate: true, matching: false, level, options: this.cleanOptions(options) })
      await this.begin(table)
    })
  }

  /** 好友约局：建一张桌子等人，房主点开始时空位由机器人补齐 */
  create(userId: string, hallId: string, isPrivate: boolean, level: MjLevel, options: Partial<MjOptions> | undefined): Promise<void> {
    return this.run(async () => {
      const hall = await this.requireHall(hallId, userId)
      await this.release(userId)
      const table = await this.createTable(userId, hall, {
        mode: 'room', isPrivate: Boolean(isPrivate), matching: false, level: MJ_LEVELS.includes(level) ? level : 'hard', options: this.cleanOptions(options),
      })
      this.touch(table)
      this.pushAll(table, null)
      this.onLobbyChange?.()
    })
  }

  /** 快速匹配：凑齐 4 名真人立即开局；等待超时由机器人补位 */
  match(userId: string, hallId: string): Promise<void> {
    return this.run(async () => {
      const hall = await this.requireHall(hallId, userId)
      await this.release(userId)
      let table = [...this.tables.values()].find(
        (item) => item.matching && item.phase === 'waiting' && item.hall.id === hall.id && item.seats.some((seat) => seat === null),
      )
      if (table) {
        const seat = await this.humanSeat(userId)
        const index = table.seats.findIndex((item) => item === null)
        if (!this.tables.has(table.id) || index === -1 || table.phase !== 'waiting') throw new AppError('匹配失败，请重试')
        table.seats[index] = seat
        this.userTable.set(userId, table.id)
      } else {
        table = await this.createTable(userId, hall, { mode: 'room', isPrivate: true, matching: true, level: 'hard', options: { ...DEFAULT_OPTIONS } })
        const created = table
        created.deadlineAt = Date.now() + this.timings.matchMs
        this.schedule(created, this.timings.matchMs, () => this.begin(created))
      }
      this.touch(table)
      if (table.seats.every((seat) => seat !== null)) await this.begin(table)
      else this.pushAll(table, null)
    })
  }

  join(userId: string, roomId: string): Promise<void> {
    return this.run(async () => {
      const table = this.tables.get(roomId)
      if (!table || table.mode !== 'room') throw new AppError('房间不存在或已解散')
      if (this.userTable.get(userId) === table.id) return this.pushAll(table, null)
      if (table.phase !== 'waiting') throw new AppError('这桌已经开打了')
      await this.requireHall(table.hall.id, userId)
      await this.release(userId)
      const seat = await this.humanSeat(userId)
      const index = table.seats.findIndex((item) => item === null)
      if (!this.tables.has(table.id) || index === -1 || table.phase !== 'waiting') throw new AppError('房间已满')
      table.seats[index] = seat
      this.userTable.set(userId, table.id)
      this.touch(table)
      this.pushAll(table, null)
      this.onLobbyChange?.()
    })
  }

  /** 房主开始：空位由机器人补齐 */
  beginByHost(userId: string): Promise<void> {
    return this.run(async () => {
      const table = this.tableOf(userId)
      if (!table || table.phase !== 'waiting') throw new AppError('牌局已经开始')
      if (table.matching) throw new AppError('正在匹配中，请稍候')
      if (table.seats[table.hostSeat]?.userId !== userId) throw new AppError('只有房主可以开始')
      await this.begin(table)
    })
  }

  act(userId: string, action: MjAction): Promise<void> {
    return this.run(async () => {
      const table = this.tableOf(userId)
      const state = table?.state
      if (!table || !state || state.phase === 'over') throw new AppError('当前没有进行中的牌局')
      const seat = table.seats.findIndex((item) => item?.userId === userId)
      const actor = state.phase === 'claim' ? state.claim?.seat : state.turn
      if (actor !== seat) throw new AppError('还没轮到你')
      this.touch(table)
      await this.apply(table, seat, action)
    })
  }

  /** 结算后点「下一局」：所有真人都准备好就发牌 */
  next(userId: string): Promise<void> {
    return this.run(async () => {
      const table = this.tableOf(userId)
      if (!table || !table.state || table.state.phase !== 'over') throw new AppError('这一局还没有结束')
      const seat = table.seats.find((item) => item?.userId === userId) as Seat
      const user = await this.accounts.requireUser(userId)
      if (user.coins < table.hall.minCoins) throw new AppError(`金币不足：${table.hall.name}至少需要 ${formatCoins(table.hall.minCoins)} 金币`)
      seat.ready = true
      this.touch(table)
      if ((table.seats as Seat[]).every((item) => item.ready)) {
        // 赢家坐庄；流局庄家连庄
        table.dealer = table.state.result?.nextDealer ?? table.dealer
        table.dice = null
        this.deal(table)
      } else {
        this.pushAll(table, null)
      }
    })
  }

  leave(userId: string): Promise<void> {
    return this.run(() => this.doLeave(userId))
  }

  private async doLeave(userId: string): Promise<void> {
    const table = this.tableOf(userId)
    this.userTable.delete(userId)
    this.hub.send(userId, { ev: 'mj', table: null })
    if (!table) return
    const index = table.seats.findIndex((item) => item?.userId === userId)
    const seat = table.seats[index]
    if (!seat) return
    const others = table.seats.filter((item) => item && !item.isBot && !item.away && item.userId !== userId)

    if (others.length === 0) {
      // 桌上没有别的真人了：结算已发生的杠分后收桌
      await this.close(table)
      this.onLobbyChange?.()
      return
    }
    if (table.phase === 'waiting') {
      table.seats[index] = null
    } else if (table.state && table.state.phase !== 'over') {
      // 打到一半离开：这一局由机器人代打，照常结算
      seat.away = true
      this.advance(table)
    } else {
      // 已结算：直接把座位交给机器人
      table.seats[index] = { ...this.botSeat(table, index), ready: true }
      await this.maybeNext(table)
    }
    if (table.hostSeat === index) table.hostSeat = table.seats.findIndex((item) => item && !item.isBot && !item.away)
    this.pushAll(table, null)
    this.onLobbyChange?.()
  }

  private async maybeNext(table: Table): Promise<void> {
    if (table.state?.phase !== 'over') return
    if (!(table.seats as Seat[]).every((item) => item.ready)) return
    table.dealer = table.state.result?.nextDealer ?? table.dealer
    table.dice = null
    this.deal(table)
  }

  onConnect(userId: string): void {
    const table = this.tableOf(userId)
    if (!table) {
      this.hub.send(userId, { ev: 'mj', table: null })
      return
    }
    this.pushAll(table, null)
  }

  /** 掉线：轮到他时改由机器人代打（稍等几秒给重连的机会） */
  onDisconnect(userId: string): void {
    void this.run(() => {
      const table = this.tableOf(userId)
      if (!table) return
      if (table.phase === 'waiting' && table.mode === 'room') return this.doLeave(userId)
      this.advance(table)
      this.pushAll(table, null)
    })
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
        if (this.tables.get(table.id) !== table) return
        try {
          await fn()
        } catch (error) {
          console.error('[mahjong]', error)
        }
      })
    }, ms)
  }

  /** 长时间没有任何真人操作：结算并收桌 */
  private touch(table: Table): void {
    if (table.idleTimer) clearTimeout(table.idleTimer)
    table.idleTimer = setTimeout(() => {
      void this.run(async () => {
        if (this.tables.get(table.id) !== table) return
        await this.close(table)
        this.onLobbyChange?.()
      })
    }, this.timings.idleMs)
    table.idleTimer.unref?.()
  }

  /** 开局：补齐机器人 → 掷骰定庄 → 发牌 */
  private async begin(table: Table): Promise<void> {
    if (table.phase !== 'waiting') return
    for (const seat of table.seats) {
      if (!seat || seat.isBot) continue
      const user = await this.accounts.requireUser(seat.userId)
      if (user.coins < table.hall.minCoins) throw new AppError(`${seat.name} 的金币不足，无法开始`)
    }
    table.seats.forEach((seat, index) => { if (!seat) table.seats[index] = this.botSeat(table, index) })
    table.matching = false
    table.phase = 'dice'
    table.handNo = 1
    table.deadlineAt = null
    const { rounds, dealer } = rollForDealer(this.random)
    table.dice = rounds
    table.dealer = dealer
    this.pushAll(table, null)
    this.onLobbyChange?.()
    this.schedule(table, this.timings.diceMs + (rounds.length - 1) * this.timings.diceExtraMs, () => this.deal(table))
  }

  private deal(table: Table): void {
    if (table.phase === 'playing') table.handNo += 1
    table.phase = 'playing'
    table.state = dealGame(table.dealer, table.options, this.random)
    table.settlements = new Map()
    table.settled = false
    for (const seat of table.seats as Seat[]) seat.ready = seat.isBot
    this.pushAll(table, table.state.events[0] ?? null)
    this.advance(table)
  }

  /** 安排当前该出手的人：机器人 / 托管自动出，真人房间里给真人计时 */
  private advance(table: Table): void {
    const state = table.state
    if (!state || state.phase === 'over') return
    const actor = state.phase === 'claim' ? (state.claim?.seat ?? 0) : state.turn
    const seat = table.seats[actor] as Seat
    const claim = state.phase === 'claim'
    const online = !seat.isBot && !seat.away && this.hub.isOnline(seat.userId)

    if (online) {
      if (table.mode === 'practice') {
        // 人机试炼不限时，慢慢想
        if (table.timer) clearTimeout(table.timer)
        table.timer = null
        table.deadlineAt = null
        return
      }
      const limit = claim ? this.timings.claimTurnMs : this.timings.turnMs
      table.deadlineAt = Date.now() + limit
      this.schedule(table, limit, async () => {
        if (table.state !== state || state.phase === 'over') return
        // 超时：碰杠选择算放弃；出牌则打掉刚摸的牌
        const choices = choicesFor(state, actor)
        const action: MjAction = claim ? { type: 'pass' } : { type: 'discard', tile: state.drawn !== null && choices.discards.includes(state.drawn) ? state.drawn : choices.discards[0] }
        await this.apply(table, actor, action)
      })
      return
    }

    const { botMinMs, botMaxMs, claimMs, offlineMs } = this.timings
    const delay = seat.isBot || seat.away ? (claim ? claimMs : botMinMs + this.random() * (botMaxMs - botMinMs)) : offlineMs
    table.deadlineAt = null
    this.schedule(table, delay, async () => {
      if (table.state !== state || state.phase === 'over') return
      // 掉线的人如果已经连回来了，就把操作权还给他
      if (!seat.isBot && !seat.away && this.hub.isOnline(seat.userId)) return this.advance(table)
      await this.apply(table, actor, botAction(state, actor, seat.isBot ? table.level : 'normal', this.random))
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
    const events = state.events.slice(before)
    if (state.phase === 'over') {
      if (table.timer) clearTimeout(table.timer)
      table.timer = null
      table.deadlineAt = null
      await this.settle(table)
      this.pushAll(table, events[events.length - 1] ?? null)
      this.onLobbyChange?.()
      return
    }
    this.advance(table)
    // 一次操作可能连带多个事件（如打牌后下家摸牌），推送其中最值得演出的那个
    this.pushAll(table, events.find((event) => event.t !== 'draw' && event.t !== 'pass') ?? events[events.length - 1] ?? null)
  }

  private summary(table: Table): string {
    const state = table.state as MjState
    const result = state.result
    if (!result || result.winner < 0) return '流局'
    return `${(table.seats[result.winner] as Seat).name} 自摸${result.shaGui ? ' · 杀鬼' : ''} · 鸟 ${kindName(kindOf(result.bird))} ${result.perPlayer}分/家`
  }

  /** 一局结束（或收桌）：按当前分数结算金币，写入战绩 */
  private async settle(table: Table): Promise<void> {
    const state = table.state
    if (!state || table.settled) return
    table.settled = true
    const seats = table.seats as Seat[]
    const scores = state.players.map((player) => player.score)
    scores.forEach((score, seat) => { table.totals[seat] += score })
    const matchId = randomUUID()
    const finished = state.phase === 'over'
    try {
      const entries = await this.accounts.settleMatch(
        table.hall,
        seats.map((seat, index) => ({
          seat: index, userId: seat.userId, nickname: seat.name, avatar: seat.avatar, isBot: seat.isBot,
          total: scores[index], caught: 0, leopards: 0,
        })),
        [],
        {
          matchId,
          game: 'mahjong',
          label: '红中麻将',
          summary: finished ? this.summary(table) : '中途散桌',
          record: { init: state.init, events: state.events, options: table.options, names: seats.map((seat) => seat.name), level: table.level },
        },
      )
      for (const entry of entries) {
        const seat = seats[entry.seat]
        if (seat.isBot) continue
        table.settlements.set(seat.userId, { matchId, coinsDelta: entry.coinsDelta, honorDelta: entry.honorDelta, expGain: entry.expGain })
        this.hub.send(seat.userId, { ev: 'me', user: await this.accounts.profile(seat.userId) })
      }
    } catch (error) {
      console.error('[mahjong] 结算失败', error)
    }
    // 中途离开的人结算完就把座位交给机器人
    seats.forEach((seat, index) => {
      if (seat.away) table.seats[index] = { ...this.botSeat(table, index), ready: true }
    })
  }

  /** 收桌：已经当场结算的杠分照常入账 */
  private async close(table: Table): Promise<void> {
    if (table.timer) clearTimeout(table.timer)
    if (table.idleTimer) clearTimeout(table.idleTimer)
    table.timer = null
    if (table.state && table.state.phase !== 'over' && table.state.players.some((player) => player.score !== 0)) await this.settle(table)
    for (const seat of table.seats) {
      if (seat && !seat.isBot && this.userTable.get(seat.userId) === table.id) {
        this.userTable.delete(seat.userId)
        this.hub.send(seat.userId, { ev: 'mj', table: null })
      }
    }
    this.tables.delete(table.id)
  }

  // ------------------------------ 视图 ------------------------------

  private pushAll(table: Table, event: MjEvent | null): void {
    table.seq += 1
    for (const seat of table.seats) {
      if (!seat || seat.isBot || seat.away) continue
      const index = table.seats.indexOf(seat)
      this.hub.send(seat.userId, { ev: 'mj', table: this.view(table, index, event) })
    }
  }

  /** 生成某个座位的视图：所有座位号换算成以他为 0 号位，并隐藏别人的手牌 */
  private view(table: Table, my: number, event: MjEvent | null): MjView {
    const state = table.state
    const over = state?.phase === 'over'
    const rel = (seat: number) => (seat < 0 ? seat : (seat - my + SEATS) % SEATS)
    const abs = (seat: number) => (seat + my) % SEATS
    const rotate = <T>(items: T[]): T[] => items.map((_, index) => items[abs(index)])
    const relMeld = (meld: Meld): Meld => ({ ...meld, ...(meld.from !== undefined ? { from: rel(meld.from) } : {}) })
    const relEvent = (item: MjEvent): MjEvent => {
      if (!('seat' in item)) return item
      const next = { ...item, seat: rel(item.seat) } as MjEvent
      if ('from' in next) next.from = rel(next.from)
      return next
    }

    const seats: MjSeatView[] = Array.from({ length: SEATS }, (_, index) => {
      const absolute = abs(index)
      const seat = table.seats[absolute]
      const player = state?.players[absolute]
      const online = Boolean(seat) && (seat!.isBot || (!seat!.away && this.hub.isOnline(seat!.userId)))
      return {
        seat: index,
        empty: !seat,
        userId: seat && !seat.isBot ? seat.userId : '',
        online,
        trustee: Boolean(seat) && !seat!.isBot && !online,
        ready: seat?.ready ?? false,
        name: seat?.name ?? '',
        avatar: seat?.avatar ?? 0,
        frame: seat?.frame ?? '',
        isBot: seat?.isBot ?? false,
        handCount: player?.hand.length ?? 0,
        hand: over && player ? player.hand : null,
        // 别人的暗杠对局中不亮牌
        melds: (player?.melds ?? []).map((meld) => relMeld(meld.type === 'ankan' && absolute !== my && !over ? { ...meld, kind: -1, tiles: meld.tiles.map(() => -1) } : meld)),
        discards: player?.discards ?? [],
        score: player?.score ?? 0,
        total: table.totals[absolute] + (table.settled ? 0 : player?.score ?? 0),
      }
    })

    const result = state?.result
      ? { ...state.result, winner: rel(state.result.winner), nextDealer: rel(state.result.nextDealer), winDeltas: rotate(state.result.winDeltas) }
      : null
    // 别人摸到什么牌不能让客户端知道
    const shownEvent = event ? relEvent(event.t === 'draw' && event.seat !== my ? { ...event, tile: -1 } : event) : null
    const record: MjRecord | null = over && state
      ? {
        init: { hands: rotate(state.init.hands), wall: state.init.wall, dealer: rel(state.init.dealer) },
        events: state.events.map(relEvent),
        options: table.options,
        names: rotate((table.seats as Seat[]).map((seat) => seat.name)),
        level: table.level,
      }
      : null
    const mySeat = table.seats[my]

    return {
      roomId: table.id,
      mode: table.mode,
      isPrivate: table.isPrivate,
      matching: table.matching,
      hostSeat: rel(table.hostSeat),
      deadlineAt: table.deadlineAt,
      serverNow: Date.now(),
      hallId: table.hall.id,
      stake: table.hall.stake,
      level: table.level,
      options: table.options,
      handNo: table.handNo,
      phase: table.phase === 'waiting' ? 'waiting' : table.phase === 'dice' || !state ? 'dice' : state.phase,
      dice: table.dice ? table.dice.map((round) => ({ seats: round.seats.map(rel), rolls: round.rolls })) : null,
      dealer: rel(table.dealer),
      turn: rel(state?.turn ?? table.dealer),
      wallCount: state?.wall.length ?? 0,
      hand: state?.players[my].hand ?? [],
      drawn: state && state.turn === my ? state.drawn : null,
      choices: state ? choicesFor(state, my) : NO_CHOICES,
      seats,
      lastDiscard: state?.lastDiscard ? { seat: rel(state.lastDiscard.seat), tile: state.lastDiscard.tile } : null,
      claimSeat: state?.phase === 'claim' ? rel(state.claim?.seat ?? -1) : -1,
      kongs: (state?.kongs ?? []).map((kong) => ({ ...kong, seat: rel(kong.seat), deltas: rotate(kong.deltas) })),
      result,
      settlement: mySeat ? table.settlements.get(mySeat.userId) ?? null : null,
      seq: table.seq,
      lastEvent: shownEvent,
      record,
    }
  }
}
