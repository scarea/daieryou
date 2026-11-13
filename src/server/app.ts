// 与运行环境无关的应用层：HTTP 接口路由 + WebSocket 会话。
// Node（main.ts）和 Cloudflare Durable Object（worker/index.ts）共用这一套。
import type { AdminUser, ClientMessage, FriendInfo, ServerEvent } from '../shared/protocol.ts'
import { SHOP_ITEMS } from '../shared/shop.ts'
import { Accounts, AppError } from './accounts.ts'
import { MahjongManager, MjTimings } from './mahjong.ts'
import { Hub, RoomManager, RoomTimings } from './rooms.ts'
import type { Store, UserRow } from './store.ts'

export interface SocketLike {
  send(text: string): void
  close(code?: number, reason?: string): void
}

export interface HttpRequest {
  method: string
  path: string
  query: URLSearchParams
  token: string
  /** 客户端 IP（用于注册防刷） */
  ip?: string
  /** 读取 JSON 请求体（已限制大小） */
  body(): Promise<Record<string, unknown>>
}

export interface HttpResponse {
  status: number
  body: unknown
}

interface Connection {
  socket: SocketLike
  userId: string | null
  windowStart: number
  count: number
}

export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Max-Age': '86400',
}

export function createApp(store: Store, options: { hashIterations?: number; timings?: RoomTimings; adminKey?: string; dataKey?: string; mjTimings?: MjTimings } = {}) {
  const accounts = new Accounts(store, options.hashIterations, options.adminKey, options.dataKey)
  const connections = new Map<string, Connection>()

  const hub: Hub = {
    send(userId, event) {
      const connection = connections.get(userId)
      if (!connection) return
      try {
        connection.socket.send(JSON.stringify(event))
      } catch {
        // 连接已断开：等待 close 事件清理
      }
    },
    isOnline: (userId) => connections.has(userId),
    onlineUserIds: () => [...connections.keys()],
  }
  const rooms = new RoomManager(accounts, hub, options.timings)
  const mahjong = new MahjongManager(accounts, hub, options.mjTimings)
  // 两个游戏的牌桌服务互相打通：大厅列表合并、房号不重复、一个人只在一张桌上
  rooms.extraLobbyRooms = () => mahjong.lobbyRooms()
  rooms.busyElsewhere = (userId) => mahjong.has(userId)
  mahjong.onLobbyChange = () => rooms.refreshLobby()
  mahjong.idTaken = (id) => rooms.hasRoom(id)

  // ------------------------------ HTTP ------------------------------

  const requireAuth = async (request: HttpRequest): Promise<UserRow> => {
    const user = await accounts.authenticate(request.token)
    if (!user) throw new AppError('登录已失效，请重新登录', 401)
    return user
  }

  const requireAdmin = async (request: HttpRequest): Promise<UserRow> => accounts.requireAdmin((await requireAuth(request)).id)

  const toAdminUser = (row: UserRow): AdminUser => ({
    id: row.id, username: row.username, nickname: row.nickname, avatar: row.avatar, isGuest: row.is_guest === 1,
    isAdmin: row.is_admin === 1, banned: row.banned === 1, coins: row.coins, honor: row.honor, games: row.games,
    createdAt: row.created_at, lastLoginAt: row.last_login_at, online: connections.has(row.id),
  })

  /** 强制某用户下线（封禁、重置密码后） */
  const disconnect = (userId: string, reason: string): void => {
    const connection = connections.get(userId)
    if (!connection) return
    try {
      connection.socket.send(JSON.stringify({ ev: 'kicked', reason } satisfies ServerEvent))
      connection.socket.close(4002, 'kicked')
    } catch {
      // ignore
    }
  }

  const routes: Record<string, (request: HttpRequest) => Promise<unknown>> = {
    'POST /api/auth/register': async (request) => accounts.register(await request.body(), request.ip),
    'POST /api/auth/reset': async (request) => accounts.resetPassword(await request.body()),
    'POST /api/auth/login': async (request) => accounts.login(await request.body()),
    'POST /api/auth/guest': async (request) => accounts.guest(await request.body(), request.ip),
    'POST /api/auth/upgrade': async (request) => {
      const user = await requireAuth(request)
      const result = await accounts.upgrade(user.id, await request.body())
      hub.send(user.id, { ev: 'me', user: result.user })
      return result
    },
    'POST /api/auth/logout': async (request) => {
      await accounts.logout(request.token)
      return {}
    },
    'GET /api/me': async (request) => {
      const user = await requireAuth(request)
      const seasonReward = await accounts.touchSeason(user.id)
      return { user: await accounts.profile(user.id), signin: await accounts.signinStatus(user.id), seasonReward }
    },
    'POST /api/me/profile': async (request) => {
      const user = await requireAuth(request)
      return { user: await accounts.updateProfile(user.id, await request.body()) }
    },
    'POST /api/me/signin': async (request) => accounts.signin((await requireAuth(request)).id),
    'POST /api/me/relief': async (request) => accounts.relief((await requireAuth(request)).id),
    'GET /api/me/records': async (request) => ({ records: await store.listMatches((await requireAuth(request)).id, 30) }),
    'GET /api/me/ledger': async (request) => ({ items: await store.listLedger((await requireAuth(request)).id, 40) }),
    'GET /api/leaderboard': async (request) => {
      const user = await requireAuth(request)
      const kind = request.query.get('kind')
      const safeKind = kind === 'coins' || kind === 'wins' ? kind : 'honor'
      return { kind: safeKind, rows: await store.leaderboard(safeKind, 30), myRank: await store.rankOf(user.id, safeKind) }
    },
    'POST /api/me/recovery': async (request) => accounts.regenerateRecovery((await requireAuth(request)).id),
    'GET /api/me/growth': async (request) => accounts.growth((await requireAuth(request)).id),
    'POST /api/me/growth/claim': async (request) => {
      const user = await requireAuth(request)
      return accounts.claimGrowth(user.id, (await request.body()).id)
    },
    'POST /api/me/ai': async (request) => {
      const user = await requireAuth(request)
      return { user: await accounts.saveAiSettings(user.id, await request.body()) }
    },
    'POST /api/me/ai/test': async (request) => accounts.testAi((await requireAuth(request)).id),
    'POST /api/mahjong/review': async (request) => {
      const user = await requireAuth(request)
      const body = await request.body()
      return accounts.aiReview(user.id, body.matchId, body.analysis)
    },
    'GET /api/mahjong/match': async (request) => {
      const user = await requireAuth(request)
      const detail = await store.getMatchDetail(String(request.query.get('id') || ''), user.id)
      if (!detail || detail.game !== 'mahjong') throw new AppError('没有找到这一局牌', 404)
      return { record: detail.record, summary: detail.summary, players: detail.players }
    },
    'GET /api/shop': async () => ({ items: SHOP_ITEMS }),
    'POST /api/shop/buy': async (request) => {
      const user = await requireAuth(request)
      return { user: await accounts.buyItem(user.id, (await request.body()).id) }
    },
    'POST /api/shop/equip': async (request) => {
      const user = await requireAuth(request)
      const body = await request.body()
      return { user: await accounts.equipItem(user.id, body.kind, body.id) }
    },
    'GET /api/friends': async (request) => {
      const user = await requireAuth(request)
      const friends: FriendInfo[] = (await store.listFriends(user.id)).map((row) => ({
        id: row.id, nickname: row.nickname, avatar: row.avatar, frame: row.frame || '', honor: row.honor,
        online: connections.has(row.id), room: mahjong.publicRoomOf(row.id) ?? rooms.publicRoomOf(row.id),
      }))
      friends.sort((a, b) => Number(b.online) - Number(a.online))
      return { friends }
    },
    'POST /api/friends/add': async (request) => {
      const user = await requireAuth(request)
      await accounts.addFriend(user.id, await request.body())
      return {}
    },
    'POST /api/friends/remove': async (request) => {
      const user = await requireAuth(request)
      await store.removeFriend(user.id, String((await request.body()).userId))
      return {}
    },
    'POST /api/admin/claim': async (request) => {
      const user = await requireAuth(request)
      return { user: await accounts.claimAdmin(user.id, (await request.body()).key) }
    },
    'GET /api/admin/stats': async (request) => {
      await requireAdmin(request)
      return { ...(await accounts.adminStats()), online: connections.size, rooms: rooms.roomCount }
    },
    'GET /api/admin/users': async (request) => {
      await requireAdmin(request)
      return { users: (await store.searchUsers((request.query.get('q') || '').trim().slice(0, 40), 40)).map(toAdminUser) }
    },
    'POST /api/admin/grant': async (request) => {
      const admin = await requireAdmin(request)
      const body = await request.body()
      const row = await accounts.adminGrant(admin.id, body.userId, body.amount, body.reason)
      hub.send(row.id, { ev: 'me', user: await accounts.profile(row.id) })
      hub.send(row.id, { ev: 'notice', text: `金币变动：${Number(body.amount) > 0 ? '+' : ''}${Math.trunc(Number(body.amount))}（运营）` })
      return { user: toAdminUser(row) }
    },
    'POST /api/admin/ban': async (request) => {
      const admin = await requireAdmin(request)
      const body = await request.body()
      const row = await accounts.adminBan(admin.id, body.userId, body.banned)
      if (row.banned) disconnect(row.id, '账号已被封禁')
      return { user: toAdminUser(row) }
    },
    'POST /api/admin/reset-password': async (request) => {
      await requireAdmin(request)
      const userId = String((await request.body()).userId)
      const result = await accounts.adminResetPassword(userId)
      disconnect(userId, '密码已被重置，请重新登录')
      return result
    },
    'GET /api/health': async () => ({ ok: true, online: connections.size, rooms: rooms.roomCount }),
  }

  /** 处理 /api/* 请求；不是接口路径时返回 null */
  async function handleHttp(request: HttpRequest): Promise<HttpResponse | null> {
    if (!request.path.startsWith('/api/')) return null
    const handler = routes[`${request.method} ${request.path}`]
    if (!handler) return { status: 404, body: { error: '接口不存在' } }
    try {
      return { status: 200, body: (await handler(request)) ?? {} }
    } catch (error) {
      if (error instanceof AppError) return { status: error.status, body: { error: error.message } }
      console.error('[http]', error)
      return { status: 500, body: { error: '服务器开小差了，请稍后再试' } }
    }
  }

  // ------------------------------ WebSocket ------------------------------

  function handleOp(userId: string, message: ClientMessage): unknown {
    // 麻将桌与扑克房间互斥：一次只能在一张桌上
    if (message.op.startsWith('mj:')) {
      if (rooms.roomOf(userId)) throw new AppError('请先离开当前的牌桌')
    } else if (mahjong.has(userId) && ['quick', 'create', 'match', 'spectate'].includes(message.op)) {
      throw new AppError('请先离开麻将桌')
    }
    switch (message.op) {
      case 'mj:start':
        return mahjong.start(userId, String(message.hallId), message.level, message.options)
      case 'mj:match':
        return mahjong.match(userId, String(message.hallId))
      case 'mj:create':
        return mahjong.create(userId, String(message.hallId), Boolean(message.isPrivate), message.level, message.options)
      case 'mj:begin':
        return mahjong.beginByHost(userId)
      case 'mj:act':
        return mahjong.act(userId, message.action)
      case 'mj:next':
        return mahjong.next(userId)
      case 'mj:leave':
        return mahjong.leave(userId)
      case 'lobby':
        return rooms.lobbyState()
      case 'quick':
        return rooms.quick(userId, String(message.hallId), message.botLevel)
      case 'create':
        return rooms.create(userId, String(message.hallId), Boolean(message.isPrivate))
      case 'join': {
        // 房号在哪个游戏的牌桌服务里，就交给谁
        const roomId = String(message.roomId).trim()
        if (mahjong.hasRoom(roomId)) {
          if (rooms.roomOf(userId)) throw new AppError('请先离开当前的牌桌')
          return mahjong.join(userId, roomId)
        }
        if (mahjong.has(userId)) throw new AppError('请先离开麻将桌')
        return rooms.join(userId, roomId)
      }
      case 'match':
        return rooms.match(userId, String(message.hallId))
      case 'spectate':
        return rooms.spectate(userId, String(message.roomId))
      case 'leave':
        return rooms.leave(userId)
      case 'addBot':
        return rooms.addBot(userId, message.level)
      case 'kick':
        return rooms.kick(userId, Number(message.seat))
      case 'start':
        return rooms.start(userId)
      case 'again':
        return rooms.again(userId)
      case 'play':
        return rooms.play(userId, Number(message.round), message.cardIds)
      case 'emote':
        return rooms.emote(userId, String(message.key))
      case 'ping':
        return { now: Date.now() }
      default:
        throw new AppError('未知操作')
    }
  }

  /** 接入一条 WebSocket 连接，返回消息与关闭的处理函数 */
  function attach(socket: SocketLike) {
    const connection: Connection = { socket, userId: null, windowStart: Date.now(), count: 0 }
    const reply = (event: ServerEvent) => {
      try {
        socket.send(JSON.stringify(event))
      } catch {
        // ignore
      }
    }

    const onMessage = async (text: string): Promise<void> => {
      let message: ClientMessage
      try {
        message = JSON.parse(text)
      } catch {
        return
      }
      if (!message || typeof message !== 'object' || typeof message.op !== 'string') return
      const id = Number(message.id) || 0

      // 简单限流：每秒最多 30 条
      const now = Date.now()
      if (now - connection.windowStart > 1000) {
        connection.windowStart = now
        connection.count = 0
      }
      connection.count += 1
      if (connection.count > 30) return reply({ ev: 'res', id, ok: false, error: '操作过于频繁' })

      try {
        if (message.op === 'auth') {
          const user = await accounts.authenticate(message.token)
          if (!user) throw new AppError('登录已失效，请重新登录', 401)
          const previous = connections.get(user.id)
          if (previous && previous !== connection) {
            previous.userId = null
            try {
              previous.socket.send(JSON.stringify({ ev: 'kicked', reason: '账号已在其他地方登录' } satisfies ServerEvent))
              previous.socket.close(4001, 'replaced')
            } catch {
              // ignore
            }
          }
          connection.userId = user.id
          connections.set(user.id, connection)
          reply({ ev: 'res', id, ok: true, data: { user: await accounts.profile(user.id) } })
          await rooms.onConnect(user.id)
          mahjong.onConnect(user.id)
          return
        }
        if (!connection.userId) throw new AppError('请先登录', 401)
        const data = await handleOp(connection.userId, message)
        reply({ ev: 'res', id, ok: true, data })
      } catch (error) {
        if (!(error instanceof AppError)) console.error('[ws]', error)
        reply({ ev: 'res', id, ok: false, error: error instanceof AppError ? error.message : '服务器开小差了' })
      }
    }

    const onClose = (): void => {
      const userId = connection.userId
      if (userId && connections.get(userId) === connection) {
        connections.delete(userId)
        void rooms.onDisconnect(userId).catch(() => {})
        mahjong.onDisconnect(userId)
      }
    }

    return { onMessage, onClose }
  }

  return { accounts, rooms, mahjong, handleHttp, attach, onlineCount: () => connections.size }
}
