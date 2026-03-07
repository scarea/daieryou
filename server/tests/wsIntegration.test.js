const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { spawn } = require('node:child_process')
const WebSocket = require('ws')

const SERVER_DIR = path.resolve(__dirname, '..')

function randomPort() {
  return 34000 + Math.floor(Math.random() * 1000)
}

function waitForServerReady(serverProcess, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    let settled = false
    let output = ''

    const timer = setTimeout(() => {
      if (settled) {
        return
      }

      settled = true
      reject(new Error(`server start timeout\n${output}`))
    }, timeoutMs)

    const cleanup = () => {
      clearTimeout(timer)
      serverProcess.stdout.off('data', onData)
      serverProcess.stderr.off('data', onData)
      serverProcess.off('exit', onExit)
    }

    const onData = (chunk) => {
      const text = chunk.toString()
      output += text
      if (text.includes('WebSocket 服务器启动成功')) {
        if (settled) {
          return
        }

        settled = true
        cleanup()
        resolve()
      }
    }

    const onExit = (code) => {
      if (settled) {
        return
      }

      settled = true
      cleanup()
      reject(new Error(`server exited early code=${code}\n${output}`))
    }

    serverProcess.stdout.on('data', onData)
    serverProcess.stderr.on('data', onData)
    serverProcess.on('exit', onExit)
  })
}

async function startServer(port, extraEnv = {}) {
  const serverProcess = spawn('node', ['app.js'], {
    cwd: SERVER_DIR,
    env: {
      ...process.env,
      DAIERYOU_WS_PORT: String(port),
      DAIERYOU_SKIP_MONGO: '1',
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  await waitForServerReady(serverProcess)
  return serverProcess
}

function stopServer(serverProcess) {
  return new Promise((resolve) => {
    if (!serverProcess || serverProcess.exitCode !== null) {
      resolve()
      return
    }

    const killTimer = setTimeout(() => {
      serverProcess.kill('SIGKILL')
    }, 2000)

    serverProcess.once('exit', () => {
      clearTimeout(killTimer)
      resolve()
    })

    serverProcess.kill('SIGINT')
  })
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function openRawSocket(port) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`)
    ws.once('open', () => resolve(ws))
    ws.once('error', reject)
  })
}

function waitForSocketMessage(ws, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error('ws message timeout'))
    }, timeoutMs)

    const cleanup = () => {
      clearTimeout(timer)
      ws.off('message', onMessage)
      ws.off('error', onError)
    }

    const onMessage = (raw) => {
      cleanup()
      resolve(JSON.parse(raw.toString()))
    }

    const onError = (error) => {
      cleanup()
      reject(error)
    }

    ws.on('message', onMessage)
    ws.on('error', onError)
  })
}

function closeRawSocket(ws) {
  return new Promise((resolve) => {
    if (!ws || ws.readyState >= WebSocket.CLOSING) {
      resolve()
      return
    }

    ws.once('close', resolve)
    ws.close()
  })
}

function waitForEvent(client, predicate, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const start = Date.now()
    const timer = setInterval(() => {
      const found = client.events.find(predicate)
      if (found) {
        clearInterval(timer)
        resolve(found)
        return
      }

      if (Date.now() - start > timeoutMs) {
        clearInterval(timer)
        reject(new Error('event timeout'))
      }
    }, 25)
  })
}

function createClient(port, username, sessionToken) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`)
    const events = []
    const pending = new Map()
    let requestId = 0

    const client = {
      ws,
      events,
      request(route, body = {}) {
        requestId += 1
        const id = requestId
        ws.send(JSON.stringify({ id, route, body }))
        return new Promise((resolveReq) => {
          pending.set(id, resolveReq)
        })
      },
      close() {
        return new Promise((resolveClose) => {
          if (ws.readyState >= WebSocket.CLOSING) {
            resolveClose()
            return
          }

          ws.once('close', () => resolveClose())
          ws.close()
        })
      },
    }

    ws.on('message', (raw) => {
      const message = JSON.parse(raw.toString())
      if (message.id && pending.has(message.id)) {
        pending.get(message.id)(message.body)
        pending.delete(message.id)
        return
      }

      events.push(message)
    })

    ws.once('open', async () => {
      try {
        const loginResponse = await client.request('connector.entryHandler.login', { username, sessionToken })
        if (loginResponse.code !== 200) {
          reject(new Error(loginResponse.error || 'login failed'))
          return
        }

        client.user = loginResponse.data.user
        client.loginPayload = loginResponse.data
        resolve(client)
      } catch (error) {
        reject(error)
      }
    })

    ws.once('error', reject)
  })
}

