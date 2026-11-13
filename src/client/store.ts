// 全局状态：登录态、大厅、房间快照，以及与服务器的交互动作。
import { create } from 'zustand'
import type { MjView } from '../shared/mahjong/view.ts'
import type { ClientOp, LobbyState, RoomView, ServerEvent, SigninStatus, UserProfile } from '../shared/protocol.ts'
import { ApiError, GameSocket, SocketStatus, api, setAuthToken } from './net.ts'
import { music, sfx } from './sound.ts'

const TOKEN_KEY = 'daieryou.token'

export interface Toast {
  id: number
  text: string
  kind: 'info' | 'error' | 'gold'
}

export interface EmoteBubble {
  id: number
  seat: number
  key: string
}

interface State {
  booting: boolean
  token: string
  user: UserProfile | null
  signin: SigninStatus | null
  conn: SocketStatus
  lobby: LobbyState
  room: RoomView | null
  /** 红中麻将牌桌 */
  mj: MjView | null
  /** 本地保留的结算快照，直到玩家点"再来一局 / 返回大厅" */
  result: RoomView | null
  /** 服务器时钟 - 本地时钟 */
  clockOffset: number
  toasts: Toast[]
  emotes: EmoteBubble[]
  /** 刚生成的恢复码：弹窗提示玩家保存，只展示这一次 */
  recoveryCode: string | null

  boot(): Promise<void>
  authenticate(mode: 'login' | 'register' | 'guest', body?: Record<string, unknown>): Promise<void>
  logout(): Promise<void>
  refreshMe(): Promise<void>
  setUser(user: UserProfile, signin?: SigninStatus): void
  send(op: ClientOp): Promise<boolean>
  dismissResult(): void
  setRecoveryCode(code: string | null): void
  toast(text: string, kind?: Toast['kind']): void
}

let seq = 0
let socket: GameSocket | null = null

type MeResponse = { user: UserProfile; signin: SigninStatus; seasonReward?: { title: string; reward: number } | null }

/** 邀请链接里的房号：?room=123456 */
let inviteRoom = ''
try {
  const param = new URLSearchParams(location.search).get('room') || ''
  if (/^\d{6}$/.test(param)) inviteRoom = param
} catch {
  inviteRoom = ''
}

function readToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) || ''
  } catch {
    return ''
  }
}

function writeToken(token: string): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    // 无痕模式等场景下忽略
  }
}

export const useStore = create<State>((set, get) => {
  const handleEvent = (event: ServerEvent) => {
    switch (event.ev) {
      case 'room': {
        const room = event.room
        const previous = get().room
        const patch: Partial<State> = { room }
        if (room) patch.clockOffset = room.serverNow - Date.now()
        // 对局刚结束：留存结算快照
        if (room?.status === 'finished' && room.settlement && previous?.status === 'playing') patch.result = room
        if (room?.status === 'finished' && room.settlement && !previous && !get().result) patch.result = room
        set(patch)
        break
      }
      case 'lobby':
        set({ lobby: event.lobby })
        break
      case 'mj':
        set({ mj: event.table })
        break
      case 'me':
        set({ user: event.user })
        break
      case 'emote': {
        seq += 1
        const bubble = { id: seq, seat: event.seat, key: event.key }
        set({ emotes: [...get().emotes.filter((item) => item.seat !== event.seat), bubble] })
        sfx.pop()
        window.setTimeout(() => set({ emotes: get().emotes.filter((item) => item.id !== bubble.id) }), 3200)
        break
      }
      case 'notice':
        get().toast(event.text)
        break
      case 'kicked':
        get().toast(event.reason, 'error')
        clearSession()
        break
      default:
        break
    }
  }

  const clearSession = () => {
    socket?.close()
    writeToken('')
    setAuthToken('')
    set({ token: '', user: null, signin: null, room: null, mj: null, result: null, conn: 'idle' })
  }

  const startSession = (token: string, user: UserProfile) => {
    writeToken(token)
    setAuthToken(token)
    set({ token, user })
    socket?.close()
    socket = new GameSocket(handleEvent, (conn) => {
      set({ conn })
      // 通过邀请链接进来：连上后自动加入那桌
      if (conn === 'open' && inviteRoom) {
        const roomId = inviteRoom
        inviteRoom = ''
        history.replaceState(null, '', location.pathname)
        window.setTimeout(() => { if (!get().room) void get().send({ op: 'join', roomId }) }, 500)
      }
    }, () => {
      get().toast('登录已失效，请重新登录', 'error')
      clearSession()
    })
    socket.connect(token)
    get().refreshMe().catch(() => {})
  }

  return {
    booting: true,
    token: '',
    user: null,
    signin: null,
    conn: 'idle',
    lobby: { rooms: [], online: 0 },
    room: null,
    mj: null,
    result: null,
    clockOffset: 0,
    toasts: [],
    emotes: [],
    recoveryCode: null,

    async boot() {
      music.arm()
      const token = readToken()
      if (token) {
        setAuthToken(token)
        try {
          const data = await api<MeResponse>('/me')
          startSession(token, data.user)
          set({ signin: data.signin })
        } catch (error) {
          if (error instanceof ApiError && error.status === 401) writeToken('')
          setAuthToken('')
        }
      }
      set({ booting: false })
    },

    async authenticate(mode, body = {}) {
      const data = await api<{ token: string; user: UserProfile; recoveryCode?: string }>(`/auth/${mode}`, body)
      startSession(data.token, data.user)
      if (data.recoveryCode) set({ recoveryCode: data.recoveryCode })
    },

    async logout() {
      await api('/auth/logout', {}).catch(() => {})
      clearSession()
    },

    async refreshMe() {
      const data = await api<MeResponse>('/me')
      set({ user: data.user, signin: data.signin })
      if (data.seasonReward) {
        sfx.fanfare()
        get().toast(`新赛季开启！上赛季「${data.seasonReward.title}」奖励 ${data.seasonReward.reward} 金币`, 'gold')
      }
    },

    setUser(user, signin) {
      set(signin ? { user, signin } : { user })
    },

    async send(op) {
      if (!socket) return false
      try {
        await socket.request(op)
        return true
      } catch (error) {
        get().toast((error as Error).message, 'error')
        return false
      }
    },

    dismissResult() {
      set({ result: null })
    },

    setRecoveryCode(code) {
      set({ recoveryCode: code })
    },

    toast(text, kind = 'info') {
      seq += 1
      const toast = { id: seq, text, kind }
      if (kind === 'error') sfx.error()
      set({ toasts: [...get().toasts.slice(-2), toast] })
      window.setTimeout(() => set({ toasts: get().toasts.filter((item) => item.id !== toast.id) }), 2800)
    },
  }
})
