const path = require('node:path')
const http = require('node:http')
const { spawn } = require('node:child_process')
const { test, expect } = require('@playwright/test')

const ROOT_DIR = path.resolve(__dirname, '..')
const SERVER_DIR = path.join(ROOT_DIR, 'server')
const CLIENT_DIR = path.join(ROOT_DIR, 'client')
const WS_PORT = 3314
const CLIENT_PORT = 3400
const APP_URL = `http://127.0.0.1:${CLIENT_PORT}`

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function normalizeCardName(value) {
  return String(value || '')
    .replace(/\s+/g, '')
    .trim()
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

// 测试环境：低画质 + 减少动效（结算演出缩短），并跳过新手引导
async function prepareFastClient(context) {
  await context.addInitScript(() => {
    window.localStorage.setItem('daieryou_settings_v1', JSON.stringify({ quality: 'low', reducedMotion: true, muted: true }))
    window.localStorage.setItem('daieryou_coach_done_v1', '1')
  })
}

async function login(page, username) {
  await page.goto(APP_URL)
  await page.getByTestId('login-username-input').fill(username)
  await page.getByTestId('login-submit-button').click()
  await expect(page.getByText('游戏大厅')).toBeVisible()
}

async function continueRoundResult(page, timeout = 10000) {
  const continueButton = page.getByTestId('round-result-continue')
  try {
    await continueButton.waitFor({ state: 'visible', timeout })
    await continueButton.click({ timeout: 2000 })
  } catch (error) {
    // 结果条可能已自动收起
  }
}

async function assertRoundResultScoreDisplay(page) {
  const continueButton = page.getByTestId('round-result-continue')
  await expect(continueButton).toBeVisible()

  const secondPlaceCard = page
    .locator('.round-result-player-card')
    .filter({ has: page.locator('.round-result-rank-badge', { hasText: '次名' }) })
    .first()
  const thirdPlaceCard = page
    .locator('.round-result-player-card')
    .filter({ has: page.locator('.round-result-rank-badge', { hasText: '末位' }) })
    .first()

  // 出现并列时可能没有“末位”（后两名并列）或三家全平，此时不做分数方向断言
  if (await secondPlaceCard.count() > 0) {
    await expect(secondPlaceCard.locator('.score-change-pill')).toContainText('-', { timeout: 3000 })
  }
  if (await thirdPlaceCard.count() > 0) {
    await expect(thirdPlaceCard.locator('.score-change-pill')).toContainText('+', { timeout: 3000 })
  }
}

async function assertFinalRoundReveal(page) {
  const finalRevealCard = page.locator('.result-final-reveal-card')
  await expect(finalRevealCard).toBeVisible({ timeout: 20000 })
  await expect(finalRevealCard.locator('.round-result-player-card')).toHaveCount(3)
}

async function readHandCardNames(page) {
  const cards = page.locator('[data-testid^="hand-card-"] .card-content')
  const count = await cards.count()
  const names = []
  for (let index = 0; index < count; index += 1) {
    const raw = await cards.nth(index).textContent()
    const normalized = normalizeCardName(raw)
    if (normalized) {
      names.push(normalized)
    }
  }
  return names
}

async function assertNoReusedCardsInHand(page, globallyPlayedCards) {
  const currentHandCards = await readHandCardNames(page)
  currentHandCards.forEach((cardName) => {
    expect(
      globallyPlayedCards.has(cardName),
      `card ${cardName} should not reappear in any player hand after being played`,
    ).toBeFalsy()
  })
}

async function assertViewportNoPageScroll(page) {
  const metrics = await page.evaluate(() => ({
    verticalOverflow: document.documentElement.scrollHeight - window.innerHeight,
    horizontalOverflow: document.documentElement.scrollWidth - window.innerWidth,
  }))

  expect(
    metrics.verticalOverflow <= 2,
    `page should fit viewport without vertical scroll, overflow=${metrics.verticalOverflow}`,
  ).toBeTruthy()
  expect(
    metrics.horizontalOverflow <= 2,
    `page should fit viewport without horizontal scroll, overflow=${metrics.horizontalOverflow}`,
  ).toBeTruthy()
}

async function submitRoundCards(page) {
  await expect(page.getByTestId('confirm-selection-button')).toBeVisible()
  const selectedCardNames = [
    normalizeCardName(await page.getByTestId('hand-card-0').textContent()),
    normalizeCardName(await page.getByTestId('hand-card-1').textContent()),
  ].filter(Boolean)
  await page.getByTestId('hand-card-0').click()
  await page.getByTestId('hand-card-1').click()
  await expect(page.getByTestId('confirm-selection-button')).toContainText('(2/2)')
  await page.getByTestId('confirm-selection-button').click()
  return selectedCardNames
}

let serverProcess
let clientProcess

test.beforeAll(async () => {
  serverProcess = spawn('node', ['app.js'], {
    cwd: SERVER_DIR,
    env: {
      ...process.env,
      DAIERYOU_SKIP_MONGO: '1',
      DAIERYOU_WS_PORT: String(WS_PORT),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  await waitForServerLog(serverProcess, 'WebSocket 服务器启动成功')

  clientProcess = spawn('npm', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', String(CLIENT_PORT)], {
    cwd: CLIENT_DIR,
    env: {
      ...process.env,
      VITE_WS_URL: `ws://127.0.0.1:${WS_PORT}`,
    },
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
  await Promise.all([hostContext, playerBContext, playerCContext].map(prepareFastClient))

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
    await expect(hostPage.getByText('玩家列表 (3/3)')).toBeVisible()

    const startGameButton = hostPage.getByTestId('start-game-button')
    await expect(startGameButton).toBeEnabled()
    await startGameButton.click()
    await Promise.all(
      pages.map((page) => expect(page.getByTestId('round-indicator')).toContainText('第 1 / 5 轮')),
    )
    await assertViewportNoPageScroll(hostPage)

    const globallyPlayedCards = new Set()

    for (let round = 1; round <= 4; round += 1) {
      for (const page of pages) {
        await assertNoReusedCardsInHand(page, globallyPlayedCards)
        const selectedCardNames = await submitRoundCards(page)
        selectedCardNames.forEach((cardName) => globallyPlayedCards.add(cardName))
      }

      if (round < 4) {
        await assertRoundResultScoreDisplay(hostPage)
      }
      await Promise.all(pages.map((page) => continueRoundResult(page)))

      if (round < 4) {
        await assertViewportNoPageScroll(hostPage)
        await expect(hostPage.getByTestId('round-indicator')).toContainText(`第 ${round + 1} / 5 轮`)
      }
    }

    await Promise.all(pages.map((page) => assertFinalRoundReveal(page)))
    await Promise.all(pages.map((page) => expect(page.getByTestId('final-reveal-continue-button')).toBeVisible()))
    await Promise.all(pages.map((page) => page.getByTestId('final-reveal-continue-button').click()))
    await Promise.all(pages.map((page) => expect(page.getByText('游戏结束')).toBeVisible()))

    // 再来一局需要三位玩家都准备
    for (const page of pages) {
      await page.getByTestId('play-again-button').click()
    }
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
