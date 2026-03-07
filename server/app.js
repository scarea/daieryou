const WebSocket = require('ws')
const mongoose = require('mongoose')
const { v4: uuidv4 } = require('uuid')
const { appContext } = require('./src/application/appContext')

const enableVerboseLog = process.env.DAIERYOU_VERBOSE_LOG === '1'
const MAX_ROUTE_LENGTH = 120
const MAX_REQUEST_ID_LENGTH = 64
const MAX_BODY_FIELD_COUNT = 64
const MAX_BODY_FIELD_NAME_LENGTH = 64

const ROUTE_BODY_ALLOWLIST = new Map([
  ['connector.entryHandler.getAuthConfig', new Set()],
  ['connector.entryHandler.sendEmailCode', new Set(['email'])],
  ['connector.entryHandler.register', new Set(['email', 'password', 'verificationCode', 'username', 'inviteCode'])],
  ['connector.entryHandler.loginWithPassword', new Set(['email', 'password'])],
  ['connector.entryHandler.createInviteCode', new Set(['channel', 'campaign', 'remark', 'operationId'])],
  ['connector.entryHandler.purchaseMembership', new Set(['planDays', 'operationId'])],
  ['connector.entryHandler.adminGrantMembership', new Set(['targetEmail', 'durationDays', 'reason', 'operationId'])],
  ['connector.entryHandler.adminListInviteCodes', new Set(['limit', 'status'])],
  ['connector.entryHandler.adminDisableInviteCode', new Set(['code', 'reason', 'operationId'])],
  ['connector.entryHandler.adminListAuditLogs', new Set(['limit', 'action'])],
  ['connector.entryHandler.getBattleStats', new Set(['limit', 'page', 'roomId', 'rank', 'startTime', 'endTime'])],
  ['connector.entryHandler.login', new Set(['username', 'sessionToken'])],
  ['game.roomHandler.createRoom', new Set(['selectionTimeoutMs', 'operationId'])],
  ['game.roomHandler.joinRoom', new Set(['roomId', 'operationId'])],
  ['game.roomHandler.addBots', new Set(['roomId', 'count', 'difficulty', 'operationId'])],
  ['game.roomHandler.removeBot', new Set(['roomId', 'botPlayerId', 'operationId'])],
  ['game.roomHandler.leaveRoom', new Set(['roomId', 'operationId'])],
  ['game.roomHandler.getRoomList', new Set()],
  ['game.gameHandler.startGame', new Set(['roomId', 'operationId'])],
  ['game.gameHandler.selectCards', new Set(['roomId', 'round', 'selectedCards', 'operationId'])],
  ['game.gameHandler.restartGame', new Set(['roomId', 'operationId'])],
])

const gatewayMetrics = {
  incomingMessages: 0,
  validationRejected: 0,
  validationRejectedByReason: Object.create(null),
  rateLimitedHits: 0,
  dedupHits: 0,
}

function logGatewayEvent(level, event, payload = {}) {
  const logEntry = {
    ts: new Date().toISOString(),
    event,
    ...payload,
  }

  const message = JSON.stringify(logEntry)
  if (level === 'error') {
    console.error(message)
    return
  }
  if (level === 'warn') {
    console.warn(message)
    return
  }
  console.log(message)
}

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

function parseStatusCode(code, fallback) {
  const parsed = Math.floor(Number(code))
  if (!Number.isFinite(parsed) || parsed < 100 || parsed > 599) {
    return fallback
  }

  return parsed
}

function normalizeErrorMessage(message, fallback) {
  if (typeof message !== 'string') {
    return fallback
  }

  const normalized = message.trim()
  return normalized || fallback
}

function buildErrorBody(code, error, traceId) {
  return {
    code: parseStatusCode(code, 500),
    error: normalizeErrorMessage(error, '处理失败'),
    traceId,
  }
}

function attachTraceId(body, traceId) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return buildErrorBody(500, '处理失败', traceId)
  }

  const code = parseStatusCode(body.code, 500)
  const responseBody = {
    ...body,
    code,
    traceId,
  }

  if (code >= 400) {
    responseBody.error = normalizeErrorMessage(
      responseBody.error,
      code >= 500 ? '处理失败' : '请求失败',
    )
  }

  return responseBody
}

function stripTraceId(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return body
  }

  const { traceId, ...rest } = body
  return rest
}

function sendWsResponse(ws, id, body) {
  if (ws.readyState !== WebSocket.OPEN) {
    return
  }

  ws.send(JSON.stringify({
    id,
    body,
  }))
}

