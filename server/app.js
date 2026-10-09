const http = require('node:http')
const WebSocket = require('ws')
const mongoose = require('mongoose')
const { appContext } = require('./src/application/appContext')
const { createGateway } = require('./src/gateway/gateway')

let databaseHeartbeatTimer = null

async function connectDatabase() {
  if (appContext.pgDatabase) {
    try {
      await appContext.pgDatabase.connect({ migrate: appContext.runtimeConfig.databaseAutoMigrate })
      console.log('Postgres 连接成功（表结构已同步）')
      startDatabaseHeartbeat()
    } catch (error) {
      console.log('Postgres 连接失败，邮箱账号与战绩功能不可用（游客模式仍可用）:', error.message)
    }
    return
  }

  if (appContext.runtimeConfig.skipMongo) {
    console.log('跳过 MongoDB 连接（DAIERYOU_SKIP_MONGO=true）')
    return
  }

  try {
    await mongoose.connect(appContext.runtimeConfig.mongoUri)
    console.log('MongoDB 连接成功')
  } catch (error) {
    console.log('MongoDB 连接失败，邮箱账号功能不可用（游客模式仍可用）:', error.message)
  }
}

// 定期写一次数据库心跳：免费托管的数据库（如 Supabase）长时间无访问会被暂停
function startDatabaseHeartbeat() {
  const beat = () => {
    appContext.pgDatabase.heartbeat('game-server', { pid: process.pid })
      .catch((error) => console.error('数据库心跳失败:', error.message))
  }
  beat()
  databaseHeartbeatTimer = setInterval(beat, appContext.runtimeConfig.databaseHeartbeatIntervalMs)
  if (typeof databaseHeartbeatTimer.unref === 'function') {
    databaseHeartbeatTimer.unref()
  }
}

async function restoreRoomsFromMirror() {
  if (!appContext.roomMirror) {
    return
  }

  const result = await appContext.roomMirror.restoreToRepository(appContext.roomRepository)
  if (result.enabled) {
    console.log(`Redis 房间镜像恢复完成，恢复房间数: ${result.restored}`)
  }
}

let roomMirrorSyncTimer = null
let roomMirrorWarmSyncAt = 0
let roomMirrorRetryTimer = null

function startRoomMirrorSyncTask() {
  if (!appContext.roomMirror?.enabled) {
    return
  }

  const intervalMs = appContext.runtimeConfig.roomMirror.syncIntervalMs
  if (!intervalMs || intervalMs <= 0) {
    return
  }
  if (roomMirrorSyncTimer) {
    return
  }

  const onlyMissing = !appContext.runtimeConfig.roomMirror.preferMirrorReads
  roomMirrorSyncTimer = setInterval(() => {
    appContext.roomRepository.syncFromMirror({ onlyMissing }).then((result) => {
      if (result.enabled && result.restored > 0) {
        console.log(`Redis 房间镜像增量恢复: ${result.restored}`)
      }
    }).catch((error) => {
      console.error('房间镜像增量恢复失败:', error.message)
    })
  }, intervalMs)

  if (typeof roomMirrorSyncTimer.unref === 'function') {
    roomMirrorSyncTimer.unref()
  }
}

function startRoomMirrorRetryTask() {
  if (!appContext.roomMirror?.enabled) {
    return
  }

  const intervalMs = appContext.runtimeConfig.roomMirror.retryIntervalMs
  if (!intervalMs || intervalMs <= 0) {
    return
  }
  if (roomMirrorRetryTimer) {
    return
  }

  roomMirrorRetryTimer = setInterval(() => {
    appContext.roomRepository.retryPendingMirrorOps({ maxOps: 100 }).then((result) => {
      if (result.retried > 0 || result.failed > 0) {
        console.log(`Redis 镜像重试: retried=${result.retried} failed=${result.failed} remaining=${result.remaining}`)
      }
    }).catch((error) => {
      console.error('房间镜像重试失败:', error.message)
    })
  }, intervalMs)

  if (typeof roomMirrorRetryTimer.unref === 'function') {
    roomMirrorRetryTimer.unref()
  }
}

async function maybeWarmSyncRoomsFromMirror(now = Date.now()) {
  if (!appContext.roomMirror?.enabled) {
    return
  }

  const intervalMs = appContext.runtimeConfig.roomMirror.syncIntervalMs
  if (!intervalMs || intervalMs <= 0) {
    return
  }
  if (now - roomMirrorWarmSyncAt < intervalMs) {
    return
  }

  roomMirrorWarmSyncAt = now
  const onlyMissing = !appContext.runtimeConfig.roomMirror.preferMirrorReads
  const result = await appContext.roomRepository.syncFromMirror({ onlyMissing })
  if (result.enabled && result.restored > 0) {
    console.log(`Redis 房间镜像按需恢复: ${result.restored}`)
  }
}

