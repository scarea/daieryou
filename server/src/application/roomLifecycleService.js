class RoomLifecycleService {
  constructor({
    roomRepository,
    lobbyBroadcaster,
    sweepIntervalMs = 30000,
    finishedRoomTtlMs = 5 * 60 * 1000,
    offlineWaitingRoomTtlMs = 2 * 60 * 1000,
  }) {
    this.roomRepository = roomRepository
    this.lobbyBroadcaster = lobbyBroadcaster
    this.sweepIntervalMs = sweepIntervalMs
    this.finishedRoomTtlMs = finishedRoomTtlMs
    this.offlineWaitingRoomTtlMs = offlineWaitingRoomTtlMs
    this.timer = null
  }

  start() {
    if (this.timer) {
      return
    }

    this.timer = setInterval(() => {
      this.cleanupExpiredRooms()
    }, this.sweepIntervalMs)

    if (typeof this.timer.unref === 'function') {
      this.timer.unref()
    }
  }

  stop() {
    if (!this.timer) {
      return
    }

    clearInterval(this.timer)
    this.timer = null
  }

  cleanupExpiredRooms(now = Date.now()) {
    const removedRoomIds = []
    const rooms = this.roomRepository.listAll()

    for (const room of rooms) {
      const updatedAt = room.updatedAt || room.createdAt || now

      if (room.status === 'finished') {
        const finishedAt = room.finishedAt || updatedAt
        if (now - finishedAt >= this.finishedRoomTtlMs) {
          this.roomRepository.delete(room.id)
          removedRoomIds.push(room.id)
        }
        continue
      }

      const allOffline = room.players.length > 0 && room.players.every((player) => player.online === false)
      if (room.status === 'waiting' && allOffline && now - updatedAt >= this.offlineWaitingRoomTtlMs) {
        this.roomRepository.delete(room.id)
        removedRoomIds.push(room.id)
      }
    }

    if (removedRoomIds.length > 0) {
      this.lobbyBroadcaster.broadcastRoomList()
    }

    return removedRoomIds
  }
}

module.exports = { RoomLifecycleService }