function recordGatewayMetric(name, detail = null) {
  if (name === 'incoming') {
    gatewayMetrics.incomingMessages += 1
    return
  }
  if (name === 'rate_limited') {
    gatewayMetrics.rateLimitedHits += 1
    return
  }
  if (name === 'dedup_hit') {
    gatewayMetrics.dedupHits += 1
    return
  }
  if (name === 'validation_rejected') {
    gatewayMetrics.validationRejected += 1
    const reason = typeof detail === 'string' && detail.trim()
      ? detail.trim()
      : 'unknown'
    gatewayMetrics.validationRejectedByReason[reason] = (
      gatewayMetrics.validationRejectedByReason[reason] || 0
    ) + 1
  }
}

function buildGatewayMetricsSnapshot() {
  return {
    incomingMessages: gatewayMetrics.incomingMessages,
    validationRejected: gatewayMetrics.validationRejected,
    validationRejectedByReason: { ...gatewayMetrics.validationRejectedByReason },
    rateLimitedHits: gatewayMetrics.rateLimitedHits,
    dedupHits: gatewayMetrics.dedupHits,
  }
}

function validateRouteBodyAllowlist(route, body) {
  const allowlist = ROUTE_BODY_ALLOWLIST.get(route)
  if (!allowlist) {
    return { valid: true }
  }

  const keys = Object.keys(body)
  for (const key of keys) {
    if (!allowlist.has(key)) {
      return {
        valid: false,
        reason: 'body_unknown_field',
        error: `body 包含未允许字段: ${key}`,
      }
    }
  }

  return { valid: true }
}

function isValidRequestId(id) {
  if (Number.isInteger(id)) {
    return id >= 0
  }
  if (typeof id !== 'string') {
    return false
  }

  const normalized = id.trim()
  return normalized.length > 0 && normalized.length <= MAX_REQUEST_ID_LENGTH
}

function validateIncomingMessage(msg) {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) {
    return {
      valid: false,
      id: null,
      code: 400,
      reason: 'request_not_object',
      error: '请求体格式无效',
    }
  }

  const { id, route, body } = msg
  if (!isValidRequestId(id)) {
    return {
      valid: false,
      id: null,
      code: 400,
      reason: 'invalid_request_id',
      error: '请求 id 无效',
    }
  }

  if (typeof route !== 'string') {
    return {
      valid: false,
      id,
      code: 400,
      reason: 'route_missing',
      error: '路由不能为空',
    }
  }

  const normalizedRoute = route.trim()
  if (!normalizedRoute) {
    return {
      valid: false,
      id,
      code: 400,
      reason: 'route_missing',
      error: '路由不能为空',
    }
  }
  if (normalizedRoute.length > MAX_ROUTE_LENGTH) {
    return {
      valid: false,
      id,
      code: 400,
      reason: 'route_too_long',
      error: '路由长度超限',
    }
  }

  const normalizedBody = body == null ? {} : body
  if (typeof normalizedBody !== 'object' || Array.isArray(normalizedBody)) {
    return {
      valid: false,
      id,
      code: 400,
      reason: 'body_not_object',
      error: 'body 必须是对象',
    }
  }

  const bodyKeys = Object.keys(normalizedBody)
  if (bodyKeys.length > MAX_BODY_FIELD_COUNT) {
    return {
      valid: false,
      id,
      code: 400,
      reason: 'body_too_many_fields',
      error: 'body 字段过多',
    }
  }

  const tooLongKey = bodyKeys.find((key) => key.length > MAX_BODY_FIELD_NAME_LENGTH)
  if (tooLongKey) {
    return {
      valid: false,
      id,
      code: 400,
      reason: 'body_field_name_too_long',
      error: 'body 字段名过长',
    }
  }

  const allowlistValidation = validateRouteBodyAllowlist(normalizedRoute, normalizedBody)
  if (!allowlistValidation.valid) {
    return {
      valid: false,
      id,
      code: 400,
      reason: allowlistValidation.reason || 'body_allowlist_rejected',
      error: allowlistValidation.error || '请求字段不合法',
    }
  }

  return {
    valid: true,
    id,
    route: normalizedRoute,
    body: normalizedBody,
  }
}

