// Cloudflare Workers 入口：所有 WebSocket 连接都交给同一个 Durable Object（GameServer）处理。
// GameServer 与 Node 版 app.js 共用同一套服务与消息网关：单线程、房间在内存、定时器做超时。
import { DurableObject } from 'cloudflare:workers'
import runtimeConfigModule from '../src/config/runtimeConfig.js'
import createAppContextModule from '../src/application/createAppContext.js'
import appContextHolderModule from '../src/application/appContextHolder.js'
import pgDatabaseModule from '../src/infrastructure/postgres/pgDatabase.js'
import pgRepositoriesModule from '../src/infrastructure/postgres/pgRepositories.js'
import gatewayModule from '../src/gateway/gateway.js'
import createEntryHandler from '../app/servers/connector/handler/entryHandler.js'
import createRoomHandler from '../app/servers/game/handler/roomHandler.js'
import createGameHandler from '../app/servers/game/handler/gameHandler.js'

const { loadRuntimeConfig } = runtimeConfigModule
const { createAppContext } = createAppContextModule
const { setAppContext } = appContextHolderModule
const { PgDatabase } = pgDatabaseModule
const {
  PgAccountRepository,
  PgInviteCodeRepository,
  PgAdminAuditRepository,
  PgBattleRecordRepository,
} = pgRepositoriesModule
const { createGateway } = gatewayModule

const GAME_SERVER_NAME = 'main'
const CORS_HEADERS = { 'access-control-allow-origin': '*' }

// Worker 的 env 里同时有字符串变量、密钥和绑定对象，运行时配置只需要字符串
function toStringEnv(env) {
  const result = {}
  Object.entries(env || {}).forEach(([key, value]) => {
    if (typeof value === 'string') {
      result[key] = value
    }
  })
  return result
}

export class GameServer extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env)
    this.startedAt = Date.now()
    this.runtimeConfig = loadRuntimeConfig(toStringEnv(env))
    // 优先使用 Hyperdrive：它负责与 Supabase 的 TLS（verify-ca，校验 Supabase 私有 CA）和连接池，
    // Worker 到 Hyperdrive 走 Cloudflare 内部链路，无需再配置 TLS。
    const hyperdriveUrl = env.HYPERDRIVE?.connectionString
    const connectionString = hyperdriveUrl || this.runtimeConfig.databaseUrl
    this.pgDatabase = connectionString
      ? new PgDatabase({
        connectionString,
        ssl: hyperdriveUrl ? 'disable' : this.runtimeConfig.databaseSsl,
        max: 3,
      })
      : null
    this.databaseVia = hyperdriveUrl ? 'hyperdrive' : 'direct'

    // 未配置数据库时仓库照常创建（database 为空），账号/战绩相关请求会提示“暂不可用”，游客模式不受影响
    this.appContext = setAppContext(createAppContext({
      runtimeConfig: this.runtimeConfig,
      pgDatabase: this.pgDatabase,
      accountRepository: new PgAccountRepository({ database: this.pgDatabase }),
      inviteCodeRepository: new PgInviteCodeRepository({ database: this.pgDatabase }),
      adminAuditRepository: new PgAdminAuditRepository({ database: this.pgDatabase }),
      battleRecordRepository: new PgBattleRecordRepository({ database: this.pgDatabase }),
    }))
    this.gateway = createGateway({
      appContext: this.appContext,
      handlers: {
        entryHandler: createEntryHandler(),
        roomHandler: createRoomHandler(),
        gameHandler: createGameHandler(),
      },
    })
    this.ready = this.initialize()
  }

  async initialize() {
    if (this.pgDatabase) {
      try {
        await this.pgDatabase.connect({ migrate: this.runtimeConfig.databaseAutoMigrate })
        console.log('Postgres 连接成功（表结构已同步）')
        await this.pgDatabase.heartbeat('cloudflare-game-server')
      } catch (error) {
        console.log('Postgres 连接失败，邮箱账号与战绩功能不可用（游客模式仍可用）:', error.message)
      }
    }
    this.appContext.roomLifecycleService.start()
    this.appContext.battleRecordLifecycleService.start()
  }

  async ensureDatabase() {
    if (this.pgDatabase && !this.pgDatabase.isReady()) {
      const connected = await this.pgDatabase.ensureConnected({ migrate: this.runtimeConfig.databaseAutoMigrate })
      if (connected) {
        console.log('Postgres 重连成功')
      }
    }
  }

  databaseStatus() {
    if (!this.pgDatabase) {
      return 'none'
    }
    return this.pgDatabase.isReady() ? 'postgres' : 'postgres-unavailable'
  }

  async fetch(request) {
    const url = new URL(request.url)
    if (url.pathname === '/healthz') {
      await this.ready
      await this.ensureDatabase()
      // 顺带写一次数据库心跳：外部保活访问 /healthz 时，Supabase 也会保持活跃
      if (this.pgDatabase?.isReady()) {
        await this.pgDatabase.heartbeat('cloudflare-game-server').catch(() => {})
      }
      return Response.json({
        ok: true,
        runtime: 'cloudflare-durable-object',
        uptimeSeconds: Math.round((Date.now() - this.startedAt) / 1000),
        database: this.databaseStatus(),
        databaseVia: this.pgDatabase ? this.databaseVia : undefined,
        databaseError: this.pgDatabase && !this.pgDatabase.isReady() ? this.pgDatabase.lastError : undefined,
      }, { headers: { 'cache-control': 'no-store', ...CORS_HEADERS } })
    }

    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('expected websocket', { status: 426 })
    }

    await this.ready
    await this.ensureDatabase()
    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair)
    server.accept()

    const connection = this.gateway.openSession(server)
    let closed = false
    const close = () => {
      if (closed) {
        return
      }
      closed = true
      connection.handleClose()
    }
    server.addEventListener('message', (event) => {
      const data = typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data)
      connection.handleMessage(data)
    })
    server.addEventListener('close', close)
    server.addEventListener('error', close)

    return new Response(null, { status: 101, webSocket: client })
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const isWebSocket = request.headers.get('Upgrade') === 'websocket'
    if (url.pathname !== '/healthz' && url.pathname !== '/' && !isWebSocket) {
      return new Response('not found', { status: 404 })
    }
    if (url.pathname === '/' && !isWebSocket) {
      return Response.json({ ok: true, service: 'daieryou-game-server' }, { headers: CORS_HEADERS })
    }

    const stub = env.GAME.get(env.GAME.idFromName(GAME_SERVER_NAME))
    return stub.fetch(request)
  },
}
