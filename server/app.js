const WebSocket = require('ws')
const mongoose = require('mongoose')
const { v4: uuidv4 } = require('uuid')
const { appContext } = require('./src/application/appContext')

const enableVerboseLog = process.env.DAIERYOU_VERBOSE_LOG === '1'

async function connectDatabase() {
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

const entryHandler = require('./app/servers/connector/handler/entryHandler')()
const roomHandler = require('./app/servers/game/handler/roomHandler')()
const gameHandler = require('./app/servers/game/handler/gameHandler')()

const wss = new WebSocket.Server({
  port: appContext.runtimeConfig.wsPort,
  maxPayload: appContext.runtimeConfig.maxWsPayloadBytes,
})

console.log('WebSocket 服务器启动成功，端口:', appContext.runtimeConfig.wsPort)

const requestDedupCache = new Map()

function isRateLimited(session, now) {
  if (!session.rateLimitState) {
    session.rateLimitState = {
      windowStartedAt: now,
      requestCount: 0,
    }
  }

  const windowMs = appContext.runtimeConfig.requestRateWindowMs
  const maxRequests = appContext.runtimeConfig.requestRateMaxRequests
  if (now - session.rateLimitState.windowStartedAt >= windowMs) {
    session.rateLimitState.windowStartedAt = now
    session.rateLimitState.requestCount = 0
  }

  session.rateLimitState.requestCount += 1
  return session.rateLimitState.requestCount > maxRequests
}

function getOperationId(body) {
  if (!body || typeof body !== 'object') {
    return null
  }

  if (typeof body.operationId !== 'string') {
    return null
  }

  const operationId = body.operationId.trim()
  if (!operationId || operationId.length > 120) {
    return null
  }

  return operationId
}

function buildDedupKey(session, route, operationId) {
  const userId = session.get('user')?.id || `session:${session.id}`
  return `${userId}:${route}:${operationId}`
}

function sweepDedupCache(now = Date.now()) {
  for (const [key, entry] of requestDedupCache.entries()) {
    if (entry.expiresAt <= now) {
      requestDedupCache.delete(key)
    }
  }

  const maxEntries = appContext.runtimeConfig.requestDedupMaxEntries
  if (requestDedupCache.size <= maxEntries) {
    return
  }

  const overflow = requestDedupCache.size - maxEntries
  const keys = requestDedupCache.keys()
  for (let index = 0; index < overflow; index += 1) {
    requestDedupCache.delete(keys.next().value)
  }
}

function getDedupResponse(dedupKey, now = Date.now()) {
  if (!dedupKey) {
    return null
  }

  const entry = requestDedupCache.get(dedupKey)
  if (!entry) {
    return null
  }
  if (entry.expiresAt <= now) {
    requestDedupCache.delete(dedupKey)
    return null
  }

  return entry.body
}

function storeDedupResponse(dedupKey, body, now = Date.now()) {
  if (!dedupKey) {
    return
  }

  requestDedupCache.set(dedupKey, {
    body,
    expiresAt: now + appContext.runtimeConfig.requestDedupTtlMs,
  })
  sweepDedupCache(now)
}

wss.on('connection', (ws) => {
  const sessionId = uuidv4()
  const session = {
    id: sessionId,
    ws,
    data: {},
    superseded: false,
    bind(uid) {
      appContext.sessionRepository.bindUser(this, uid)
    },
    get(key) {
      return this.data[key]
    },
    set(key, value) {
      this.data[key] = value
    },
    push(key, cb) {
      if (cb) cb()
    },
  }

  appContext.sessionRepository.add(session)
  console.log('新连接:', sessionId)

  ws.on('message', async (data) => {
    let requestId = null
    try {
      const msg = JSON.parse(data.toString())
      const { id, route, body } = msg
      requestId = id
      const now = Date.now()

      if (typeof route !== 'string' || !route.trim()) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            id,
            body: { code: 400, error: '路由不能为空' },
          }))
        }
        return
      }
      if (isRateLimited(session, now)) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            id,
            body: { code: 429, error: '请求过于频繁，请稍后再试' },
          }))
        }
        return
      }

      await hydrateRoomForRequest(route, body, now)

      const operationId = getOperationId(body)
      const canDedup = operationId && route !== 'connector.entryHandler.login'
      const dedupKey = canDedup ? buildDedupKey(session, route, operationId) : null
      const cachedResponseBody = getDedupResponse(dedupKey)
      if (cachedResponseBody) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ id, body: cachedResponseBody }))
        }
        return
      }

      if (enableVerboseLog) {
        console.log('收到消息:', route, body)
      }

      let handler = null
      let method = null

      if (route.startsWith('connector.entryHandler.')) {
        handler = entryHandler
        method = route.replace('connector.entryHandler.', '')
      } else if (route.startsWith('game.roomHandler.')) {
        handler = roomHandler
        method = route.replace('game.roomHandler.', '')
      } else if (route.startsWith('game.gameHandler.')) {
        handler = gameHandler
        method = route.replace('game.gameHandler.', '')
      }

      if (handler && handler[method]) {
        handler[method](body, session, (err, result) => {
          const responseBody = result || { code: 500, error: err?.message || '处理失败' }
          if (dedupKey && responseBody.code < 500) {
            storeDedupResponse(dedupKey, responseBody)
          }

          const response = {
            id,
            body: responseBody,
          }

          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(response))
          }
        })
        return
      }

      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          id,
          body: { code: 404, error: `路由不存在: ${route}` },
        }))
      }
    } catch (error) {
      console.error('消息处理错误:', error)
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          id: requestId,
          body: { code: 500, error: '消息处理失败，请稍后重试' },
        }))
      }
    }
  })

  ws.on('close', () => {
    console.log('连接关闭:', sessionId)

    if (session.get('user')) {
      entryHandler.disconnect({}, session, () => {})
    }

    appContext.sessionRepository.remove(sessionId)
  })

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

process.on('SIGINT', async () => {
  console.log('服务器正在关闭...')
  appContext.roomLifecycleService.stop()
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
    process.exit(0)
  })

  const forceExitTimer = setTimeout(() => {
    process.exit(0)
  }, 1000)
  if (typeof forceExitTimer.unref === 'function') {
    forceExitTimer.unref()
  }
})

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception: ', err.stack)
})
