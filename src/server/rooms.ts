// 房间与对局管理：大厅、建房 / 加入、机器人补位、回合计时、托管、结算。
import { Hall, HALLS, AVATARS, hallById, formatCoins } from '../shared/economy.ts'
import {
  GameState, HIDDEN_ROUND, MAX_ROUNDS, PLAYER_COUNT, advanceRound, allPicked, createGame, currentPublicCard,
  isSelectionRound, pickCards, settleRound, viewFor,
} from '../shared/engine.ts'
import type { Card } from '../shared/cards.ts'
import { describeHand } from '../shared/hand.ts'
import {
  BotLevel, EMOTES, LobbyRoom, LobbyState, RoomStatus, RoomView, SeatInfo, ServerEvent, SettlementEntry,
} from '../shared/protocol.ts'
import { Accounts, AppError } from './accounts.ts'
import { decidePick } from './bot.ts'

export interface Hub {
  send(userId: string, event: ServerEvent): void
  isOnline(userId: string): boolean
  onlineUserIds(): string[]
}

export interface RoomTimings {
  pickMs: number
  finalMs: number
  showdownMs: number
  finalShowdownMs: number
  botMinMs: number
  botMaxMs: number
  offlineGraceMs: number
  idleKickMs: number
  /** 快速匹配等待真人的时间，到时补机器人开局 */
  matchMs: number
}

export const DEFAULT_TIMINGS: RoomTimings = {
  pickMs: 40000,
  finalMs: 3500,
  showdownMs: 7500,
  finalShowdownMs: 8500,
  botMinMs: 1300,
  botMaxMs: 3800,
  offlineGraceMs: 8000,
  idleKickMs: 60000,
  matchMs: 12000,
}

interface Member {
  userId: string
  nickname: string
  avatar: number
  frame: string
  isBot: boolean
  botLevel?: BotLevel
  honor: number
  coins: number | null
  /** 对局中主动离开：座位保留并由 AI 托管，结算后移出 */
  away: boolean
  ready: boolean
}

interface Room {
  id: string
  hall: Hall
  isPrivate: boolean
  matching: boolean
  spectators: Set<string>
  /** 是否已写入数据库存档（对局中的房间会存档，服务重启后可恢复） */
  persisted: boolean
  saveChain: Promise<void>
  status: RoomStatus
  hostSeat: number
  seats: (Member | null)[]
  game: GameState | null
  settlement: SettlementEntry[] | null
  deadlineAt: number | null
  phaseTimer: NodeJS.Timeout | null
  autoTimers: Set<NodeJS.Timeout>
  touchedAt: number
}

const BOT_NAMES = ['金算盘', '铁公鸡', '笑面虎', '钱串子', '玉面狐', '醉八仙', '赛诸葛', '小财迷', '老掌柜', '锦衣客', '千金笑', '银钩子', '福满楼', '贵妃醉']
const BOT_HONOR: Record<BotLevel, [number, number]> = { easy: [0, 120], normal: [150, 700], hard: [700, 2000], peek: [2400, 5000] }
const BOT_LEVELS: BotLevel[] = ['easy', 'normal', 'hard', 'peek']
const BOT_FRAME: Record<BotLevel, string> = { easy: '', normal: '', hard: 'frame-jade', peek: 'frame-flame' }
const MAX_ROOMS = 2000
const MAX_SPECTATORS = 30
const RESTORE_MAX_AGE_MS = 30 * 60 * 1000

export class RoomManager {
  private rooms = new Map<string, Room>()
  private userRoom = new Map<string, string>()
  /** 观战者 → 房间 */
  private watching = new Map<string, string>()
  private idleTimers = new Map<string, NodeJS.Timeout>()
  private lobbyTimer: NodeJS.Timeout | null = null
  private botSeq = 0
  /** 所有会改动房间状态的操作（含定时器回调）排队串行执行，数据库读写期间不会被其他操作插入 */
  private queue: Promise<unknown> = Promise.resolve()

  private run<T>(task: () => Promise<T> | T): Promise<T> {
    const result = this.queue.then(task)
    this.queue = result.catch(() => {})
    return result
  }

  constructor(
    private accounts: Accounts,
    private hub: Hub,
    private timings: RoomTimings = DEFAULT_TIMINGS,
    private random: () => number = Math.random,
  ) {}

  // ------------------------------ 对外操作（全部排队执行） ------------------------------

  quick(userId: string, hallId: string, botLevel: BotLevel): Promise<void> {
    return this.run(() => this.doQuick(userId, hallId, botLevel))
  }

  create(userId: string, hallId: string, isPrivate: boolean): Promise<void> {
    return this.run(() => this.doCreate(userId, hallId, isPrivate))
  }

  join(userId: string, roomId: string): Promise<void> {
    return this.run(() => this.doJoin(userId, roomId))
  }

