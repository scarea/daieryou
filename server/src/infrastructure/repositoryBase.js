// 存储层公共的校验/归一化逻辑，不依赖任何数据库驱动。
// MongoDB 与 Postgres 两套存储都继承这些基类，保证行为一致。

class AccountRepositoryBase {
  normalizeEmail(email) {
    if (typeof email !== 'string') {
      return ''
    }

    return email.trim().toLowerCase()
  }
}

class InviteCodeRepositoryBase {
  normalizeCode(code) {
    if (typeof code !== 'string') {
      return ''
    }

    return code.trim().toUpperCase()
  }

  normalizeText(value, maxLength = 64) {
    if (typeof value !== 'string') {
      return ''
    }

    return value.trim().slice(0, maxLength)
  }
}

class AdminAuditRepositoryBase {
  normalizeText(value, maxLength = 120) {
    if (typeof value !== 'string') {
      return ''
    }

    return value.trim().slice(0, maxLength)
  }

  normalizeEmail(value) {
    const normalized = this.normalizeText(value, 120)
    return normalized ? normalized.toLowerCase() : ''
  }

  normalizeDetail(detail) {
    if (!detail || typeof detail !== 'object') {
      return {}
    }

    try {
      const serialized = JSON.stringify(detail)
      const parsed = JSON.parse(serialized)
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch (error) {
      return {}
    }
  }
}

class BattleRecordRepositoryBase {
  normalizeText(value, maxLength = 64) {
    if (typeof value !== 'string') {
      return ''
    }

    return value.trim().slice(0, maxLength)
  }

  normalizeNumber(value, fallback = 0) {
    const number = Number(value)
    if (!Number.isFinite(number)) {
      return fallback
    }
    return number
  }

  normalizePositiveInteger(value, fallback = 1, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
    const number = Math.floor(this.normalizeNumber(value, fallback))
    if (!Number.isFinite(number)) {
      return fallback
    }
    return Math.min(max, Math.max(min, number))
  }

  normalizeRank(value, fallback = 3) {
    const rank = Math.floor(this.normalizeNumber(value, fallback))
    return rank >= 1 ? rank : fallback
  }

  normalizeOptionalRank(value) {
    if (value == null || value === '') {
      return null
    }

    const rank = Math.floor(this.normalizeNumber(value, Number.NaN))
    if (!Number.isFinite(rank) || rank < 1) {
      return null
    }

    return rank
  }

  normalizeOptionalTimestamp(value) {
    if (value == null || value === '') {
      return null
    }

    const timestamp = Math.floor(this.normalizeNumber(value, Number.NaN))
    if (!Number.isFinite(timestamp) || timestamp < 0) {
      return null
    }

    return timestamp
  }

  normalizeCleanupOptions(options = {}) {
    return {
      expireBefore: this.normalizePositiveInteger(options?.expireBefore, Date.now(), { min: 1 }),
      batchSize: this.normalizePositiveInteger(options?.batchSize, 500, { min: 1, max: 5000 }),
      archiveEnabled: options?.archiveEnabled !== false,
    }
  }

  normalizeQueryOptions(options = {}) {
    return {
      limit: this.normalizePositiveInteger(options?.limit, 20, { min: 1, max: 100 }),
      page: this.normalizePositiveInteger(options?.page, 1, { min: 1, max: 100000 }),
      roomId: this.normalizeText(options?.roomId, 64),
      rank: this.normalizeOptionalRank(options?.rank),
      startTime: this.normalizeOptionalTimestamp(options?.startTime),
      endTime: this.normalizeOptionalTimestamp(options?.endTime),
    }
  }

  buildEmptySummary() {
    return {
      totalGames: 0,
      winCount: 0,
      totalScoreChange: 0,
      avgScore: 0,
    }
  }

  normalizeRoundScores(roundScores) {
    if (!Array.isArray(roundScores)) {
      return []
    }

    return roundScores.map((score) => this.normalizeNumber(score, 0))
  }

  normalizeOpponents(opponents) {
    if (!Array.isArray(opponents)) {
      return []
    }

    return opponents
      .map((opponent) => ({
        playerId: this.normalizeText(opponent?.playerId, 64),
        username: this.normalizeText(opponent?.username, 64),
        totalScore: this.normalizeNumber(opponent?.totalScore, 0),
        rank: this.normalizeRank(opponent?.rank, 3),
      }))
      .filter((opponent) => opponent.playerId)
  }

  normalizeRecord(record, now = Date.now()) {
    const userId = this.normalizeText(record?.userId, 64)
    const matchId = this.normalizeText(record?.matchId, 120)
    if (!userId || !matchId) {
      return null
    }

    return {
      userId,
      matchId,
      roomId: this.normalizeText(record?.roomId, 64),
      finishedAt: this.normalizeNumber(record?.finishedAt, now),
      playerCount: Math.max(2, Math.floor(this.normalizeNumber(record?.playerCount, 3))),
      rank: this.normalizeRank(record?.rank, 3),
      username: this.normalizeText(record?.username, 64) || userId,
      totalScore: this.normalizeNumber(record?.totalScore, 0),
      roundScores: this.normalizeRoundScores(record?.roundScores),
      opponents: this.normalizeOpponents(record?.opponents),
      updatedAt: now,
    }
  }
}

module.exports = {
  AccountRepositoryBase,
  InviteCodeRepositoryBase,
  AdminAuditRepositoryBase,
  BattleRecordRepositoryBase,
}
