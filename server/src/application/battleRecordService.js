const DEFAULT_MAX_RECORDS_PER_USER = 100
const DEFAULT_MAX_QUERY_LIMIT = 50
const DEFAULT_QUERY_PAGE = 1
const MAX_ROOM_ID_LENGTH = 64

function toSafeNumber(value, fallback = 0) {
  const number = Number(value)
  if (!Number.isFinite(number)) {
    return fallback
  }
  return number
}

class BattleRecordService {
  constructor({
    battleRecordRepository = null,
    maxRecordsPerUser = DEFAULT_MAX_RECORDS_PER_USER,
    maxQueryLimit = DEFAULT_MAX_QUERY_LIMIT,
  } = {}) {
    this.battleRecordRepository = battleRecordRepository
    this.maxRecordsPerUser = Math.max(20, Math.floor(toSafeNumber(maxRecordsPerUser, DEFAULT_MAX_RECORDS_PER_USER)))
    this.maxQueryLimit = Math.max(10, Math.floor(toSafeNumber(maxQueryLimit, DEFAULT_MAX_QUERY_LIMIT)))
    this.recordsByUserId = new Map()
  }

  normalizeLimit(limit, fallback = 20) {
    const normalized = Math.floor(toSafeNumber(limit, fallback))
    if (!Number.isFinite(normalized) || normalized <= 0) {
      return fallback
    }
    return Math.min(normalized, this.maxQueryLimit)
  }

  normalizePage(page, fallback = DEFAULT_QUERY_PAGE) {
    const normalized = Math.floor(toSafeNumber(page, fallback))
    if (!Number.isFinite(normalized) || normalized <= 0) {
      return fallback
    }
    return Math.min(normalized, 100000)
  }

  normalizeRoomId(roomId) {
    if (typeof roomId !== 'string') {
      return ''
    }

    return roomId.trim().slice(0, MAX_ROOM_ID_LENGTH)
  }

  normalizeOptionalRank(rank) {
    if (rank == null || rank === '') {
      return null
    }

    const normalized = Math.floor(toSafeNumber(rank, Number.NaN))
    if (!Number.isFinite(normalized) || normalized < 1) {
      throw new Error('名次筛选参数无效')
    }

    return normalized
  }

  normalizeOptionalTimestamp(value, fieldName) {
    if (value == null || value === '') {
      return null
    }

    const normalized = Math.floor(toSafeNumber(value, Number.NaN))
    if (!Number.isFinite(normalized) || normalized < 0) {
      throw new Error(`${fieldName} 参数无效`)
    }

    return normalized
  }

  normalizeQueryOptions(options = {}) {
    const normalized = {
      limit: this.normalizeLimit(options.limit, 20),
      page: this.normalizePage(options.page, DEFAULT_QUERY_PAGE),
      roomId: this.normalizeRoomId(options.roomId),
      rank: this.normalizeOptionalRank(options.rank),
      startTime: this.normalizeOptionalTimestamp(options.startTime, 'startTime'),
      endTime: this.normalizeOptionalTimestamp(options.endTime, 'endTime'),
    }

    if (normalized.startTime != null && normalized.endTime != null && normalized.startTime > normalized.endTime) {
      throw new Error('开始时间不能晚于结束时间')
    }

    return normalized
  }

  buildRankMap(finalScores) {
    const sorted = [...finalScores].sort((left, right) => {
      if (left.totalScore !== right.totalScore) {
        return right.totalScore - left.totalScore
      }
      return String(left.playerId).localeCompare(String(right.playerId))
    })

    const rankByPlayerId = new Map()
    sorted.forEach((item, index) => {
      rankByPlayerId.set(item.playerId, index + 1)
    })
    return rankByPlayerId
  }

  trimUserRecords(userId) {
    const records = this.recordsByUserId.get(userId)
    if (!records || records.length <= this.maxRecordsPerUser) {
      return
    }

    this.recordsByUserId.set(userId, records.slice(0, this.maxRecordsPerUser))
  }

  normalizeRecord(record) {
    return {
      ...record,
      finishedAt: Number.isFinite(record?.finishedAt) ? record.finishedAt : Date.now(),
      totalScore: toSafeNumber(record?.totalScore, 0),
      rank: Math.max(1, Math.floor(toSafeNumber(record?.rank, 3))),
      roundScores: Array.isArray(record?.roundScores)
        ? record.roundScores.map((score) => toSafeNumber(score, 0))
        : [],
      opponents: Array.isArray(record?.opponents)
        ? record.opponents.map((opponent) => ({
          playerId: opponent?.playerId || '',
          username: opponent?.username || '',
          totalScore: toSafeNumber(opponent?.totalScore, 0),
          rank: Math.max(1, Math.floor(toSafeNumber(opponent?.rank, 3))),
        }))
        : [],
    }
  }

