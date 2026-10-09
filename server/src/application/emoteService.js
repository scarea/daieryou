// 牌桌快捷表情：只做广播，不影响对局状态。
// 白名单与前端 client/src/components/emotes.js 保持一致，并按用户限流防刷屏。
const EMOTE_IDS = new Set(['gotcha', 'steady', 'think', 'clap', 'cry', 'fire'])
const DEFAULT_COOLDOWN_MS = 1200

class EmoteService {
  constructor({ roomRepository, broadcaster, cooldownMs = DEFAULT_COOLDOWN_MS, now = () => Date.now() }) {
    this.roomRepository = roomRepository
    this.broadcaster = broadcaster
    this.cooldownMs = cooldownMs
    this.now = now
    this.lastSentAt = new Map()
  }

  sendEmote(user, { roomId, emoteId, targetId = null } = {}) {
    if (!user?.id) {
      throw new Error('用户未登录')
    }
    if (!EMOTE_IDS.has(emoteId)) {
      throw new Error('表情不存在')
    }

    const room = this.roomRepository.get(roomId)
    if (!room || !room.players.some((player) => player.id === user.id)) {
      throw new Error('不在该房间中')
    }
    const normalizedTargetId = typeof targetId === 'string' && targetId && targetId !== user.id
      && room.players.some((player) => player.id === targetId)
      ? targetId
      : null

    const now = this.now()
    const lastSentAt = this.lastSentAt.get(user.id) || 0
    if (now - lastSentAt < this.cooldownMs) {
      throw new Error('发送太频繁了')
    }
    this.lastSentAt.set(user.id, now)
    if (this.lastSentAt.size > 5000) {
      this.lastSentAt.clear()
    }

    const payload = { roomId: room.id, fromId: user.id, emoteId, targetId: normalizedTargetId, at: now }
    this.broadcaster.broadcast(room, 'emote', payload)
    return payload
  }
}

module.exports = { EmoteService, EMOTE_IDS }
