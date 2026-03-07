const test = require('node:test')
const assert = require('node:assert/strict')
const { BattleRecordService } = require('../src/application/battleRecordService')

test('battleRecordService should aggregate summary and records', async () => {
  const service = new BattleRecordService({
    maxRecordsPerUser: 100,
    maxQueryLimit: 50,
  })

  await service.recordGameFinished({
    roomId: 'room-1',
    finishedAt: 1000,
    finalScores: [
      { playerId: 'u1', username: 'A', totalScore: 5, roundScores: [1, 2, 2] },
      { playerId: 'u2', username: 'B', totalScore: -2, roundScores: [0, -1, -1] },
      { playerId: 'u3', username: 'C', totalScore: -3, roundScores: [-1, -1, -1] },
    ],
  })
  await service.recordGameFinished({
    roomId: 'room-2',
    finishedAt: 2000,
    finalScores: [
      { playerId: 'u2', username: 'B', totalScore: 4, roundScores: [2, 1, 1] },
      { playerId: 'u1', username: 'A', totalScore: 1, roundScores: [0, 0, 1] },
      { playerId: 'u3', username: 'C', totalScore: -5, roundScores: [-2, -1, -2] },
    ],
  })

  const payload = await service.getBattleStats({ id: 'u1' }, { limit: 20 })
  assert.equal(payload.summary.totalGames, 2)
  assert.equal(payload.summary.winCount, 1)
  assert.equal(payload.summary.totalScoreChange, 6)
  assert.equal(payload.records.length, 2)
  assert.equal(payload.records[0].roomId, 'room-2')
  assert.equal(payload.records[1].roomId, 'room-1')
  assert.equal(payload.trend.length, 2)
  assert.equal(payload.trend[0].cumulativeScore, 5)
  assert.equal(payload.trend[1].cumulativeScore, 6)
  assert.equal(payload.pagination.total, 2)
  assert.equal(payload.pagination.page, 1)
  assert.equal(payload.pagination.totalPages, 1)
})

test('battleRecordService should enforce limit and reject unauthenticated user', async () => {
  const service = new BattleRecordService({
    maxRecordsPerUser: 100,
    maxQueryLimit: 10,
  })

  for (let index = 0; index < 15; index += 1) {
    await service.recordGameFinished({
      roomId: `room-${index}`,
      finishedAt: index,
      finalScores: [
        { playerId: 'u1', username: 'A', totalScore: 1, roundScores: [1] },
        { playerId: 'u2', username: 'B', totalScore: -1, roundScores: [-1] },
      ],
    })
  }

  const payload = await service.getBattleStats({ id: 'u1' }, { limit: 99 })
  assert.equal(payload.limit, 10)
  assert.equal(payload.records.length, 10)
  assert.equal(payload.pagination.total, 15)
  assert.equal(payload.pagination.hasMore, true)

  const secondPage = await service.getBattleStats({ id: 'u1' }, { limit: 5, page: 2 })
  assert.equal(secondPage.pagination.page, 2)
  assert.equal(secondPage.records.length, 5)

  await assert.rejects(
    () => service.getBattleStats({ id: 'u1' }, { startTime: 10, endTime: 1 }),
    /开始时间不能晚于结束时间/,
  )

  await assert.rejects(
    () => service.getBattleStats(null, { limit: 5 }),
    /用户未登录/,
  )
})

test('battleRecordService should support room, rank and time filters', async () => {
  const service = new BattleRecordService({
    maxRecordsPerUser: 100,
    maxQueryLimit: 20,
  })

  await service.recordGameFinished({
    roomId: 'room-a',
    finishedAt: 1000,
    finalScores: [
      { playerId: 'u1', username: 'A', totalScore: 5, roundScores: [2, 3] },
      { playerId: 'u2', username: 'B', totalScore: -5, roundScores: [-2, -3] },
    ],
  })
  await service.recordGameFinished({
    roomId: 'room-b',
    finishedAt: 2000,
    finalScores: [
      { playerId: 'u1', username: 'A', totalScore: -1, roundScores: [-1] },
      { playerId: 'u2', username: 'B', totalScore: 1, roundScores: [1] },
    ],
  })
  await service.recordGameFinished({
    roomId: 'room-a',
    finishedAt: 3000,
    finalScores: [
      { playerId: 'u1', username: 'A', totalScore: -3, roundScores: [-1, -2] },
      { playerId: 'u2', username: 'B', totalScore: 3, roundScores: [1, 2] },
    ],
  })

  const byRoom = await service.getBattleStats({ id: 'u1' }, { roomId: 'room-a', limit: 20 })
  assert.equal(byRoom.pagination.total, 2)
  assert.equal(byRoom.records.length, 2)
  assert.equal(byRoom.records.every((record) => record.roomId === 'room-a'), true)

  const byRank = await service.getBattleStats({ id: 'u1' }, { rank: 1, limit: 20 })
  assert.equal(byRank.pagination.total, 1)
  assert.equal(byRank.records.length, 1)
  assert.equal(byRank.records[0].rank, 1)

  const byTime = await service.getBattleStats({ id: 'u1' }, {
    startTime: 1500,
    endTime: 3500,
    limit: 20,
  })
  assert.equal(byTime.pagination.total, 2)
  assert.equal(byTime.records.every((record) => record.finishedAt >= 1500), true)
  assert.equal(byTime.records.every((record) => record.finishedAt <= 3500), true)
})

