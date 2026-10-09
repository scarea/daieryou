import { env } from '../config/env'

const WAKE_TIMEOUT_MS = 120000
const PROBE_TIMEOUT_MS = 8000
const RETRY_DELAY_MS = 2500

function sleep(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

async function probe(url) {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
  try {
    const response = await fetch(url, { cache: 'no-store', signal: controller.signal })
    if (!response.ok) {
      return false
    }
    // 平台在实例启动期间可能返回一个“加载中”页面，只认真正的健康检查 JSON
    const body = await response.json().catch(() => null)
    return body?.ok === true
  } catch (error) {
    return false
  } finally {
    window.clearTimeout(timer)
  }
}

/**
 * 免费托管的服务端闲置后会休眠，首次访问需要先唤醒（约 1 分钟）。
 * 反复访问 /healthz 直到服务端就绪；onWaiting 在确认需要等待时回调一次，用于显示提示。
 */
export async function wakeServer({ onWaiting } = {}) {
  if (!env.healthUrl) {
    return true
  }
  if (await probe(env.healthUrl)) {
    return true
  }

  onWaiting?.()
  const deadline = Date.now() + WAKE_TIMEOUT_MS
  while (Date.now() < deadline) {
    await sleep(RETRY_DELAY_MS)
    if (await probe(env.healthUrl)) {
      return true
    }
  }
  return false
}

export async function withRetries(task, { attempts = 3, delayMs = 1500 } = {}) {
  let lastError = null
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await task()
    } catch (error) {
      lastError = error
      if (attempt < attempts) {
        await sleep(delayMs * attempt)
      }
    }
  }
  throw lastError
}
