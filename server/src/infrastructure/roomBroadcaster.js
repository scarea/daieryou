const WebSocket = require('ws')

class RoomBroadcaster {
  constructor(sessionRepository) {
    this.sessionRepository = sessionRepository
  }

  sendToUser(userId, event, data) {
    const session = this.sessionRepository.getByUserId(userId)
    if (!session || session.ws.readyState !== WebSocket.OPEN) {
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