  buildRecordsFromFinalScores({ roomId, finishedAt = Date.now(), finalScores = [] } = {}) {
    if (!Array.isArray(finalScores) || finalScores.length === 0) {
      return []
    }

    const rankByPlayerId = this.buildRankMap(finalScores)
    const safeFinishedAt = Number.isFinite(finishedAt) ? finishedAt : Date.now()
    const baseMatchId = `${roomId || 'room'}:${safeFinishedAt}`
    const records = []

    finalScores.forEach((playerScore, index) => {
      const playerId = typeof playerScore?.playerId === 'string' ? playerScore.playerId : ''
      if (!playerId) {
        return
      }

      const opponents = finalScores
        .filter((entry) => entry.playerId !== playerId)
        .map((entry) => ({
          playerId: entry.playerId,
          username: entry.username,
          totalScore: toSafeNumber(entry.totalScore, 0),
          rank: rankByPlayerId.get(entry.playerId) || null,
        }))

      records.push(this.normalizeRecord({
        userId: playerId,
        matchId: `${baseMatchId}:${index}`,
        roomId: roomId || '',
        finishedAt: safeFinishedAt,
        playerCount: finalScores.length,
        rank: rankByPlayerId.get(playerId) || finalScores.length,
        username: playerScore.username || playerId,
        totalScore: toSafeNumber(playerScore.totalScore, 0),
        roundScores: Array.isArray(playerScore.roundScores)
          ? playerScore.roundScores.map((score) => toSafeNumber(score, 0))
          : [],
        opponents,
      }))
    })

    return records
  }

  saveRecordsToMemory(records) {
    records.forEach((record) => {
      const userId = typeof record?.userId === 'string' ? record.userId : ''
      if (!userId) {
        return
      }

      const userRecords = this.recordsByUserId.get(userId) || []
      userRecords.unshift(record)
      this.recordsByUserId.set(userId, userRecords)
      this.trimUserRecords(userId)
    })
  }

  async recordGameFinished(payload = {}) {
    const records = this.buildRecordsFromFinalScores(payload)
    if (records.length === 0) {
      return
    }

    if (this.battleRecordRepository?.saveRecords) {
      try {
        await this.battleRecordRepository.saveRecords(records)
        return
      } catch (error) {
        // 降级到内存，避免影响对局流程
      }
    }

    this.saveRecordsToMemory(records)
  }

  buildTrend(records) {
    const trend = []
    let cumulativeScore = 0
    const ascendingRecords = [...records].reverse()
    ascendingRecords.forEach((record) => {
      cumulativeScore += toSafeNumber(record?.totalScore, 0)
      trend.push({
        matchId: record.matchId,
        finishedAt: record.finishedAt,
        deltaScore: toSafeNumber(record.totalScore, 0),
        cumulativeScore,
      })
    })
    return trend
  }

  buildSummaryPayload({
    totalGames,
    winCount,
    totalScoreChange,
    avgScore,
    recentScoreChange,
  }) {
    const safeTotalGames = Math.max(0, Math.floor(toSafeNumber(totalGames, 0)))
    const safeWinCount = Math.max(0, Math.floor(toSafeNumber(winCount, 0)))
    const safeTotalScoreChange = toSafeNumber(totalScoreChange, 0)
    const safeAvgScore = toSafeNumber(avgScore, 0)
    const safeRecentScoreChange = toSafeNumber(recentScoreChange, 0)
    const winRate = safeTotalGames > 0
      ? Number((safeWinCount / safeTotalGames).toFixed(4))
      : 0

    return {
      totalGames: safeTotalGames,
      winCount: safeWinCount,
      winRate,
      avgScore: Number(safeAvgScore.toFixed(2)),
      totalScoreChange: safeTotalScoreChange,
      recentScoreChange: safeRecentScoreChange,
    }
  }

  matchesRecordFilters(record, filters) {
    if (filters.roomId && String(record?.roomId || '') !== filters.roomId) {
      return false
    }

    if (filters.rank != null && Math.floor(toSafeNumber(record?.rank, 0)) !== filters.rank) {
      return false
    }

    const finishedAt = Math.floor(toSafeNumber(record?.finishedAt, 0))
    if (filters.startTime != null && finishedAt < filters.startTime) {
      return false
    }
    if (filters.endTime != null && finishedAt > filters.endTime) {
      return false
    }

    return true
  }