function normalizeHandlerResponse(err, result, traceId) {
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    const fallbackCode = err ? 500 : 200
    const normalized = attachTraceId({
      ...result,
      code: parseStatusCode(result.code, fallbackCode),
    }, traceId)
    if (!normalized.error && normalized.code >= 500 && err?.message) {
      normalized.error = normalizeErrorMessage(err.message, '处理失败')
    }
    return normalized
  }

  return buildErrorBody(500, err?.message || '处理失败', traceId)
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
    let routeName = null
    const traceId = uuidv4()
    const startedAt = Date.now()
    recordGatewayMetric('incoming')
    try {
      let msg = null
      try {
        msg = JSON.parse(data.toString())
      } catch (error) {
        recordGatewayMetric('validation_rejected', 'invalid_json')
        logGatewayEvent('warn', 'gateway.request.rejected', {
          traceId,
          sessionId,
          code: 400,
          reason: 'invalid_json',
        })
        sendWsResponse(ws, null, buildErrorBody(400, '请求体不是合法 JSON', traceId))
        return
      }

      const validation = validateIncomingMessage(msg)
      if (!validation.valid) {
        recordGatewayMetric('validation_rejected', validation.reason)
        logGatewayEvent('warn', 'gateway.request.rejected', {
          traceId,
          sessionId,
          requestId: validation.id,
          code: validation.code,
          reason: validation.reason,
        })
        sendWsResponse(
          ws,
          validation.id,
          buildErrorBody(validation.code, validation.error, traceId),
        )
        return
      }

      const { id, route, body } = validation
      routeName = route
      requestId = id
      const now = Date.now()
      const userId = session.get('user')?.id || null

      if (isRateLimited(session, now)) {
        recordGatewayMetric('rate_limited')
        logGatewayEvent('warn', 'gateway.request.rate_limited', {
          traceId,
          sessionId,
          userId,
          requestId: id,
          route,
          code: 429,
        })
        sendWsResponse(ws, id, buildErrorBody(429, '请求过于频繁，请稍后再试', traceId))
        return
      }

      await hydrateRoomForRequest(route, body, now)

      const operationId = getOperationId(body)
      const canDedup = operationId && route !== 'connector.entryHandler.login'
      const dedupKey = canDedup ? buildDedupKey(session, route, operationId) : null
      const cachedResponseBody = getDedupResponse(dedupKey)
      if (cachedResponseBody) {
        recordGatewayMetric('dedup_hit')
        if (enableVerboseLog) {
          logGatewayEvent('info', 'gateway.request.dedup_hit', {
            traceId,
            sessionId,
            userId,
            requestId: id,
            route,
          })
        }
        sendWsResponse(ws, id, attachTraceId(cachedResponseBody, traceId))
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
        let responded = false
        const finish = (err, result) => {
          if (responded) {
            return
          }
          responded = true

          const responseBody = normalizeHandlerResponse(err, result, traceId)
          if (dedupKey && responseBody.code < 500) {
            storeDedupResponse(dedupKey, stripTraceId(responseBody), now)
          }
          if (responseBody.code >= 400) {
            logGatewayEvent('warn', 'gateway.request.failed', {
              traceId,
              sessionId,
              userId,
              requestId: id,
              route,
              code: responseBody.code,
              error: responseBody.error,
              durationMs: Date.now() - startedAt,
            })
          } else if (enableVerboseLog) {
            logGatewayEvent('info', 'gateway.request.succeeded', {
              traceId,
              sessionId,
              userId,
              requestId: id,
              route,
              code: responseBody.code,
              durationMs: Date.now() - startedAt,
            })
          }
          sendWsResponse(ws, id, responseBody)
        }

        try {
          Promise.resolve(handler[method](body, session, finish)).catch((error) => {
            logGatewayEvent('error', 'gateway.handler.promise_rejected', {
              traceId,
              sessionId,
              userId,
              requestId: id,
              route,
              error: error?.message || 'handler promise rejected',
            })
            finish(error, null)
          })
        } catch (error) {
          logGatewayEvent('error', 'gateway.handler.execution_failed', {
            traceId,
            sessionId,
            userId,
            requestId: id,
            route,
            error: error?.message || 'handler execution failed',
          })
          finish(error, null)
        }
        return
      }

      logGatewayEvent('warn', 'gateway.request.route_not_found', {
        traceId,
        sessionId,
        userId,
        requestId: id,
        route,
        code: 404,
      })
      sendWsResponse(ws, id, buildErrorBody(404, `路由不存在: ${route}`, traceId))
    } catch (error) {
      logGatewayEvent('error', 'gateway.request.exception', {
        traceId,
        sessionId,
        requestId,
        route: routeName,
        error: error?.message || '消息处理异常',
      })
      sendWsResponse(ws, requestId, buildErrorBody(500, '消息处理失败，请稍后重试', traceId))
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
appContext.battleRecordLifecycleService.start()

process.on('SIGINT', async () => {
  console.log('服务器正在关闭...')
  console.log('[gateway-metrics] snapshot:', JSON.stringify(buildGatewayMetricsSnapshot()))
  appContext.roomLifecycleService.stop()
  appContext.battleRecordLifecycleService.stop()
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
