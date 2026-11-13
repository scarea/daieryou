// 六胡抢牌桌服务：房间制，支持人机试炼、好友约局、快速匹配。服务端权威。
// 每位玩家拿到的视图都换算成"以自己为 0 号位"。
import { randomUUID } from 'node:crypto'
import { AVATARS, Hall, formatCoins, hallById } from '../shared/economy.ts'
import { FlipRound, LH_SEATS, LhAction, LhEvent, LhMeld, LhState, actorOf, applyLiuhu, choicesFor, dealLiuhu, flipForDealer } from '../shared/liuhu/game.ts'
import { lhKind, lhName } from '../shared/liuhu/tiles.ts'
import { LH_LEVELS, LhLevel, LhSeatView, LhSettlement, LhView } from '../shared/liuhu/view.ts'
import type { LobbyRoom, RoomStatus, ServerEvent } from '../shared/protocol.ts'
import { Accounts, AppError } from './accounts.ts'
import { lhBotAction } from './lhBot.ts'

interface LhHub {
  send(userId: string, event: ServerEvent): void
  isOnline(userId: string): boolean
}

export interface LhTimings {
  /** 翻牌定庄动画：首轮时长 + 每多一轮追加的时长 */
  flipMs: number
  flipExtraMs: number
  botMinMs: number
  botMaxMs: number
  claimMs: number
  /** 真人房间里：打牌 / 表态的思考时限 */
  turnMs: number
  claimTurnMs: number
  offlineMs: number
  matchMs: number
  idleMs: number
}

export const LH_TIMINGS: LhTimings = {
  flipMs: 3600, flipExtraMs: 2000, botMinMs: 900, botMaxMs: 1500, claimMs: 800,
  turnMs: 20000, claimTurnMs: 12000, offlineMs: 3500, matchMs: 12000, idleMs: 20 * 60 * 1000,
}

interface Seat {
  userId: string
  name: string
  avatar: number
  frame: string
  isBot: boolean
  away: boolean
  ready: boolean
}

interface Table {
  id: string
  mode: 'practice' | 'room'
  isPrivate: boolean
  matching: boolean
  hall: Hall
  level: LhLevel
  seats: (Seat | null)[]
  hostSeat: number
  phase: 'waiting' | 'flip' | 'playing'
  handNo: number
  dealer: number
  flip: FlipRound[] | null
  state: LhState | null
  totals: number[]
  settlements: Map<string, LhSettlement>
  settled: boolean
  seq: number
  deadlineAt: number | null
  timer: NodeJS.Timeout | null
  idleTimer: NodeJS.Timeout | null
}

const BOT_NAMES = ['常宁老牌客', '二七十阿婆', '抢胡小能手', '笑口常开叔', '重跑不打哥', '字牌张师傅', '全黑梦想家', '下伙王大姐', '挡底就胡伯', '单吊冠军']
const NO_CHOICES = { discards: [], hu: false, peng: false, chi: [], pass: false }
const KIND_LABEL = { zimo: '自摸', pao: '放炮', gong: '抢胡' }

