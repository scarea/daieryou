// Cloudflare Workers 入口：所有接口与 WebSocket 都交给同一个 Durable Object（GameServer）。
// GameServer 与 Node 版共用 src/server/app.ts：单线程、房间在内存、数据经 Hyperdrive 存入 Supabase Postgres。
import { DurableObject } from 'cloudflare:workers'
import { AppError } from '../server/accounts.ts'
import { CORS_HEADERS, createApp } from '../server/app.ts'
import { setBotBudget } from '../server/bot.ts'
import { PgStore } from '../server/pgStore.ts'

interface Env {
  GAME: DurableObjectNamespace<GameServer>
  HYPERDRIVE?: { connectionString: string }
  DATABASE_URL?: string
  BOT_SIM_SCALE?: string
  PASSWORD_HASH_ITERATIONS?: string
  ADMIN_KEY?: string
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...CORS_HEADERS },
  })

export class GameServer extends DurableObject<Env> {
  private startedAt = Date.now()
  private store: PgStore | null = null
  private app: ReturnType<typeof createApp> | null = null
  private ready: Promise<void>
  private lastError = ''
  private lastAttemptAt = 0

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    setBotBudget(Number(env.BOT_SIM_SCALE) || 0.35)
    this.ready = this.connectDatabase()
  }

  /** 连接数据库并同步表结构；失败后按间隔重试（数据库暂停后恢复等） */
  private async connectDatabase(): Promise<void> {
    this.lastAttemptAt = Date.now()
    const hyperdriveUrl = this.env.HYPERDRIVE?.connectionString
    const connectionString = hyperdriveUrl || this.env.DATABASE_URL
    if (!connectionString) {
      this.lastError = '未配置数据库'
      return
    }
    try {
      // Hyperdrive 负责到 Supabase 的 TLS 与连接池，Worker 到 Hyperdrive 是内部链路
      const store = PgStore.create(connectionString, !hyperdriveUrl)
      await store.migrate()
      this.store = store
      this.app = createApp(store, { hashIterations: Number(this.env.PASSWORD_HASH_ITERATIONS) || 20000, adminKey: this.env.ADMIN_KEY || '' })
      const restored = await this.app.rooms.restore().catch(() => 0)
      if (restored > 0) console.log(`已恢复 ${restored} 桌未打完的对局`)
      this.lastError = ''
    } catch (error) {
      this.lastError = `${(error as { code?: string }).code || (error as Error).name}: ${(error as Error).message}`
      console.error('Postgres 连接失败:', this.lastError)
    }
  }

  private async ensureApp(): Promise<ReturnType<typeof createApp> | null> {
    await this.ready
    if (!this.app && Date.now() - this.lastAttemptAt > 15000) {
      this.ready = this.connectDatabase()
      await this.ready
    }
    return this.app
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const app = await this.ensureApp()

    if (url.pathname === '/healthz') {
      let database = app ? 'postgres' : 'unavailable'
      if (this.store) await this.store.ping().catch(() => { database = 'unreachable' })
      return json(200, {
        ok: Boolean(app),
        runtime: 'cloudflare-durable-object',
        uptimeSeconds: Math.round((Date.now() - this.startedAt) / 1000),
        database,
        online: app?.onlineCount() ?? 0,
        error: this.lastError || undefined,
      })
    }
    if (!app) return json(503, { error: '服务器正在启动，请稍后再试' })

    if (request.headers.get('Upgrade') === 'websocket') {
      if (url.pathname !== '/ws') return new Response('not found', { status: 404 })
      const pair = new WebSocketPair()
      const [client, server] = Object.values(pair)
      server.accept()
      const session = app.attach({
        send: (text) => server.send(text),
        close: (code, reason) => server.close(code, reason),
      })
      let closed = false
      const close = () => {
        if (closed) return
        closed = true
        session.onClose()
      }
      server.addEventListener('message', (event) => {
        const data = typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data as ArrayBuffer)
        if (data.length > 16 * 1024) return
        void session.onMessage(data)
      })
      server.addEventListener('close', close)
      server.addEventListener('error', close)
      return new Response(null, { status: 101, webSocket: client })
    }

    const header = request.headers.get('Authorization') || ''
    const response = await app.handleHttp({
      method: request.method,
      path: url.pathname,
      query: url.searchParams,
      token: header.startsWith('Bearer ') ? header.slice(7) : '',
      ip: request.headers.get('CF-Connecting-IP') || undefined,
      body: async () => {
        const text = await request.text()
        if (text.length > 16 * 1024) throw new AppError('请求内容过大', 413)
        if (!text) return {}
        try {
          const parsed = JSON.parse(text)
          return parsed && typeof parsed === 'object' ? parsed : {}
        } catch {
          throw new AppError('请求格式错误')
        }
      },
    })
    return response ? json(response.status, response.body) : json(404, { error: '接口不存在' })
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS })
    if (url.pathname === '/') return json(200, { ok: true, service: 'daieryou-royale-game-server' })
    const routed = url.pathname === '/healthz' || url.pathname === '/ws' || url.pathname.startsWith('/api/')
    if (!routed) return json(404, { error: 'not found' })
    return env.GAME.get(env.GAME.idFromName('main')).fetch(request)
  },

  // 定时触发：访问一次数据库，防止 Supabase 免费项目 7 天无访问被暂停
  async scheduled(_event: unknown, env: Env, ctx: { waitUntil(promise: Promise<unknown>): void }): Promise<void> {
    ctx.waitUntil(env.GAME.get(env.GAME.idFromName('main')).fetch('https://royale.internal/healthz'))
  },
}