  leave(userId: string): Promise<void> {
    return this.run(() => this.doLeave(userId))
  }

  addBot(userId: string, level: BotLevel): Promise<void> {
    return this.run(() => this.doAddBot(userId, level))
  }

  kick(userId: string, seat: number): Promise<void> {
    return this.run(() => this.doKick(userId, seat))
  }

  start(userId: string): Promise<void> {
    return this.run(() => this.doStart(userId))
  }

  again(userId: string): Promise<void> {
    return this.run(() => this.doAgain(userId))
  }

  play(userId: string, round: number, cardIds: string[]): Promise<void> {
    return this.run(() => this.doPlay(userId, round, cardIds))
  }

  emote(userId: string, key: string): Promise<void> {
    return this.run(() => this.doEmote(userId, key))
  }

  onConnect(userId: string): Promise<void> {
    return this.run(() => this.doOnConnect(userId))
  }

  onDisconnect(userId: string): Promise<void> {
    return this.run(() => this.doOnDisconnect(userId))
  }

  match(userId: string, hallId: string): Promise<void> {
    return this.run(() => this.doMatch(userId, hallId))
  }

  spectate(userId: string, roomId: string): Promise<void> {
    return this.run(() => this.doSpectate(userId, roomId))
  }

  // ------------------------------ 查询 ------------------------------

  roomOf(userId: string): Room | undefined {
    const roomId = this.userRoom.get(userId)
    return roomId ? this.rooms.get(roomId) : undefined
  }

  lobbyState(): LobbyState {
    const rooms: LobbyRoom[] = []
    for (const room of this.rooms.values()) {
      if (room.isPrivate) continue
      const members = room.seats.filter(Boolean) as Member[]
      if (!members.some((member) => !member.isBot)) continue
      rooms.push({
        id: room.id,
        game: 'd2y',
        seats: PLAYER_COUNT,
        hallId: room.hall.id,
        stake: room.hall.stake,
        status: room.status,
        hostName: room.seats[room.hostSeat]?.nickname ?? '',
        players: members.map((member) => ({ nickname: member.nickname, avatar: member.avatar, isBot: member.isBot })),
      })
    }
    if (this.extraLobbyRooms) rooms.push(...this.extraLobbyRooms())
    rooms.sort((a, b) => (a.status === 'playing' ? 1 : 0) - (b.status === 'playing' ? 1 : 0))
    return { rooms: rooms.slice(0, 60), online: this.hub.onlineUserIds().length }
  }

  viewFor(room: Room, userId: string): RoomView {
    const mySeat = room.seats.findIndex((member) => member?.userId === userId)
    return {
      id: room.id,
      hallId: room.hall.id,
      stake: room.hall.stake,
      isPrivate: room.isPrivate,
      matching: room.matching,
      spectators: room.spectators.size,
      status: room.status,
      hostSeat: room.hostSeat,
      seats: room.seats.map((member, seat) => (member ? this.seatInfo(member, seat) : null)),
      mySeat,
      deadlineAt: room.deadlineAt,
      serverNow: Date.now(),
      game: room.game ? viewFor(room.game, mySeat) : null,
      settlement: room.settlement,
    }
  }

  private seatInfo(member: Member, seat: number): SeatInfo {
    const online = member.isBot || (!member.away && this.hub.isOnline(member.userId))
    return {
      seat,
      userId: member.userId,
      nickname: member.nickname,
      avatar: member.avatar,
      frame: member.frame,
      isBot: member.isBot,
      botLevel: member.botLevel,
      online,
      trustee: !member.isBot && !online,
      coins: member.coins,
      honor: member.honor,
      ready: member.ready,
    }
  }

  // ------------------------------ 广播 ------------------------------

  private broadcast(room: Room): void {
    room.touchedAt = Date.now()
    for (const member of room.seats) {
      if (!member || member.isBot || member.away) continue
      this.hub.send(member.userId, { ev: 'room', room: this.viewFor(room, member.userId) })
    }
    for (const userId of room.spectators) {
      if (this.hub.isOnline(userId)) this.hub.send(userId, { ev: 'room', room: this.viewFor(room, userId) })
      else this.dropSpectator(room, userId)
    }
    this.persist(room)
  }

  private dropSpectator(room: Room, userId: string): void {
    room.spectators.delete(userId)
    if (this.watching.get(userId) === room.id) this.watching.delete(userId)
  }

  /** 对局中的房间写入数据库存档；结束或解散后删除 */
  private persist(room: Room): void {
    const store = this.accounts.store
    if (room.status === 'playing' && room.game) {
      const data = JSON.stringify({
        id: room.id, hallId: room.hall.id, isPrivate: room.isPrivate, hostSeat: room.hostSeat, seats: room.seats, game: room.game,
      })
      room.persisted = true
      room.saveChain = room.saveChain.then(() => store.saveRoom(room.id, data)).catch((error) => console.error('[persist]', error))
    } else if (room.persisted) {
      room.persisted = false
      room.saveChain = room.saveChain.then(() => store.deleteRoom(room.id)).catch((error) => console.error('[persist]', error))
    }
  }

