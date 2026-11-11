// 网络层：REST（账号 / 积分）与 WebSocket（大厅 / 房间 / 对局，含自动重连）。
import type { ClientOp, ServerEvent } from '../shared/protocol.ts'

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

/** 游戏服务器地址；留空表示与网页同源（本地开发、单机部署） */
const SERVER_URL = (import.meta.env.VITE_SERVER_URL || '').replace(/\/$/, '')

let authToken = ''
export function setAuthToken(token: string): void {
  authToken = token
}

export async function api<T>(path: string, body?: unknown, method?: 'GET' | 'POST'): Promise<T> {
  const verb = method ?? (body === undefined ? 'GET' : 'POST')
  let response: Response
  try {
    response = await fetch(`${SERVER_URL}/api${path}`, {
      method: verb,
      headers: {
        ...(verb === 'POST' ? { 'Content-Type': 'application/json' } : {}),
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      },
      body: verb === 'POST' ? JSON.stringify(body ?? {}) : undefined,
    })
  } catch {
    throw new ApiError('网络连接失败，请检查网络', 0)
  }
  const data = (await response.json().catch(() => ({}))) as { error?: string }
  if (!response.ok) throw new ApiError(data.error || '请求失败', response.status)
  return data as T
}

type Pending = { resolve: (data: unknown) => void; reject: (error: Error) => void; timer: number }

export type SocketStatus = 'idle' | 'connecting' | 'open' | 'reconnecting'

export class GameSocket {
  private ws: WebSocket | null = null
  private seq = 0
  private pending = new Map<number, Pending>()
  private retry = 0
  private retryTimer = 0
  private pingTimer = 0
  private closedByUser = true
  private token = ''

  constructor(
    private onEvent: (event: ServerEvent) => void,
    private onStatus: (status: SocketStatus) => void,
    private onAuthFailed: () => void,
  ) {}

  connect(token: string): void {
    this.token = token
    this.closedByUser = false
    this.open()
  }

  private open(): void {
    window.clearTimeout(this.retryTimer)
    this.onStatus(this.retry === 0 ? 'connecting' : 'reconnecting')
    const origin = SERVER_URL || location.origin
    const ws = new WebSocket(`${origin.replace(/^http/, 'ws')}/ws`)
    this.ws = ws
    ws.onopen = () => {
      this.request({ op: 'auth', token: this.token })
        .then(() => {
          this.retry = 0
          this.onStatus('open')
        })
        .catch(() => {
          this.close()
          this.onAuthFailed()
        })
    }
    ws.onmessage = (message) => {
      let event: ServerEvent
      try {
        event = JSON.parse(message.data)
      } catch {
        return
      }
      if (event.ev === 'res') {
        const pending = this.pending.get(event.id)
        if (!pending) return
        this.pending.delete(event.id)
        window.clearTimeout(pending.timer)
        if (event.ok) pending.resolve(event.data)
        else pending.reject(new Error(event.error))
        return
      }
      if (event.ev === 'kicked') this.closedByUser = true
      this.onEvent(event)
    }
    ws.onclose = () => {
      if (this.ws !== ws) return
      this.ws = null
      this.rejectAll('连接已断开')
      if (this.closedByUser) {
        this.onStatus('idle')
        return
      }
      this.retry += 1
      this.onStatus('reconnecting')
      this.retryTimer = window.setTimeout(() => this.open(), Math.min(5000, 400 * 2 ** Math.min(this.retry, 4)))
    }
    ws.onerror = () => ws.close()
    window.clearInterval(this.pingTimer)
    this.pingTimer = window.setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) this.request({ op: 'ping' }).catch(() => {})
    }, 20000)
  }

  request<T = unknown>(op: ClientOp): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const ws = this.ws
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        reject(new Error('正在连接服务器，请稍候'))
        return
      }
      this.seq += 1
      const id = this.seq
      const timer = window.setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('请求超时，请重试'))
      }, 8000)
      this.pending.set(id, { resolve: resolve as (data: unknown) => void, reject, timer })
      ws.send(JSON.stringify({ ...op, id }))
    })
  }

  private rejectAll(reason: string): void {
    this.pending.forEach((pending) => {
      window.clearTimeout(pending.timer)
      pending.reject(new Error(reason))
    })
    this.pending.clear()
  }

  close(): void {
    this.closedByUser = true
    window.clearTimeout(this.retryTimer)
    window.clearInterval(this.pingTimer)
    this.ws?.close()
    this.ws = null
    this.rejectAll('连接已关闭')
    this.onStatus('idle')
  }
}