async function hydrateRoomForRequest(route, body, now = Date.now()) {
  if (!appContext.roomMirror?.enabled) {
    return
  }

  if (body && typeof body.roomId === 'string' && body.roomId.trim()) {
    const roomId = body.roomId.trim()
    const shouldForceMirrorRead = appContext.runtimeConfig.roomMirror.preferMirrorReads
      || !appContext.roomRepository.get(roomId)
    if (shouldForceMirrorRead) {
      const restoredRoom = await appContext.roomRepository.loadRoomFromMirror(roomId)
      if (restoredRoom) {
        console.log(`Redis 房间镜像按 roomId 恢复: ${roomId}`)
      }
    }
    return
  }

  const shouldWarmSync = route === 'game.roomHandler.getRoomList'
    || (route === 'connector.entryHandler.login' && typeof body?.sessionToken === 'string' && body.sessionToken.trim())

  if (shouldWarmSync) {
    await maybeWarmSyncRoomsFromMirror(now)
  }
}


const gateway = createGateway({
  appContext,
  handlers: {
    entryHandler: require('./app/servers/connector/handler/entryHandler')(),
    roomHandler: require('./app/servers/game/handler/roomHandler')(),
    gameHandler: require('./app/servers/game/handler/gameHandler')(),
  },
  hydrateRoomForRequest,
})

const startedAt = Date.now()

// HTTP 服务：/healthz 供平台健康检查与外部定时保活访问；其他路径一律 404。
// WebSocket 挂在同一个端口上（托管平台通常只开放一个端口）。
const httpServer = http.createServer((req, res) => {
  const pathname = (req.url || '').split('?')[0]
  if (req.method === 'GET' || req.method === 'HEAD') {
    if (pathname === '/healthz' || pathname === '/') {
      const body = JSON.stringify({
        ok: true,
        uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
        database: appContext.pgDatabase
          ? (appContext.pgDatabase.isReady() ? 'postgres' : 'postgres-unavailable')
          : (mongoose.connection.readyState === 1 ? 'mongodb' : 'none'),
      })
      res.writeHead(200, {
        'content-type': 'application/json',
        'cache-control': 'no-store',
        // 前端（另一个域名）启动时会先访问它来唤醒休眠的免费服务器
        'access-control-allow-origin': '*',
      })
      res.end(req.method === 'HEAD' ? undefined : body)
      return
    }
  }
  res.writeHead(404, { 'content-type': 'text/plain' })
  res.end('not found')
})

const wss = new WebSocket.Server({
  server: httpServer,
  maxPayload: appContext.runtimeConfig.maxWsPayloadBytes,
})

httpServer.listen(appContext.runtimeConfig.wsPort, () => {
  console.log('WebSocket 服务器启动成功，端口:', appContext.runtimeConfig.wsPort)
})

wss.on('connection', (ws) => {
  const connection = gateway.openSession(ws)
  ws.on('message', (data) => connection.handleMessage(data))
  ws.on('close', () => connection.handleClose())
  ws.on('error', (error) => {
    console.error('WebSocket 错误:', error)
  })
})

connectDatabase()
restoreRoomsFromMirror().catch((error) => {
  console.error('房间镜像恢复失败:', error.message)
})
startRoomMirrorSyncTask()
startRoomMirrorRetryTask()
appContext.roomLifecycleService.start()
appContext.battleRecordLifecycleService.start()

async function shutdown() {
  console.log('服务器正在关闭...')
  console.log('[gateway-metrics] snapshot:', JSON.stringify(gateway.buildGatewayMetricsSnapshot()))
  appContext.roomLifecycleService.stop()
  appContext.battleRecordLifecycleService.stop()
  if (databaseHeartbeatTimer) {
    clearInterval(databaseHeartbeatTimer)
    databaseHeartbeatTimer = null
  }
  if (appContext.pgDatabase) {
    appContext.pgDatabase.close().catch(() => {})
  }
  if (roomMirrorSyncTimer) {
    clearInterval(roomMirrorSyncTimer)
    roomMirrorSyncTimer = null
  }
  if (roomMirrorRetryTimer) {
    clearInterval(roomMirrorRetryTimer)
    roomMirrorRetryTimer = null
  }
  try {
    await appContext.roomMirror.shutdown()
  } catch (error) {
    console.error('房间镜像关闭失败:', error.message)
  }

  wss.close(() => {
    httpServer.close(() => process.exit(0))
  })

  const forceExitTimer = setTimeout(() => {
    process.exit(0)
  }, 1000)
  if (typeof forceExitTimer.unref === 'function') {
    forceExitTimer.unref()
  }
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception: ', err.stack)
})
