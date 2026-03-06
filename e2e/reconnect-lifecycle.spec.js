const path = require('node:path')
const http = require('node:http')
const { spawn } = require('node:child_process')
const { test, expect } = require('@playwright/test')

const ROOT_DIR = path.resolve(__dirname, '..')
const SERVER_DIR = path.join(ROOT_DIR, 'server')
const CLIENT_DIR = path.join(ROOT_DIR, 'client')
const APP_URL = 'http://127.0.0.1:3000'

function waitForHttp(url, timeoutMs = 20000) {
  const startedAt = Date.now()
  return new Promise((resolve, reject) => {
    const check = () => {
      const request = http.get(url, (response) => {
        response.resume()
        if (response.statusCode && response.statusCode < 500) {
          resolve()
          return
        }

        if (Date.now() - startedAt > timeoutMs) {
          reject(new Error(`HTTP readiness timeout: ${url}`))
          return
        }

        setTimeout(check, 200)
      })

      request.on('error', () => {
        if (Date.now() - startedAt > timeoutMs) {
          reject(new Error(`HTTP readiness timeout: ${url}`))
          return
        }

        setTimeout(check, 200)
      })
    }

    check()
  })
}

function waitForServerLog(processHandle, keyword, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    let buffer = ''
    const startedAt = Date.now()

    const onData = (chunk) => {
      buffer += chunk.toString()
      if (buffer.includes(keyword)) {
        cleanup()
        resolve()
      }
    }

    const onExit = (code) => {
      cleanup()
      reject(new Error(`process exited early code=${code}\n${buffer}`))
    }

    const timer = setInterval(() => {
      if (Date.now() - startedAt > timeoutMs) {
        cleanup()
        reject(new Error(`log readiness timeout keyword=${keyword}\n${buffer}`))
      }
    }, 200)

    const cleanup = () => {
      clearInterval(timer)
      processHandle.stdout.off('data', onData)
      processHandle.stderr.off('data', onData)
      processHandle.off('exit', onExit)
    }

    processHandle.stdout.on('data', onData)
    processHandle.stderr.on('data', onData)
    processHandle.on('exit', onExit)
  })
}

function stopProcess(processHandle) {
  return new Promise((resolve) => {
    if (!processHandle || processHandle.exitCode !== null) {
      resolve()
      return
    }

    const killTimer = setTimeout(() => {
      processHandle.kill('SIGKILL')
    }, 2000)

    processHandle.once('exit', () => {
      clearTimeout(killTimer)
      resolve()
    })

    processHandle.kill('SIGINT')
  })
}

async function login(page, username) {
  await page.goto(APP_URL)
  await page.getByTestId('login-username-input').fill(username)
  await page.getByTestId('login-submit-button').click()
  await expect(page.getByText('游戏大厅')).toBeVisible()
}

let serverProcess
let clientProcess

test.beforeAll(async () => {
  serverProcess = spawn('node', ['app.js'], {
    cwd: SERVER_DIR,
    env: {
      ...process.env,
      DAIERYOU_SKIP_MONGO: '1',
      DAIERYOU_DISCONNECT_GRACE_MS: '1800',
      DAIERYOU_ROOM_SWEEP_INTERVAL_MS: '200',
      DAIERYOU_OFFLINE_WAITING_ROOM_TTL_MS: '900',
      DAIERYOU_FINISHED_ROOM_TTL_MS: '1200',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  await waitForServerLog(serverProcess, 'WebSocket 服务器启动成功')

  clientProcess = spawn('npm', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', '3000'], {
    cwd: CLIENT_DIR,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  await waitForHttp(APP_URL)
})

test.afterAll(async () => {
  await Promise.all([
    stopProcess(clientProcess),
    stopProcess(serverProcess),
  ])
})

test('disconnect timeout should abort in-progress game', async ({ browser }) => {
  const hostContext = await browser.newContext()
  const playerBContext = await browser.newContext()
  const playerCContext = await browser.newContext()

  const hostPage = await hostContext.newPage()
  const playerBPage = await playerBContext.newPage()
  const playerCPage = await playerCContext.newPage()

  try {
    await Promise.all([
      login(hostPage, 'Host-TTL'),
      login(playerBPage, 'PlayerB-TTL'),
      login(playerCPage, 'PlayerC-TTL'),
    ])

    await hostPage.getByTestId('create-room-button').click()
    await playerBPage.locator('[data-testid^="join-room-"]').first().click()
    await playerCPage.locator('[data-testid^="join-room-"]').first().click()

    await hostPage.getByTestId('start-game-button').click()
    await expect(hostPage.getByTestId('round-indicator')).toContainText('第 1 / 5 轮')

    await playerBContext.close()

    await expect(hostPage.getByText('断线超时，已离开房间')).toBeVisible({ timeout: 10000 })
    await expect(hostPage.getByText('玩家列表 (2/3)')).toBeVisible()
  } finally {
    await Promise.all([
      hostContext.close(),
      playerCContext.close(),
    ])
  }
})

test('offline waiting room should be auto cleaned', async ({ browser }) => {
  const observerContext = await browser.newContext()
  const creatorContext = await browser.newContext()

  const observerPage = await observerContext.newPage()
  const creatorPage = await creatorContext.newPage()

  try {
    await Promise.all([
      login(observerPage, 'Observer-TTL'),
      login(creatorPage, 'Creator-TTL'),
    ])

    await creatorPage.getByTestId('create-room-button').click()
    await expect(observerPage.locator('[data-testid^="join-room-"]')).toHaveCount(1, { timeout: 5000 })

    await creatorContext.close()

    await expect(observerPage.getByText('暂无可用房间，创建一个开始游戏吧！')).toBeVisible({ timeout: 10000 })
  } finally {
    await observerContext.close()
  }
})