  /** 服务启动时恢复未打完的对局：继续计时，离线的座位由 AI 托管，重连的玩家可接着打 */
  restore(): Promise<number> {
    return this.run(async () => {
      let restored = 0
      for (const row of await this.accounts.store.listRooms()) {
        try {
          const saved = JSON.parse(row.data) as { id: string; hallId: string; isPrivate: boolean; hostSeat: number; seats: (Member | null)[]; game: GameState }
          const hall = hallById(saved.hallId)
          if (!hall || !saved.game || this.rooms.has(saved.id) || Date.now() - row.updated_at > RESTORE_MAX_AGE_MS || saved.seats.some((member) => !member)) {
            await this.accounts.store.deleteRoom(row.id)
            continue
          }
          const room: Room = {
            id: saved.id, hall, isPrivate: saved.isPrivate, matching: false, spectators: new Set(), persisted: true, saveChain: Promise.resolve(),
            status: 'playing', hostSeat: saved.hostSeat, seats: saved.seats, game: saved.game, settlement: null,
            deadlineAt: null, phaseTimer: null, autoTimers: new Set(), touchedAt: Date.now(),
          }
          this.rooms.set(room.id, room)
          for (const member of room.seats) {
            if (member && !member.isBot && !member.away && !this.userRoom.has(member.userId)) this.userRoom.set(member.userId, room.id)
          }
          if (saved.game.phase === 'selecting') this.beginRound(room)
          else if (saved.game.phase === 'showdown') this.setPhaseTimer(room, this.timings.showdownMs, () => this.afterShowdown(room))
          else await this.finishGame(room)
          restored += 1
        } catch (error) {
          console.error('[restore]', error)
          await this.accounts.store.deleteRoom(row.id).catch(() => {})
        }
      }
      return restored
    })
  }

  /** 其他游戏的公开牌桌（由应用层注入），一并出现在大厅列表里 */
  extraLobbyRooms: (() => LobbyRoom[]) | null = null
  /** 判断某用户是否在别的游戏的牌桌上（在的话不给他推大厅） */
  busyElsewhere: ((userId: string) => boolean) | null = null

  /** 大厅列表有变化时调用：合并短时间内的多次变化后统一推送 */
  refreshLobby(): void {
    this.broadcastLobbySoon()
  }

  hasRoom(roomId: string): boolean {
    return this.rooms.has(roomId)
  }

  private broadcastLobbySoon(): void {
    if (this.lobbyTimer) return
    this.lobbyTimer = setTimeout(() => {
      this.lobbyTimer = null
      const lobby = this.lobbyState()
      for (const userId of this.hub.onlineUserIds()) {
        if (!this.userRoom.has(userId) && !this.busyElsewhere?.(userId)) this.hub.send(userId, { ev: 'lobby', lobby })
      }
    }, 120)
    this.lobbyTimer.unref?.()
  }

  private async pushProfile(userId: string): Promise<void> {
    try {
      this.hub.send(userId, { ev: 'me', user: await this.accounts.profile(userId) })
    } catch {
      // 用户不存在则忽略
    }
  }

  // ------------------------------ 进出房间 ------------------------------

