const path = require('node:path')
const http = require('node:http')
const { spawn } = require('node:child_process')
const { test, expect } = require('@playwright/test')

const ROOT_DIR = path.resolve(__dirname, '..')
const SERVER_DIR = path.join(ROOT_DIR, 'server')
const CLIENT_DIR = path.join(ROOT_DIR, 'client')
const APP_URL = 'http://127.0.0.1:3000'

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

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

async function dismissRoundModalIfVisible(page) {
  const continueButton = page.getByTestId('round-result-continue')
  const visible = await continueButton
    .isVisible({ timeout: 1200 })
    .catch(() => false)

  if (visible) {
    await continueButton.click()
  }
}

async function drainRoundModal(page) {
  for (let index = 0; index < 4; index += 1) {
    await dismissRoundModalIfVisible(page)
    await page.waitForTimeout(120)
  }
}

async function submitRoundCards(page) {
  await drainRoundModal(page)
  await expect(page.getByTestId('confirm-selection-button')).toBeVisible()
  await page.getByTestId('hand-card-0').click()
  await page.getByTestId('hand-card-1').click()
  await expect(page.getByTestId('confirm-selection-button')).toContainText('(2/2)')
  await page.getByTestId('confirm-selection-button').click()
}

let serverProcess
let clientProcess

test.beforeAll(async () => {
  serverProcess = spawn('node', ['app.js'], {
    cwd: SERVER_DIR,
    env: {
      ...process.env,
      DAIERYOU_SKIP_MONGO: '1',
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

test('three players should finish one game and restart in same room', async ({ browser }) => {
  const hostContext = await browser.newContext()
  const playerBContext = await browser.newContext()
  const playerCContext = await browser.newContext()

  const hostPage = await hostContext.newPage()
  const playerBPage = await playerBContext.newPage()
  const playerCPage = await playerCContext.newPage()
  const pages = [hostPage, playerBPage, playerCPage]

  try {
    await Promise.all([
      login(hostPage, 'Host'),
      login(playerBPage, 'PlayerB'),
      login(playerCPage, 'PlayerC'),
    ])

    await hostPage.getByTestId('create-room-button').click()
    await expect(hostPage.getByText('玩家列表 (1/3)')).toBeVisible()

    await playerBPage.locator('[data-testid^="join-room-"]').first().click()
    await expect(playerBPage.getByText('玩家列表 (2/3)')).toBeVisible()

    await playerCPage.locator('[data-testid^="join-room-"]').first().click()
    await expect(playerCPage.getByText('玩家列表 (3/3)')).toBeVisible()

    await hostPage.getByTestId('start-game-button').click()
    await Promise.all(
      pages.map((page) => expect(page.getByTestId('round-indicator')).toContainText('第 1 / 5 轮')),
    )

    for (let round = 1; round <= 5; round += 1) {
      for (const page of pages) {
        await submitRoundCards(page)
      }

      await Promise.all(pages.map((page) => drainRoundModal(page)))

      if (round < 5) {
        await expect(hostPage.getByTestId('round-indicator')).toContainText(`第 ${round + 1} / 5 轮`)
      }
    }

    await Promise.all(pages.map((page) => expect(page.getByText('游戏结束')).toBeVisible()))

    await hostPage.getByTestId('play-again-button').click()
    await Promise.all(
      pages.map((page) => expect(page.getByTestId('round-indicator')).toContainText('第 1 / 5 轮')),
    )

    await sleep(100)
  } finally {
    await Promise.all([
      hostContext.close(),
      playerBContext.close(),
      playerCContext.close(),
    ])
  }
})