test('lobby updates should track waiting room lifecycle', { timeout: 15000 }, async () => {
  const port = randomPort()
  const serverProcess = await startServer(port)
  const clients = []

  try {
    const lobby = await createClient(port, 'Lobby')
    const host = await createClient(port, 'Host')
    const guest1 = await createClient(port, 'Guest-1')
    const guest2 = await createClient(port, 'Guest-2')
    clients.push(lobby, host, guest1, guest2)

    const created = await host.request('game.roomHandler.createRoom', {})
    assert.equal(created.code, 200)
    const roomId = created.data.room.id

    await waitForEvent(
      lobby,
      (event) => event.route === 'lobbyUpdated'
        && event.body.rooms.some((room) => room.id === roomId && room.playerCount === 1),
    )

    const joinedOne = await guest1.request('game.roomHandler.joinRoom', { roomId })
    assert.equal(joinedOne.code, 200)
    await waitForEvent(
      lobby,
      (event) => event.route === 'lobbyUpdated'
        && event.body.rooms.some((room) => room.id === roomId && room.playerCount === 2),
    )

    const joinedTwo = await guest2.request('game.roomHandler.joinRoom', { roomId })
    assert.equal(joinedTwo.code, 200)
    await waitForEvent(
      lobby,
      (event) => event.route === 'lobbyUpdated'
        && event.body.rooms.some((room) => room.id === roomId && room.playerCount === 3),
    )

    const started = await host.request('game.gameHandler.startGame', { roomId })
    assert.equal(started.code, 200)
    await waitForEvent(
      lobby,
      (event) => event.route === 'lobbyUpdated'
        && !event.body.rooms.some((room) => room.id === roomId),
    )
  } finally {
    await Promise.all(clients.map((client) => client.close()))
    await stopServer(serverProcess)
  }
})

test('same session token reconnect should resume room and game snapshot', { timeout: 15000 }, async () => {
  const port = randomPort()
  const serverProcess = await startServer(port)
  const clients = []

  try {
    const host = await createClient(port, 'Host')
    const guest1 = await createClient(port, 'Guest-A')
    const guest2 = await createClient(port, 'Guest-B')
    clients.push(host, guest1, guest2)

    const created = await host.request('game.roomHandler.createRoom', {})
    assert.equal(created.code, 200)
    const roomId = created.data.room.id

    assert.equal((await guest1.request('game.roomHandler.joinRoom', { roomId })).code, 200)
    assert.equal((await guest2.request('game.roomHandler.joinRoom', { roomId })).code, 200)
    assert.equal((await host.request('game.gameHandler.startGame', { roomId })).code, 200)

    const hostUserId = host.user.id
    const hostSessionToken = host.loginPayload.sessionToken
    await host.close()
    await waitForEvent(
      guest1,
      (event) => event.route === 'playerConnectionChanged'
        && event.body.userId === hostUserId
        && event.body.online === false,
    )

    const reconnectedHost = await createClient(port, 'Host', hostSessionToken)
    clients.push(reconnectedHost)

    assert.equal(reconnectedHost.loginPayload.resumed, true)
    assert.equal(reconnectedHost.loginPayload.room.id, roomId)
    assert.ok(reconnectedHost.loginPayload.gameState)
    assert.equal(reconnectedHost.loginPayload.gameState.currentRound, 1)

    await waitForEvent(
      guest1,
      (event) => event.route === 'playerConnectionChanged'
        && event.body.userId === hostUserId
        && event.body.online === true,
    )

    await sleep(50)
  } finally {
    await Promise.all(clients.map((client) => client.close()))
    await stopServer(serverProcess)
  }
})

test('request rate limit should return 429 when exceeded', { timeout: 15000 }, async () => {
  const port = randomPort()
  const serverProcess = await startServer(port, {
    DAIERYOU_REQUEST_RATE_WINDOW_MS: '1000',
    DAIERYOU_REQUEST_RATE_MAX_REQUESTS: '5',
  })
  const clients = []

  try {
    const user = await createClient(port, 'Limiter')
    clients.push(user)

    const responses = []
    for (let index = 0; index < 6; index += 1) {
      responses.push(await user.request('game.roomHandler.getRoomList', {}))
    }

    const tooManyRequestResponse = responses.find((entry) => entry.code === 429)
    assert.ok(tooManyRequestResponse)
    assert.equal(tooManyRequestResponse.error, '请求过于频繁，请稍后再试')
    assert.equal(typeof tooManyRequestResponse.traceId, 'string')
    assert.ok(tooManyRequestResponse.traceId.length > 0)
  } finally {
    await Promise.all(clients.map((client) => client.close()))
    await stopServer(serverProcess)
  }
})