export class LiuhuManager {
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
    private hub: LhHub,
    private timings: LhTimings = LH_TIMINGS,
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
        game: 'liuhu',
        seats: LH_SEATS,
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
  publicRoomOf(userId: string): { id: string; status: RoomStatus; joinable: boolean; game: 'liuhu' } | null {
    const table = this.tableOf(userId)
    if (!table || table.mode !== 'room' || table.isPrivate) return null
    return { id: table.id, status: this.statusOf(table), joinable: table.phase === 'waiting' && table.seats.some((seat) => seat === null), game: 'liuhu' }
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
      userId: `lhbot-${table.id}-${index}`,
      name: names[Math.floor(this.random() * names.length)] ?? `机器人${index}`,
      avatar: Math.floor(this.random() * AVATARS.length),
      frame: '',
      isBot: true,
      away: false,
      ready: true,
    }
  }

  private async createTable(userId: string, hall: Hall, config: Pick<Table, 'mode' | 'isPrivate' | 'matching' | 'level'>): Promise<Table> {
    const table: Table = {
      id: this.newId(),
      ...config,
      hall,
      seats: [await this.humanSeat(userId), null, null, null],
      hostSeat: 0,
      phase: 'waiting',
      handNo: 0,
      dealer: 0,
      flip: null,
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
  start(userId: string, hallId: string, level: LhLevel): Promise<void> {
    return this.run(async () => {
      if (!LH_LEVELS.includes(level)) throw new AppError('难度无效')
      const hall = await this.requireHall(hallId, userId)
      await this.release(userId)
      const table = await this.createTable(userId, hall, { mode: 'practice', isPrivate: true, matching: false, level })
      await this.begin(table)
    })
  }

  /** 好友约局：建一张桌子等人，房主点开始时空位由机器人补齐 */
  create(userId: string, hallId: string, isPrivate: boolean, level: LhLevel): Promise<void> {
    return this.run(async () => {
      const hall = await this.requireHall(hallId, userId)
      await this.release(userId)
      const table = await this.createTable(userId, hall, {
        mode: 'room', isPrivate: Boolean(isPrivate), matching: false, level: LH_LEVELS.includes(level) ? level : 'hard',
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
        table = await this.createTable(userId, hall, { mode: 'room', isPrivate: true, matching: true, level: 'hard' })
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

  act(userId: string, action: LhAction): Promise<void> {
    return this.run(async () => {
      const table = this.tableOf(userId)
      const state = table?.state
      if (!table || !state || state.phase === 'over') throw new AppError('当前没有进行中的牌局')
      const seat = table.seats.findIndex((item) => item?.userId === userId)
      if (actorOf(state) !== seat) throw new AppError('还没轮到你')
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
        // 谁胡谁做庄；荒庄庄家连庄
        table.dealer = table.state.result?.nextDealer ?? table.dealer
        table.flip = null
        await this.deal(table)
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
    this.hub.send(userId, { ev: 'lh', table: null })
    if (!table) return
    const index = table.seats.findIndex((item) => item?.userId === userId)
    const seat = table.seats[index]
    if (!seat) return
    const others = table.seats.filter((item) => item && !item.isBot && !item.away && item.userId !== userId)

    if (others.length === 0) {
      // 桌上没有别的真人了：收桌
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
    table.flip = null
    await this.deal(table)
  }

  onConnect(userId: string): void {
    const table = this.tableOf(userId)
    if (!table) {
      this.hub.send(userId, { ev: 'lh', table: null })
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
          console.error('[liuhu]', error)
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

  /** 开局：补齐机器人 → 翻牌定庄 → 发牌 */
  private async begin(table: Table): Promise<void> {
    if (table.phase !== 'waiting') return
    for (const seat of table.seats) {
      if (!seat || seat.isBot) continue
      const user = await this.accounts.requireUser(seat.userId)
      if (user.coins < table.hall.minCoins) throw new AppError(`${seat.name} 的金币不足，无法开始`)
    }
    table.seats.forEach((seat, index) => { if (!seat) table.seats[index] = this.botSeat(table, index) })
    table.matching = false
    table.phase = 'flip'
    table.handNo = 1
    table.deadlineAt = null
    const { rounds, dealer } = flipForDealer(this.random)
    table.flip = rounds
    table.dealer = dealer
    this.pushAll(table, null)
    this.onLobbyChange?.()
    this.schedule(table, this.timings.flipMs + (rounds.length - 1) * this.timings.flipExtraMs, () => this.deal(table))
  }

  private async deal(table: Table): Promise<void> {
    if (table.phase === 'playing') table.handNo += 1
    table.phase = 'playing'
    table.state = dealLiuhu(table.dealer, undefined, this.random)
    table.settlements = new Map()
    table.settled = false
    for (const seat of table.seats as Seat[]) seat.ready = seat.isBot
    await this.afterChange(table, table.state.events.slice())
  }

  /** 安排当前该出手的人：机器人 / 托管自动出，真人房间里给真人计时 */
  private advance(table: Table): void {
    const state = table.state
    if (!state || state.phase === 'over') return
    const actor = actorOf(state)
    const seat = table.seats[actor] as Seat
    const claim = state.phase === 'claim'
    const online = !seat.isBot && !seat.away && this.hub.isOnline(seat.userId)
    const mark = state.events.length

    if (online) {
      if (table.mode === 'practice') {
        if (table.timer) clearTimeout(table.timer)
        table.timer = null
        table.deadlineAt = null
        return
      }
      const limit = claim ? this.timings.claimTurnMs : this.timings.turnMs
      table.deadlineAt = Date.now() + limit
      this.schedule(table, limit, async () => {
        if (table.state !== state || state.events.length !== mark || state.phase === 'over') return
        // 超时：能胡就胡，吃碰算放弃，该打牌时由机器人代选一张
        const choices = choicesFor(state, actor)
        const action: LhAction = choices.hu ? { type: 'hu' } : claim ? { type: 'pass' } : lhBotAction(state, actor, 'normal', this.random)
        await this.apply(table, actor, action)
      })
      return
    }

    const { botMinMs, botMaxMs, claimMs, offlineMs } = this.timings
    const delay = seat.isBot || seat.away ? (claim ? claimMs : botMinMs + this.random() * (botMaxMs - botMinMs)) : offlineMs
    table.deadlineAt = null
    this.schedule(table, delay, async () => {
      if (table.state !== state || state.events.length !== mark || state.phase === 'over') return
      if (!seat.isBot && !seat.away && this.hub.isOnline(seat.userId)) return this.advance(table)
      await this.apply(table, actor, lhBotAction(state, actor, seat.isBot ? table.level : 'normal', this.random))
    })
  }

  private async apply(table: Table, seat: number, action: LhAction): Promise<void> {
    const state = table.state as LhState
    const before = state.events.length
    try {
      applyLiuhu(state, seat, action)
    } catch (error) {
      throw new AppError((error as Error).message)
    }
    await this.afterChange(table, state.events.slice(before))
  }

  private async afterChange(table: Table, events: LhEvent[]): Promise<void> {
    const state = table.state as LhState
    // 一次操作可能连带多个事件（如打牌 → 没人要 → 下家摸牌），推送其中最值得演出的那个
    const rank = (event: LhEvent) => (event.t === 'hu' || event.t === 'drawn-game' ? 5 : event.t === 'meld' || event.t === 'chi' ? 4 : event.t === 'discard' ? 3 : event.t === 'draw' || event.t === 'open' ? 2 : 1)
    const shown = events.reduce<LhEvent | null>((best, event) => (!best || rank(event) >= rank(best) ? event : best), null)
    if (state.phase === 'over') {
      if (table.timer) clearTimeout(table.timer)
      table.timer = null
      table.deadlineAt = null
      await this.settle(table)
      this.pushAll(table, shown)
      this.onLobbyChange?.()
      return
    }
    this.advance(table)
    this.pushAll(table, shown)
  }

  private summary(table: Table): string {
    const result = (table.state as LhState).result
    if (!result || result.winner < 0) return '荒庄'
    const name = (table.seats[result.winner] as Seat).name
    return `${name} ${KIND_LABEL[result.kind]} · ${result.hu}胡 · ${result.redName}${result.mult > 1 ? ` ×${result.mult}` : ''} · 胡${lhName(lhKind(result.tile))}`
  }

  /** 一局结束：按分数结算金币，写入战绩 */
  private async settle(table: Table): Promise<void> {
    const state = table.state
    if (!state || table.settled) return
    table.settled = true
    const seats = table.seats as Seat[]
    const scores = state.players.map((player) => player.score)
    scores.forEach((score, seat) => { table.totals[seat] += score })
    const matchId = randomUUID()
    try {
      const entries = await this.accounts.settleMatch(
        table.hall,
        seats.map((seat, index) => ({
          seat: index, userId: seat.userId, nickname: seat.name, avatar: seat.avatar, isBot: seat.isBot,
          total: scores[index], caught: 0, leopards: 0,
        })),
        [],
        { matchId, game: 'liuhu', label: '六胡抢', summary: this.summary(table), record: { log: state.log, names: seats.map((seat) => seat.name), level: table.level } },
      )
      for (const entry of entries) {
        const seat = seats[entry.seat]
        if (seat.isBot) continue
        table.settlements.set(seat.userId, { matchId, coinsDelta: entry.coinsDelta, honorDelta: entry.honorDelta, expGain: entry.expGain })
        this.hub.send(seat.userId, { ev: 'me', user: await this.accounts.profile(seat.userId) })
      }
    } catch (error) {
      console.error('[liuhu] 结算失败', error)
    }
    seats.forEach((seat, index) => {
      if (seat.away) table.seats[index] = { ...this.botSeat(table, index), ready: true }
    })
  }

  /** 收桌：没打完的一局不算分 */
  private async close(table: Table): Promise<void> {
    if (table.timer) clearTimeout(table.timer)
    if (table.idleTimer) clearTimeout(table.idleTimer)
    table.timer = null
    for (const seat of table.seats) {
      if (seat && !seat.isBot && this.userTable.get(seat.userId) === table.id) {
        this.userTable.delete(seat.userId)
        this.hub.send(seat.userId, { ev: 'lh', table: null })
      }
    }
    this.tables.delete(table.id)
  }

  // ------------------------------ 视图 ------------------------------

  private pushAll(table: Table, event: LhEvent | null): void {
    table.seq += 1
    for (const seat of table.seats) {
      if (!seat || seat.isBot || seat.away) continue
      const index = table.seats.indexOf(seat)
      this.hub.send(seat.userId, { ev: 'lh', table: this.view(table, index, event) })
    }
  }

  private view(table: Table, my: number, event: LhEvent | null): LhView {
    const state = table.state
    const over = state?.phase === 'over'
    const rel = (seat: number) => (seat < 0 ? seat : (seat - my + LH_SEATS) % LH_SEATS)
    const abs = (seat: number) => (seat + my) % LH_SEATS
    const rotate = <T>(items: T[]): T[] => items.map((_, index) => items[abs(index)])
    const relMeld = (meld: LhMeld, hidden: boolean): LhMeld => ({
      ...(hidden ? { ...meld, kind: -1, tiles: meld.tiles.map(() => -1), hu: 0 } : meld),
      ...(meld.from !== undefined ? { from: rel(meld.from) } : {}),
    })
    const relEvent = (item: LhEvent): LhEvent => {
      if (!('seat' in item)) return item
      const next = { ...item, seat: rel(item.seat) } as LhEvent
      if ('from' in next) next.from = rel(next.from)
      // 别人的提不亮牌
      if (next.t === 'meld' && next.type === 'ti' && item.seat !== my && !over) next.kind = -1
      return next
    }

    const seats: LhSeatView[] = Array.from({ length: LH_SEATS }, (_, index) => {
      const absolute = abs(index)
      const seat = table.seats[absolute]
      const player = state?.players[absolute]
      const online = Boolean(seat) && (seat!.isBot || (!seat!.away && this.hub.isOnline(seat!.userId)))
      const melds = (player?.melds ?? []).map((meld) => relMeld(meld, meld.type === 'ti' && absolute !== my && !over))
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
        melds,
        discards: player?.discards ?? [],
        hu: melds.reduce((sum, meld) => sum + meld.hu, 0),
        score: player?.score ?? 0,
        total: table.totals[absolute] + (table.settled ? 0 : player?.score ?? 0),
      }
    })

    const result = state?.result
      ? { ...state.result, winner: rel(state.result.winner), loser: rel(state.result.loser), nextDealer: rel(state.result.nextDealer), deltas: rotate(state.result.deltas) }
      : null
    const pending = state?.pending
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
      handNo: table.handNo,
      phase: table.phase === 'waiting' ? 'waiting' : table.phase === 'flip' || !state ? 'flip' : state.phase,
      flip: table.flip ? table.flip.map((round) => ({ seats: round.seats.map(rel), tiles: round.tiles })) : null,
      dealer: rel(table.dealer),
      actor: state ? rel(actorOf(state)) : -1,
      wallCount: state?.wall.length ?? 0,
      hand: state?.players[my].hand ?? [],
      choices: state ? choicesFor(state, my) : NO_CHOICES,
      seats,
      shown: pending && (state?.phase === 'claim' || over) ? { tile: pending.tile, from: rel(pending.from), source: pending.source } : null,
      result,
      settlement: mySeat ? table.settlements.get(mySeat.userId) ?? null : null,
      seq: table.seq,
      lastEvent: event ? relEvent(event) : null,
      record: over && state
        ? { decisions: state.log.filter((item) => item.seat === my).map((item) => ({ ...item, seat: 0, from: rel(item.from) })), level: table.level }
        : null,
    }
  }
}