  private newRoomId(): string {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      // 9 开头的房号留给红中麻将
      const id = String(Math.floor(100000 + this.random() * 800000))
      if (!this.rooms.has(id)) return id
    }
    throw new AppError('房间号分配失败，请重试')
  }

  private async requireHall(hallId: string, userId: string): Promise<Hall> {
    const hall = hallById(hallId)
    if (!hall) throw new AppError('场次不存在')
    const user = await this.accounts.requireUser(userId)
    if (user.coins < hall.minCoins) {
      throw new AppError(`金币不足：进入${hall.name}至少需要 ${formatCoins(hall.minCoins)} 金币`)
    }
    return hall
  }

  /** 进入新房间前，先处理用户当前所在的房间 */
  private async releaseCurrentRoom(userId: string): Promise<void> {
    const current = this.roomOf(userId)
    if (!current) return
    if (current.status === 'playing') throw new AppError('你还有一局未打完的牌')
    await this.doLeave(userId)
  }

  private async humanMember(userId: string): Promise<Member> {
    const user = await this.accounts.requireUser(userId)
    return {
      userId,
      nickname: user.nickname,
      avatar: user.avatar,
      frame: user.frame || '',
      isBot: false,
      honor: user.honor,
      coins: user.coins,
      away: false,
      ready: false,
    }
  }

  private botMember(level: BotLevel, room: Room): Member {
    const taken = new Set(room.seats.filter(Boolean).map((member) => (member as Member).nickname))
    const names = BOT_NAMES.filter((name) => !taken.has(name))
    const [low, high] = BOT_HONOR[level]
    this.botSeq += 1
    return {
      userId: `bot-${this.botSeq}-${Math.floor(this.random() * 1e6)}`,
      nickname: names[Math.floor(this.random() * names.length)],
      avatar: Math.floor(this.random() * AVATARS.length),
      frame: BOT_FRAME[level],
      isBot: true,
      botLevel: level,
      honor: Math.floor(low + this.random() * (high - low)),
      coins: null,
      away: false,
      ready: true,
    }
  }

  private async createRoom(userId: string, hall: Hall, isPrivate: boolean, matching = false): Promise<Room> {
    if (this.rooms.size >= MAX_ROOMS) throw new AppError('服务器房间已满，请稍后再试')
    const room: Room = {
      id: this.newRoomId(),
      hall,
      isPrivate,
      matching,
      spectators: new Set(),
      persisted: false,
      saveChain: Promise.resolve(),
      status: 'waiting',
      hostSeat: 0,
      seats: [await this.humanMember(userId), null, null],
      game: null,
      settlement: null,
      deadlineAt: null,
      phaseTimer: null,
      autoTimers: new Set(),
      touchedAt: Date.now(),
    }
    this.rooms.set(room.id, room)
    this.userRoom.set(userId, room.id)
    return room
  }

  /** 人机对战：一键开局（1 人 + 2 机器人） */
  private async doQuick(userId: string, hallId: string, botLevel: BotLevel): Promise<void> {
    if (!BOT_LEVELS.includes(botLevel)) throw new AppError('机器人难度无效')
    await this.releaseCurrentRoom(userId)
    const hall = await this.requireHall(hallId, userId)
    const room = await this.createRoom(userId, hall, true)
    room.seats[1] = this.botMember(botLevel, room)
    room.seats[2] = this.botMember(botLevel, room)
    await this.startGame(room)
  }

  /** 快速匹配：凑齐 3 名真人立即开局；等待超时则由机器人补位 */
  private async doMatch(userId: string, hallId: string): Promise<void> {
    await this.releaseCurrentRoom(userId)
    const hall = await this.requireHall(hallId, userId)
    let room = [...this.rooms.values()].find(
      (item) => item.matching && item.status === 'waiting' && item.hall.id === hall.id && item.seats.some((member) => member === null),
    )
    if (room) {
      const member = await this.humanMember(userId)
      const seat = room.seats.findIndex((item) => item === null)
      if (!this.rooms.has(room.id) || seat === -1 || room.status !== 'waiting') throw new AppError('匹配失败，请重试')
      room.seats[seat] = member
      this.userRoom.set(userId, room.id)
    } else {
      room = await this.createRoom(userId, hall, true, true)
      const created = room
      this.setPhaseTimer(created, this.timings.matchMs, () => this.fillAndStart(created))
    }
    if (room.seats.every((member) => member !== null)) await this.fillAndStart(room)
    else this.broadcast(room)
  }

  private async fillAndStart(room: Room): Promise<void> {
    if (!room.matching || room.status !== 'waiting') return
    room.matching = false
    room.seats.forEach((member, seat) => {
      if (!member) room.seats[seat] = this.botMember(this.random() < 0.5 ? 'normal' : 'hard', room)
    })
    try {
      await this.startGame(room)
    } catch {
      // 有人金币不足等：退回普通等待房，由房主处理
      this.clearRoomTimers(room)
      room.deadlineAt = null
      this.broadcast(room)
    }
  }

  /** 观战公开牌桌：只能看到公开信息（公牌、已亮出的牌、分数） */
  private async doSpectate(userId: string, roomId: string): Promise<void> {
    const room = this.rooms.get(String(roomId).trim())
    if (!room || room.isPrivate) throw new AppError('该牌桌不存在或不允许观战')
    if (room.seats.some((member) => member?.userId === userId)) throw new AppError('你就在这桌牌局中')
    if (room.spectators.size >= MAX_SPECTATORS) throw new AppError('观战人数已满')
    await this.releaseCurrentRoom(userId)
    const previous = this.watching.get(userId)
    if (previous) this.rooms.get(previous)?.spectators.delete(userId)
    if (!this.rooms.has(room.id)) throw new AppError('该牌桌已解散')
    room.spectators.add(userId)
    this.watching.set(userId, room.id)
    this.hub.send(userId, { ev: 'room', room: this.viewFor(room, userId) })
  }

  private async doCreate(userId: string, hallId: string, isPrivate: boolean): Promise<void> {
    await this.releaseCurrentRoom(userId)
    const hall = await this.requireHall(hallId, userId)
    const room = await this.createRoom(userId, hall, Boolean(isPrivate))
    this.broadcast(room)
    this.broadcastLobbySoon()
  }

  private async doJoin(userId: string, roomId: string): Promise<void> {
    const room = this.rooms.get(String(roomId).trim())
    if (!room) throw new AppError('房间不存在或已解散')
    if (this.userRoom.get(userId) === room.id) {
      this.broadcast(room)
      return
    }
    if (room.status !== 'waiting') throw new AppError(room.status === 'playing' ? '该房间正在对局中' : '该房间暂时无法加入')
    const seat = room.seats.findIndex((member) => member === null)
    if (seat === -1) throw new AppError('房间已满')
    await this.releaseCurrentRoom(userId)
    await this.requireHall(room.hall.id, userId)
    if (!this.rooms.has(room.id) || room.status !== 'waiting' || room.seats[seat] !== null) throw new AppError('该房间暂时无法加入')
    room.seats[seat] = await this.humanMember(userId)
    this.userRoom.set(userId, room.id)
    this.broadcast(room)
    this.broadcastLobbySoon()
  }

  private async doLeave(userId: string): Promise<void> {
    const watched = this.watching.get(userId)
    if (watched) {
      const watchedRoom = this.rooms.get(watched)
      if (watchedRoom) this.dropSpectator(watchedRoom, userId)
      this.watching.delete(userId)
      if (!this.userRoom.has(userId)) {
        this.hub.send(userId, { ev: 'room', room: null })
        this.hub.send(userId, { ev: 'lobby', lobby: this.lobbyState() })
        return
      }
    }
    const room = this.roomOf(userId)
    this.userRoom.delete(userId)
    this.clearIdleTimer(userId)
    this.hub.send(userId, { ev: 'room', room: null })
    if (!room) return
    const seat = room.seats.findIndex((member) => member?.userId === userId)
    if (seat === -1) return

    if (room.status === 'playing') {
      // 对局中离开：转为托管，结算照常进行
      const member = room.seats[seat] as Member
      member.away = true
      this.scheduleAutoPick(room, seat, 600)
      this.broadcast(room)
    } else {
      room.seats[seat] = null
      await this.afterSeatsChanged(room)
    }
    this.hub.send(userId, { ev: 'lobby', lobby: this.lobbyState() })
    this.broadcastLobbySoon()
  }

  /** 有人离座后：没有真人则解散，否则移交房主 */
  private async afterSeatsChanged(room: Room): Promise<void> {
    const humans = room.seats.filter((member) => member && !member.isBot) as Member[]
    if (humans.length === 0) {
      this.destroyRoom(room)
      return
    }
    const host = room.seats[room.hostSeat]
    if (!host || host.isBot) room.hostSeat = room.seats.findIndex((member) => member && !member.isBot)
    if (room.status === 'finished') await this.maybeRestart(room)
    this.broadcast(room)
  }

  private destroyRoom(room: Room): void {
    this.clearRoomTimers(room)
    for (const userId of room.spectators) {
      this.watching.delete(userId)
      this.hub.send(userId, { ev: 'room', room: null })
    }
    room.spectators.clear()
    if (room.persisted) {
      room.persisted = false
      void this.accounts.store.deleteRoom(room.id).catch(() => {})
    }
    for (const member of room.seats) {
      if (member && !member.isBot && this.userRoom.get(member.userId) === room.id) {
        this.userRoom.delete(member.userId)
        this.hub.send(member.userId, { ev: 'room', room: null })
      }
    }
    this.rooms.delete(room.id)
    this.broadcastLobbySoon()
  }

  private requireHostRoom(userId: string): Room {
    const room = this.roomOf(userId)
    if (!room) throw new AppError('你不在房间中')
    if (room.seats[room.hostSeat]?.userId !== userId) throw new AppError('只有房主可以操作')
    if (room.status === 'playing') throw new AppError('对局进行中，无法操作')
    if (room.matching) throw new AppError('正在匹配中，请稍候')
    return room
  }

  private async doAddBot(userId: string, level: BotLevel): Promise<void> {
    if (!BOT_LEVELS.includes(level)) throw new AppError('机器人难度无效')
    const room = this.requireHostRoom(userId)
    const seat = room.seats.findIndex((member) => member === null)
    if (seat === -1) throw new AppError('房间已满')
    room.seats[seat] = this.botMember(level, room)
    if (room.status === 'finished') await this.maybeRestart(room)
    this.broadcast(room)
    this.broadcastLobbySoon()
  }

  private doKick(userId: string, seat: number): void {
    const room = this.requireHostRoom(userId)
    const target = room.seats[seat]
    if (!target || target.userId === userId) throw new AppError('无法移出该座位')
    room.seats[seat] = null
    if (!target.isBot) {
      this.userRoom.delete(target.userId)
      this.hub.send(target.userId, { ev: 'room', room: null })
      this.hub.send(target.userId, { ev: 'notice', text: '你已被房主请出房间' })
    }
    this.broadcast(room)
    this.broadcastLobbySoon()
  }

  private async doStart(userId: string): Promise<void> {
    const room = this.requireHostRoom(userId)
    if (room.status !== 'waiting') throw new AppError('请等待所有玩家准备')
    await this.startGame(room)
  }

  /** 结算后"再来一局"：全员准备则直接开局；缺人则回到等待状态 */
  private async doAgain(userId: string): Promise<void> {
    const room = this.roomOf(userId)
    if (!room) throw new AppError('房间已解散')
    if (room.status !== 'finished') {
      this.broadcast(room)
      return
    }
    const member = room.seats.find((item) => item?.userId === userId)
    if (!member) throw new AppError('你不在房间中')
    const user = await this.accounts.requireUser(userId)
    if (user.coins < room.hall.minCoins) {
      throw new AppError(`金币不足：${room.hall.name}至少需要 ${formatCoins(room.hall.minCoins)} 金币`)
    }
    member.ready = true
    await this.maybeRestart(room)
    this.broadcast(room)
  }

  private async maybeRestart(room: Room): Promise<void> {
    if (room.status !== 'finished') return
    const members = room.seats.filter(Boolean) as Member[]
    if (!members.every((member) => member.ready)) return
    if (members.length === PLAYER_COUNT) {
      try {
        await this.startGame(room)
        return
      } catch {
        // 有人金币不足等：退回等待状态，由房主处理
      }
    }
    room.status = 'waiting'
    room.game = null
    room.settlement = null
    room.deadlineAt = null
    this.clearRoomTimers(room)
    this.broadcastLobbySoon()
  }

  // ------------------------------ 对局流程 ------------------------------

  private clearRoomTimers(room: Room): void {
    if (room.phaseTimer) clearTimeout(room.phaseTimer)
    room.phaseTimer = null
    room.autoTimers.forEach((timer) => clearTimeout(timer))
    room.autoTimers.clear()
  }

  private setPhaseTimer(room: Room, ms: number, fn: () => void | Promise<void>): void {
    if (room.phaseTimer) clearTimeout(room.phaseTimer)
    room.deadlineAt = Date.now() + ms
    room.phaseTimer = setTimeout(() => {
      room.phaseTimer = null
      this.guard(room, fn)
    }, ms)
  }

  /** 定时器回调：排队执行并统一兜底，避免异常导致进程退出 */
  private guard(room: Room, fn: () => void | Promise<void>): void {
    void this.run(async () => {
      if (!this.rooms.has(room.id)) return
      try {
        await fn()
      } catch (error) {
        console.error(`[room ${room.id}]`, error)
      }
    })
  }

  private async startGame(room: Room): Promise<void> {
    const members = room.seats as Member[]
    if (room.seats.some((member) => member === null)) throw new AppError('需要 3 名玩家才能开始，可添加机器人补位')
    for (const member of members) {
      if (member.isBot) continue
      const user = await this.accounts.requireUser(member.userId)
      member.coins = user.coins
      member.honor = user.honor
      member.nickname = user.nickname
      member.avatar = user.avatar
      member.frame = user.frame || ''
      if (user.coins < room.hall.minCoins) throw new AppError(`${member.nickname} 的金币不足，无法开始`)
    }
    if (room.seats.some((member) => member === null) || room.status === 'playing') throw new AppError('牌桌状态已变化，请重试')
    this.clearRoomTimers(room)
    room.matching = false
    members.forEach((member) => { member.ready = member.isBot })
    room.game = createGame(members.map((member) => member.userId), this.random)
    room.settlement = null
    room.status = 'playing'
    this.beginRound(room)
    this.broadcastLobbySoon()
  }

  private beginRound(room: Room): void {
    const game = room.game as GameState
    if (isSelectionRound(game.round)) {
      this.setPhaseTimer(room, this.timings.pickMs, () => this.onPickTimeout(room))
      room.seats.forEach((member, seat) => {
        if (!member) return
        if (member.isBot) {
          const { botMinMs, botMaxMs } = this.timings
          this.scheduleAutoPick(room, seat, botMinMs + this.random() * (botMaxMs - botMinMs))
        } else if (member.away) {
          this.scheduleAutoPick(room, seat, 900)
        } else if (!this.hub.isOnline(member.userId)) {
          this.scheduleAutoPick(room, seat, this.timings.offlineGraceMs)
        }
      })
    } else {
      // 最终轮：无需选牌，稍作停顿后直接亮牌
      this.setPhaseTimer(room, this.timings.finalMs, () => this.settle(room))
    }
    this.broadcast(room)
  }

  private scheduleAutoPick(room: Room, seat: number, delayMs: number): void {
    const game = room.game
    if (!game || room.status !== 'playing' || game.phase !== 'selecting' || !isSelectionRound(game.round)) return
    const round = game.round
    const timer = setTimeout(() => {
      room.autoTimers.delete(timer)
      this.guard(room, () => {
        const member = room.seats[seat]
        if (!member || room.game !== game || game.round !== round || game.phase !== 'selecting') return
        if (game.players[seat].picked) return
        // 真人只有在仍然离线 / 已离开时才代打
        if (!member.isBot && !member.away && this.hub.isOnline(member.userId)) return
        this.autoPick(room, seat, !member.isBot)
        this.afterPick(room)
      })
    }, delayMs)
    room.autoTimers.add(timer)
  }

  private seenCards(game: GameState): Card[] {
    const seen: Card[] = game.publicCards.filter((_, index) => index !== HIDDEN_ROUND - 1 || game.results.length >= HIDDEN_ROUND)
    for (const result of game.results) for (const entry of result.entries) seen.push(...entry.cards)
    return seen
  }

  private autoPick(room: Room, seat: number, markAuto: boolean): void {
    const game = room.game as GameState
    const member = room.seats[seat] as Member
    const level: BotLevel = member.isBot ? member.botLevel ?? 'normal' : 'normal'
    const publicCard = game.round === HIDDEN_ROUND ? null : currentPublicCard(game)
    const peekHands = level === 'peek'
      ? game.players.filter((_, index) => index !== seat && room.seats[index] && !(room.seats[index] as Member).isBot).map((player) => player.hand)
      : undefined
    const cardIds = decidePick(
      { level, round: game.round, hand: game.players[seat].hand, publicCard, seen: this.seenCards(game), peekHands },
      this.random,
    )
    pickCards(game, seat, cardIds, markAuto)
  }

  private doPlay(userId: string, round: number, cardIds: string[]): void {
    const room = this.roomOf(userId)
    const game = room?.game
    if (!room || !game || room.status !== 'playing') throw new AppError('当前没有进行中的对局')
    const seat = room.seats.findIndex((member) => member?.userId === userId)
    if (seat === -1) throw new AppError('你不在这局游戏中')
    if (round !== game.round) {
      if (round < game.round) return
      throw new AppError('回合已更新，请重新选择')
    }
    if (!Array.isArray(cardIds)) throw new AppError('必须选择 2 张牌')
    try {
      pickCards(game, seat, cardIds.map(String))
    } catch (error) {
      throw new AppError((error as Error).message)
    }
    this.afterPick(room)
  }

  private afterPick(room: Room): void {
    const game = room.game as GameState
    if (allPicked(game)) this.settle(room)
    else this.broadcast(room)
  }

  private onPickTimeout(room: Room): void {
    const game = room.game
    if (!game || game.phase !== 'selecting') return
    game.players.forEach((player, seat) => {
      if (!player.picked) this.autoPick(room, seat, true)
    })
    this.settle(room)
  }

  private settle(room: Room): void {
    const game = room.game as GameState
    if (game.phase !== 'selecting') return
    room.autoTimers.forEach((timer) => clearTimeout(timer))
    room.autoTimers.clear()
    const result = settleRound(game)
    const isFinal = game.round >= MAX_ROUNDS
    this.setPhaseTimer(room, isFinal ? this.timings.finalShowdownMs : this.timings.showdownMs, () => this.afterShowdown(room))
    this.broadcast(room)
    this.botBanter(room, result.losers, result.winners)
  }

  private async afterShowdown(room: Room): Promise<void> {
    const game = room.game as GameState
    if (game.phase !== 'showdown') return
    advanceRound(game)
    if ((game.phase as string) === 'finished') await this.finishGame(room)
    else this.beginRound(room)
  }

  private async finishGame(room: Room): Promise<void> {
    const game = room.game as GameState
    const members = room.seats as Member[]
    this.clearRoomTimers(room)
    room.deadlineAt = null
    room.status = 'finished'
    try {
      room.settlement = await this.accounts.settleMatch(
        room.hall,
        members.map((member, seat) => ({
          seat,
          userId: member.userId,
          nickname: member.nickname,
          avatar: member.avatar,
          isBot: member.isBot,
          total: game.players[seat].total,
          caught: game.results.filter((result) => result.losers.includes(seat)).length,
          leopards: game.results.filter((result) => result.entries[seat].evaluation.type === 'leopard').length,
        })),
        game.results.map((result) => ({
          round: result.round,
          deltas: result.entries.map((entry) => entry.delta),
          hands: result.entries.map((entry) => describeHand(entry.evaluation)),
        })),
      )
    } catch (error) {
      console.error(`[room ${room.id}] 结算失败`, error)
      room.settlement = []
    }

    for (const [seat, member] of members.entries()) {
      if (member.isBot) continue
      const user = await this.accounts.store.getUser(member.userId).catch(() => undefined)
      if (user) {
        member.coins = user.coins
        member.honor = user.honor
      }
      await this.pushProfile(member.userId)
      if (member.away) {
        // 托管玩家结算后离席
        if (this.userRoom.get(member.userId) === room.id) this.userRoom.delete(member.userId)
        room.seats[seat] = null
      } else if (!this.hub.isOnline(member.userId)) {
        this.startIdleTimer(member.userId)
      }
    }

    const humans = room.seats.filter((member) => member && !member.isBot)
    if (humans.length === 0) {
      this.destroyRoom(room)
      return
    }
    const host = room.seats[room.hostSeat]
    if (!host || host.isBot) room.hostSeat = room.seats.findIndex((member) => member && !member.isBot)
    this.broadcast(room)
    this.broadcastLobbySoon()
  }

  // ------------------------------ 互动 ------------------------------

  private doEmote(userId: string, key: string): void {
    const room = this.roomOf(userId)
    if (!room || !(key in EMOTES)) return
    const seat = room.seats.findIndex((member) => member?.userId === userId)
    if (seat !== -1) this.sendEmote(room, seat, key)
  }

  private sendEmote(room: Room, seat: number, key: string): void {
    for (const member of room.seats) {
      if (member && !member.isBot && !member.away) this.hub.send(member.userId, { ev: 'emote', seat, key })
    }
  }

  /** 机器人偶尔在亮牌后说句话，增添牌桌气氛 */
  private botBanter(room: Room, losers: number[], winners: number[]): void {
    const speak = (seats: number[], keys: string[], chance: number, delay: number) => {
      const bots = seats.filter((seat) => room.seats[seat]?.isBot)
      if (bots.length === 0 || this.random() > chance) return
      const seat = bots[Math.floor(this.random() * bots.length)]
      const key = keys[Math.floor(this.random() * keys.length)]
      const timer = setTimeout(() => {
        room.autoTimers.delete(timer)
        if (this.rooms.has(room.id) && room.seats[seat]?.isBot) this.sendEmote(room, seat, key)
      }, delay)
      room.autoTimers.add(timer)
    }
    speak(losers, ['unlucky', 'nice'], 0.3, 4200)
    speak(winners, ['caught', 'thanks', 'laugh'], 0.3, 4800)
  }

  // ------------------------------ 连接状态 ------------------------------

  /** 用户上线：恢复其所在房间的视图 */
  private doOnConnect(userId: string): void {
    this.clearIdleTimer(userId)
    const room = this.roomOf(userId)
    if (room) {
      const member = room.seats.find((item) => item?.userId === userId)
      if (member) member.away = false
      this.broadcast(room)
    } else {
      this.hub.send(userId, { ev: 'room', room: null })
      this.hub.send(userId, { ev: 'lobby', lobby: this.lobbyState() })
    }
    this.broadcastLobbySoon()
  }

  private doOnDisconnect(userId: string): void {
    const watched = this.watching.get(userId)
    if (watched) {
      const watchedRoom = this.rooms.get(watched)
      if (watchedRoom) this.dropSpectator(watchedRoom, userId)
      this.watching.delete(userId)
    }
    const room = this.roomOf(userId)
    if (room) {
      if (room.status === 'playing') {
        const seat = room.seats.findIndex((member) => member?.userId === userId)
        this.scheduleAutoPick(room, seat, this.timings.offlineGraceMs)
      } else {
        this.startIdleTimer(userId)
      }
      this.broadcast(room)
    }
    this.broadcastLobbySoon()
  }

  /** 非对局状态下离线过久：自动离开房间 */
  private startIdleTimer(userId: string): void {
    this.clearIdleTimer(userId)
    const timer = setTimeout(() => {
      this.idleTimers.delete(userId)
      const room = this.roomOf(userId)
      if (room && room.status !== 'playing' && !this.hub.isOnline(userId)) void this.leave(userId).catch(() => {})
    }, this.timings.idleKickMs)
    timer.unref?.()
    this.idleTimers.set(userId, timer)
  }

  private clearIdleTimer(userId: string): void {
    const timer = this.idleTimers.get(userId)
    if (timer) clearTimeout(timer)
    this.idleTimers.delete(userId)
  }

  shutdown(): void {
    for (const room of this.rooms.values()) this.clearRoomTimers(room)
    this.idleTimers.forEach((timer) => clearTimeout(timer))
    if (this.lobbyTimer) clearTimeout(this.lobbyTimer)
  }

  /** 好友列表用：某玩家当前所在的公开牌桌 */
  publicRoomOf(userId: string): { id: string; status: RoomStatus; joinable: boolean } | null {
    const room = this.roomOf(userId)
    if (!room || room.isPrivate) return null
    return { id: room.id, status: room.status, joinable: room.status === 'waiting' && room.seats.some((member) => member === null) }
  }

  /** 供测试使用 */
  get roomCount(): number {
    return this.rooms.size
  }
}

export { HALLS }