test('invalid json payload should return 400 with traceId', { timeout: 15000 }, async () => {
  const port = randomPort()
  const serverProcess = await startServer(port)
  let ws = null

  try {
    ws = await openRawSocket(port)
    ws.send('{invalid-json')
    const response = await waitForSocketMessage(ws)

    assert.equal(response.id, null)
    assert.equal(response.body.code, 400)
    assert.equal(response.body.error, '请求体不是合法 JSON')
    assert.equal(typeof response.body.traceId, 'string')
    assert.ok(response.body.traceId.length > 0)
  } finally {
    await closeRawSocket(ws)
    await stopServer(serverProcess)
  }
})

test('invalid request envelope should return 400 with traceId', { timeout: 15000 }, async () => {
  const port = randomPort()
  const serverProcess = await startServer(port)
  let ws = null

  try {
    ws = await openRawSocket(port)
    ws.send(JSON.stringify({
      id: 7,
      route: 'game.roomHandler.getRoomList',
      body: [],
    }))
    const response = await waitForSocketMessage(ws)

    assert.equal(response.id, 7)
    assert.equal(response.body.code, 400)
    assert.equal(response.body.error, 'body 必须是对象')
    assert.equal(typeof response.body.traceId, 'string')
    assert.ok(response.body.traceId.length > 0)
  } finally {
    await closeRawSocket(ws)
    await stopServer(serverProcess)
  }
})

test('unknown route should return 404 with traceId', { timeout: 15000 }, async () => {
  const port = randomPort()
  const serverProcess = await startServer(port)
  const clients = []

  try {
    const user = await createClient(port, 'Unknown-Route')
    clients.push(user)

    const response = await user.request('game.roomHandler.notFoundRoute', {})
    assert.equal(response.code, 404)
    assert.match(response.error, /路由不存在/)
    assert.equal(typeof response.traceId, 'string')
    assert.ok(response.traceId.length > 0)
  } finally {
    await Promise.all(clients.map((client) => client.close()))
    await stopServer(serverProcess)
  }
})

test('known route should reject unknown body fields by allowlist', { timeout: 15000 }, async () => {
  const port = randomPort()
  const serverProcess = await startServer(port)
  const clients = []

  try {
    const user = await createClient(port, 'Allowlist-Tester')
    clients.push(user)

    const response = await user.request('game.roomHandler.createRoom', {
      operationId: 'create-room-op',
      unexpectedField: 'bad',
    })
    assert.equal(response.code, 400)
    assert.equal(response.error, 'body 包含未允许字段: unexpectedField')
    assert.equal(typeof response.traceId, 'string')
    assert.ok(response.traceId.length > 0)
  } finally {
    await Promise.all(clients.map((client) => client.close()))
    await stopServer(serverProcess)
  }
})

test('same operationId should return cached success response', { timeout: 15000 }, async () => {
  const port = randomPort()
  const serverProcess = await startServer(port, {
    DAIERYOU_REQUEST_DEDUP_TTL_MS: '3000',
  })
  const clients = []

  try {
    const host = await createClient(port, 'Host-Op')
    const guest = await createClient(port, 'Guest-Op')
    clients.push(host, guest)

    const created = await host.request('game.roomHandler.createRoom', {})
    assert.equal(created.code, 200)
    const roomId = created.data.room.id

    const firstJoin = await guest.request('game.roomHandler.joinRoom', {
      roomId,
      operationId: 'join-op-1',
    })
    assert.equal(firstJoin.code, 200)

    const duplicatedJoin = await guest.request('game.roomHandler.joinRoom', {
      roomId,
      operationId: 'join-op-1',
    })
    assert.equal(duplicatedJoin.code, 200)
    assert.equal(duplicatedJoin.data.room.id, roomId)
  } finally {
    await Promise.all(clients.map((client) => client.close()))
    await stopServer(serverProcess)
  }
})
