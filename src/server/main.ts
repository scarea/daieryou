// Node 入口：HTTP（接口 + 静态资源）与 WebSocket，数据存本地 SQLite。
import { createServer, IncomingMessage, ServerResponse } from 'node:http'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, extname, join, normalize, resolve } from 'node:path'
import { WebSocketServer, WebSocket } from 'ws'
import { AppError } from './accounts.ts'
import { CORS_HEADERS, createApp } from './app.ts'
import { SqliteStore } from './sqliteStore.ts'

const PORT = Number(process.env.SERVER_PORT || process.env.PORT || 8787)
const DB_PATH = process.env.DB_PATH || resolve('data/daieryou.db')
const DIST_DIR = resolve('dist')

const store = new SqliteStore(DB_PATH)
/** 加密用户 API Key 的密钥：优先用环境变量，否则在数据目录里生成并保存一份 */
function loadDataKey(): string {
  if (process.env.DATA_KEY) return process.env.DATA_KEY
  const file = join(dirname(DB_PATH), '.data-key')
  if (existsSync(file)) return readFileSync(file, 'utf8').trim()
  const key = randomBytes(32).toString('hex')
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, key, { mode: 0o600 })
  return key
}

const app = createApp(store, { adminKey: process.env.ADMIN_KEY || '', dataKey: loadDataKey() })

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolveBody, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > 16 * 1024) {
        reject(new AppError('请求内容过大', 413))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (chunks.length === 0) return resolveBody({})
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        resolveBody(parsed && typeof parsed === 'object' ? parsed : {})
      } catch {
        reject(new AppError('请求格式错误'))
      }
    })
    req.on('error', reject)
  })
}

function serveStatic(res: ServerResponse, pathname: string): void {
  if (!existsSync(DIST_DIR)) {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('逮二游 · 金殿 游戏服务器运行中。开发模式请访问 Vite 前端地址；生产模式请先执行 npm run build。')
    return
  }
  const safePath = normalize(pathname).replace(/^(\.\.[/\\])+/, '')
  let file = join(DIST_DIR, safePath)
  if (!file.startsWith(DIST_DIR) || !existsSync(file) || statSync(file).isDirectory()) file = join(DIST_DIR, 'index.html')
  const type = MIME[extname(file)] || 'application/octet-stream'
  const immutable = file.includes(`${DIST_DIR}/assets/`)
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache' })
  res.end(readFileSync(file))
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://localhost')
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS)
    res.end()
    return
  }
  const header = req.headers.authorization || ''
  const response = await app.handleHttp({
    method: req.method || 'GET',
    path: url.pathname,
    query: url.searchParams,
    token: header.startsWith('Bearer ') ? header.slice(7) : '',
    ip: req.socket.remoteAddress || undefined,
    body: () => readBody(req),
  })
  if (!response) return serveStatic(res, url.pathname)
  res.writeHead(response.status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...CORS_HEADERS })
  res.end(JSON.stringify(response.body))
})

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 })
const alive = new WeakMap<WebSocket, boolean>()

wss.on('connection', (socket) => {
  alive.set(socket, true)
  const session = app.attach({
    send: (text) => { if (socket.readyState === WebSocket.OPEN) socket.send(text) },
    close: (code, reason) => socket.close(code, reason),
  })
  socket.on('pong', () => alive.set(socket, true))
  socket.on('message', (raw) => void session.onMessage(raw.toString()))
  socket.on('close', () => session.onClose())
  socket.on('error', () => socket.terminate())
})

// 心跳：清理掉线连接
const heartbeat = setInterval(() => {
  for (const socket of wss.clients) {
    if (alive.get(socket) === false) {
      socket.terminate()
      continue
    }
    alive.set(socket, false)
    socket.ping()
  }
}, 25000)
const purge = setInterval(() => void store.purgeExpiredSessions().catch(() => {}), 6 * 3600 * 1000)
heartbeat.unref()
purge.unref()

server.listen(PORT, () => {
  void app.rooms.restore().then((count) => { if (count > 0) console.log(`  已恢复 ${count} 桌未打完的对局`) }).catch(() => {})
  console.log(`\n  逮二游 · 金殿  游戏服务器已启动  →  http://localhost:${PORT}\n`)
})

function shutdown(): void {
  app.rooms.shutdown()
  app.mahjong.shutdown()
  app.liuhu.shutdown()
  clearInterval(heartbeat)
  wss.clients.forEach((socket) => socket.terminate())
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 1500).unref()
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