  filterRecords(records, filters) {
    return records.filter((record) => this.matchesRecordFilters(record, filters))
  }

  buildSummaryFromRecords(allRecords, recentRecords = allRecords) {
    const totalGames = allRecords.length
    const winCount = allRecords.filter((record) => record.rank === 1).length
    const totalScoreChange = allRecords.reduce((sum, record) => sum + toSafeNumber(record.totalScore, 0), 0)
    const recentScoreChange = recentRecords.reduce((sum, record) => sum + toSafeNumber(record.totalScore, 0), 0)
    const avgScore = totalGames > 0 ? totalScoreChange / totalGames : 0

    return this.buildSummaryPayload({
      totalGames,
      winCount,
      totalScoreChange,
      avgScore,
      recentScoreChange,
    })
  }

  buildPagination(total, page, limit) {
    const safeTotal = Math.max(0, Math.floor(toSafeNumber(total, 0)))
    const safePage = this.normalizePage(page, DEFAULT_QUERY_PAGE)
    const safeLimit = this.normalizeLimit(limit, 20)
    const totalPages = safeTotal > 0 ? Math.ceil(safeTotal / safeLimit) : 0

    return {
      total: safeTotal,
      page: safePage,
      limit: safeLimit,
      totalPages,
      hasMore: safePage * safeLimit < safeTotal,
    }
  }

  buildFiltersPayload(filters) {
    return {
      roomId: filters.roomId || '',
      rank: filters.rank == null ? null : filters.rank,
      startTime: filters.startTime == null ? null : filters.startTime,
      endTime: filters.endTime == null ? null : filters.endTime,
    }
  }

  buildBattleStatsPayload({ summary, records, pagination, filters }) {
    return {
      summary,
      records,
      trend: this.buildTrend(records),
      limit: pagination.limit,
      page: pagination.page,
      pagination,
      filters: this.buildFiltersPayload(filters),
    }
  }

  buildPayloadFromMemory(userId, queryOptions) {
    const allRecords = this.recordsByUserId.get(userId) || []
    const filteredRecords = this.filterRecords(allRecords, queryOptions)
    const startIndex = (queryOptions.page - 1) * queryOptions.limit
    const records = filteredRecords.slice(startIndex, startIndex + queryOptions.limit)
    const summary = this.buildSummaryFromRecords(filteredRecords, records)
    const pagination = this.buildPagination(filteredRecords.length, queryOptions.page, queryOptions.limit)

    return this.buildBattleStatsPayload({
      summary,
      records,
      pagination,
      filters: queryOptions,
    })
  }

  async getBattleStats(currentUser, options = {}) {
    if (!currentUser?.id) {
      throw new Error('用户未登录')
    }

    const queryOptions = this.normalizeQueryOptions(options)

    if (this.battleRecordRepository?.listByUserId && this.battleRecordRepository?.getSummaryByUserId) {
      try {
        const [listedResult, persistedSummary] = await Promise.all([
          this.battleRecordRepository.listByUserId(currentUser.id, queryOptions),
          this.battleRecordRepository.getSummaryByUserId(currentUser.id, queryOptions),
        ])

        const records = Array.isArray(listedResult)
          ? listedResult
          : (Array.isArray(listedResult?.records) ? listedResult.records : [])
        const total = Array.isArray(listedResult)
          ? records.length
          : toSafeNumber(listedResult?.total, persistedSummary?.totalGames || records.length)
        const page = Array.isArray(listedResult)
          ? queryOptions.page
          : this.normalizePage(listedResult?.page, queryOptions.page)
        const limit = Array.isArray(listedResult)
          ? queryOptions.limit
          : this.normalizeLimit(listedResult?.limit, queryOptions.limit)

        const recentScoreChange = records.reduce((sum, record) => sum + toSafeNumber(record.totalScore, 0), 0)
        const summary = this.buildSummaryPayload({
          totalGames: persistedSummary.totalGames,
          winCount: persistedSummary.winCount,
          totalScoreChange: persistedSummary.totalScoreChange,
          avgScore: persistedSummary.avgScore,
          recentScoreChange,
        })
        const pagination = this.buildPagination(total, page, limit)

        return this.buildBattleStatsPayload({
          summary,
          records,
          pagination,
          filters: queryOptions,
        })
      } catch (error) {
        // 降级到内存兜底
      }
    }

    return this.buildPayloadFromMemory(currentUser.id, queryOptions)
  }
}

module.exports = { BattleRecordService }
