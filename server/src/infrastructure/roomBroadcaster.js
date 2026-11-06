// SOCKET_OPEN；不直接依赖 ws 库，Node 与 Cloudflare 的 WebSocket 都适用
const SOCKET_OPEN = 1

class RoomBroadcaster {
  constructor(sessionRepository) {
    this.sessionRepository = sessionRepository
  }

  sendToUser(userId, event, data) {
    const session = this.sessionRepository.getByUserId(userId)
    if (!session || session.ws.readyState !== SOCKET_OPEN) {
      return
    }

    session.ws.send(JSON.stringify({ route: event, body: data }))
  }

  broadcast(room, event, data) {
    if (!room) {
      return
    }

    room.players.forEach((player) => {
      this.sendToUser(player.id, event, data)
    })
  }

  broadcastPerPlayer(room, event, payloadFactory) {
    if (!room) {
      return
    }

    room.players.forEach((player) => {
      const payload = payloadFactory(player)
      this.sendToUser(player.id, event, payload)
    })
  }
}

module.exports = { RoomBroadcaster }
