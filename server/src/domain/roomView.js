function serializePlayer(player) {
  return {
    id: player.id,
    username: player.username,
    score: player.score,
    online: player.online !== false,
    isBot: player.isBot === true,
    botDifficulty: player.isBot === true ? (player.botDifficulty || 'normal') : undefined,
  }
}

function serializeRoom(room) {
  if (!room) {
    return null
  }

  return {
    id: room.id,
    hostId: room.hostId,
    status: room.status,
    createdAt: room.createdAt,
    selectionTimeoutMs: Number.isInteger(room.selectionTimeoutMs) && room.selectionTimeoutMs > 0
      ? room.selectionTimeoutMs
      : undefined,
    players: room.players.map(serializePlayer),
  }
}

function serializeRoomList(rooms) {
  return rooms.map((room) => ({
    id: room.id,
    playerCount: room.players.length,
    onlineCount: room.players.filter((player) => player.online !== false).length,
    botCount: room.players.filter((player) => player.isBot === true).length,
    status: room.status,
    hostId: room.hostId,
    createdAt: room.createdAt,
    selectionTimeoutMs: Number.isInteger(room.selectionTimeoutMs) && room.selectionTimeoutMs > 0
      ? room.selectionTimeoutMs
      : undefined,
  }))
}

module.exports = {
  serializePlayer,
  serializeRoom,
  serializeRoomList,
}
