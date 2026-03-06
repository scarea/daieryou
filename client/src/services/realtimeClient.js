class RealtimeClient {
  constructor() {
    this.socket = null
    this.requestId = 0
    this.pendingRequests = new Map()
    this.listeners = new Map()
    this.requestTimeoutMs = 10000
  }

  connect(url) {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      return Promise.resolve(this.socket)
    }

    if (this.socket && this.socket.readyState === WebSocket.CONNECTING) {
      return new Promise((resolve, reject) => {
        const onOpen = () => {
          cleanup()
          resolve(this.socket)
        }

        const onError = (event) => {
          cleanup()
          reject(new Error(event?.message || '连接服务器失败'))
        }

        const cleanup = () => {
          this.socket?.removeEventListener('open', onOpen)
          this.socket?.removeEventListener('error', onError)
        }

        this.socket.addEventListener('open', onOpen)
        this.socket.addEventListener('error', onError)
      })
    }

    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url)
      this.socket = socket

      const onOpen = () => {
        cleanup()
        socket.addEventListener('message', this.handleMessage)
        socket.addEventListener('close', this.handleClose)
        resolve(socket)
      }

      const onError = () => {
        cleanup()
        reject(new Error('连接服务器失败'))
      }

      const cleanup = () => {
        socket.removeEventListener('open', onOpen)
        socket.removeEventListener('error', onError)
      }

      socket.addEventListener('open', onOpen)
      socket.addEventListener('error', onError)
    })
  }

  disconnect = () => {
    if (!this.socket) {
      return
    }

    this.socket.removeEventListener('message', this.handleMessage)
    this.socket.removeEventListener('close', this.handleClose)
    this.socket.close()
    this.socket = null
    this.rejectAllPending('连接已关闭')
  }

  request(route, body = {}) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('未连接到服务器'))
    }

    this.requestId += 1
    const id = this.requestId

    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        const pending = this.pendingRequests.get(id)
        if (!pending) {
          return
        }

        this.pendingRequests.delete(id)
        pending.reject(new Error(`请求超时: ${route}`))
      }, this.requestTimeoutMs)

      this.pendingRequests.set(id, { resolve, reject, timer })
      this.socket.send(JSON.stringify({ id, route, body }))
    })
  }

  on(event, listener) {
    const listeners = this.listeners.get(event) || new Set()
    listeners.add(listener)
    this.listeners.set(event, listeners)

    return () => this.off(event, listener)
  }

  off(event, listener) {
    const listeners = this.listeners.get(event)
    if (!listeners) {
      return
    }

    listeners.delete(listener)
    if (listeners.size === 0) {
      this.listeners.delete(event)
    }
  }

  emit(event, payload) {
    const listeners = this.listeners.get(event)
    if (!listeners) {
      return
    }

    listeners.forEach((listener) => listener(payload))
  }

  handleMessage = (event) => {
    const payload = JSON.parse(event.data)

    if (payload.id) {
      const request = this.pendingRequests.get(payload.id)
      if (!request) {
        return
      }

      this.pendingRequests.delete(payload.id)
      if (request.timer) {
        window.clearTimeout(request.timer)
      }
      request.resolve(payload.body)
      return
    }

    if (payload.route) {
      this.emit(payload.route, payload.body)
    }
  }

  handleClose = () => {
    this.socket = null
    this.rejectAllPending('连接已关闭')
    this.emit('connection.closed')
  }

  rejectAllPending(message) {
    this.pendingRequests.forEach(({ reject, timer }) => {
      if (timer) {
        window.clearTimeout(timer)
      }
      reject(new Error(message))
    })
    this.pendingRequests.clear()
  }
}

export const realtimeClient = new RealtimeClient()