test('battleRecordService should use repository when provided', async () => {
  const recordsByUserId = new Map()
  const listCalls = []
  const summaryCalls = []
  const repository = {
    async saveRecords(records) {
      records.forEach((record) => {
        const userId = record.userId
        const list = recordsByUserId.get(userId) || []
        list.unshift(record)
        recordsByUserId.set(userId, list)
      })
      return { upserted: records.length }
    },
    async listByUserId(userId, { limit, page, roomId, rank, startTime, endTime }) {
      listCalls.push({ userId, limit, page, roomId, rank, startTime, endTime })
      const all = (recordsByUserId.get(userId) || [])
        .filter((record) => (roomId ? record.roomId === roomId : true))
        .filter((record) => (rank != null ? record.rank === rank : true))
        .filter((record) => (startTime != null ? record.finishedAt >= startTime : true))
        .filter((record) => (endTime != null ? record.finishedAt <= endTime : true))
      const offset = (Math.max(1, page) - 1) * limit
      return {
        records: all.slice(offset, offset + limit),
        total: all.length,
        page,
        limit,
      }
    },
    async getSummaryByUserId(userId, { roomId, rank, startTime, endTime }) {
      summaryCalls.push({ userId, roomId, rank, startTime, endTime })
      const records = (recordsByUserId.get(userId) || [])
        .filter((record) => (roomId ? record.roomId === roomId : true))
        .filter((record) => (rank != null ? record.rank === rank : true))
        .filter((record) => (startTime != null ? record.finishedAt >= startTime : true))
        .filter((record) => (endTime != null ? record.finishedAt <= endTime : true))
      return {
        totalGames: records.length,
        winCount: records.filter((record) => record.rank === 1).length,
        totalScoreChange: records.reduce((sum, record) => sum + record.totalScore, 0),
        avgScore: records.length > 0
          ? records.reduce((sum, record) => sum + record.totalScore, 0) / records.length
          : 0,
      }
    },
  }
  const service = new BattleRecordService({
    battleRecordRepository: repository,
    maxRecordsPerUser: 100,
    maxQueryLimit: 20,
  })

  await service.recordGameFinished({
    roomId: 'room-repo',
    finishedAt: 3000,
    finalScores: [
      { playerId: 'u1', username: 'A', totalScore: 3, roundScores: [1, 2] },
      { playerId: 'u2', username: 'B', totalScore: -1, roundScores: [0, -1] },
      { playerId: 'u3', username: 'C', totalScore: -2, roundScores: [-1, -1] },
    ],
  })

  const payload = await service.getBattleStats({ id: 'u1' }, {
    limit: 10,
    page: 1,
    roomId: 'room-repo',
    rank: 1,
    startTime: 1000,
    endTime: 5000,
  })
  assert.equal(payload.summary.totalGames, 1)
  assert.equal(payload.summary.totalScoreChange, 3)
  assert.equal(payload.records.length, 1)
  assert.equal(payload.records[0].roomId, 'room-repo')
  assert.equal(payload.pagination.total, 1)
  assert.equal(listCalls.length, 1)
  assert.equal(listCalls[0].roomId, 'room-repo')
  assert.equal(listCalls[0].rank, 1)
  assert.equal(summaryCalls.length, 1)
  assert.equal(summaryCalls[0].startTime, 1000)
  assert.equal(summaryCalls[0].endTime, 5000)
})
