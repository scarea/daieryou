const mongoose = require('mongoose')

const opponentSchema = new mongoose.Schema({
  playerId: {
    type: String,
    required: true,
    trim: true,
  },
  username: {
    type: String,
    required: true,
    trim: true,
  },
  totalScore: {
    type: Number,
    required: true,
  },
  rank: {
    type: Number,
    required: true,
  },
}, {
  _id: false,
})

const battleRecordSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
    trim: true,
    index: true,
  },
  matchId: {
    type: String,
    required: true,
    trim: true,
  },
  roomId: {
    type: String,
    default: '',
    trim: true,
  },
  finishedAt: {
    type: Number,
    required: true,
    index: true,
  },
  playerCount: {
    type: Number,
    required: true,
  },
  rank: {
    type: Number,
    required: true,
    index: true,
  },
  username: {
    type: String,
    required: true,
    trim: true,
  },
  totalScore: {
    type: Number,
    required: true,
  },
  roundScores: {
    type: [Number],
    default: [],
  },
  opponents: {
    type: [opponentSchema],
    default: [],
  },
  createdAt: {
    type: Number,
    required: true,
  },
  updatedAt: {
    type: Number,
    required: true,
  },
}, {
  versionKey: false,
  collection: 'battle_records',
})

battleRecordSchema.index({ userId: 1, matchId: 1 }, { unique: true })
battleRecordSchema.index({ userId: 1, finishedAt: -1 })
battleRecordSchema.index({ userId: 1, roomId: 1, finishedAt: -1 })
battleRecordSchema.index({ userId: 1, rank: 1, finishedAt: -1 })

const battleRecordArchiveSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
    trim: true,
    index: true,
  },
  matchId: {
    type: String,
    required: true,
    trim: true,
  },
  roomId: {
    type: String,
    default: '',
    trim: true,
  },
  finishedAt: {
    type: Number,
    required: true,
    index: true,
  },
  playerCount: {
    type: Number,
    required: true,
  },
  rank: {
    type: Number,
    required: true,
    index: true,
  },
  username: {
    type: String,
    required: true,
    trim: true,
  },
  totalScore: {
    type: Number,
    required: true,
  },
  roundScores: {
    type: [Number],
    default: [],
  },
  opponents: {
    type: [opponentSchema],
    default: [],
  },
  createdAt: {
    type: Number,
    required: true,
  },
  updatedAt: {
    type: Number,
    required: true,
  },
  archivedAt: {
    type: Number,
    required: true,
    index: true,
  },
}, {
  versionKey: false,
  collection: 'battle_record_archives',
})

battleRecordArchiveSchema.index({ userId: 1, matchId: 1 }, { unique: true })
battleRecordArchiveSchema.index({ userId: 1, finishedAt: -1 })
battleRecordArchiveSchema.index({ archivedAt: -1 })

const BattleRecordModel = mongoose.models.DaieryouBattleRecord
  || mongoose.model('DaieryouBattleRecord', battleRecordSchema)
const BattleRecordArchiveModel = mongoose.models.DaieryouBattleRecordArchive
  || mongoose.model('DaieryouBattleRecordArchive', battleRecordArchiveSchema)

const EXPECTED_PRIMARY_INDEXES = battleRecordSchema.indexes().map(([key, options]) => ({
  key,
  unique: options?.unique === true,
}))
const EXPECTED_ARCHIVE_INDEXES = battleRecordArchiveSchema.indexes().map(([key, options]) => ({
  key,
  unique: options?.unique === true,
}))

function normalizeMongooseDocument(document) {
  if (!document) {
    return null
  }

  const object = typeof document.toObject === 'function'
    ? document.toObject()
    : document
  const { _id, ...rest } = object
  return rest
}

class BattleRecordRepository {
  ensureDatabaseReady() {
    if (mongoose.connection.readyState !== 1) {
      throw new Error('战绩系统暂不可用，请检查 MongoDB 连接')
    }
  }

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

  buildMatchQuery(normalizedUserId, options = {}) {
    const query = { userId: normalizedUserId }
    if (options.roomId) {
      query.roomId = options.roomId
    }
    if (options.rank != null) {
      query.rank = options.rank
    }
    if (options.startTime != null || options.endTime != null) {
      query.finishedAt = {}
      if (options.startTime != null) {
        query.finishedAt.$gte = options.startTime
      }
      if (options.endTime != null) {
        query.finishedAt.$lte = options.endTime
      }
    }

    return query
  }

  buildExpiredMatchQuery(expireBefore) {
    return {
      finishedAt: { $lt: expireBefore },
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

  async saveRecords(records = []) {
    this.ensureDatabaseReady()
    if (!Array.isArray(records) || records.length === 0) {
      return { upserted: 0 }
    }

    const now = Date.now()
    const operations = records
      .map((record) => this.normalizeRecord(record, now))
      .filter(Boolean)
      .map((record) => ({
        updateOne: {
          filter: {
            userId: record.userId,
            matchId: record.matchId,
          },
          update: {
            $set: record,
            $setOnInsert: {
              createdAt: now,
            },
          },
          upsert: true,
        },
      }))

    if (operations.length === 0) {
      return { upserted: 0 }
    }

    await BattleRecordModel.bulkWrite(operations, { ordered: false })
    return { upserted: operations.length }
  }

  async listByUserId(userId, options = {}) {
    this.ensureDatabaseReady()
    const normalizedUserId = this.normalizeText(userId, 64)
    if (!normalizedUserId) {
      return {
        records: [],
        total: 0,
        page: 1,
        limit: this.normalizePositiveInteger(options?.limit, 20, { min: 1, max: 100 }),
      }
    }

    const queryOptions = this.normalizeQueryOptions(options)
    const query = this.buildMatchQuery(normalizedUserId, queryOptions)
    const skip = (queryOptions.page - 1) * queryOptions.limit

    const [rows, total] = await Promise.all([
      BattleRecordModel.find(query)
        .sort({ finishedAt: -1, updatedAt: -1 })
        .skip(skip)
        .limit(queryOptions.limit)
        .lean()
        .exec(),
      BattleRecordModel.countDocuments(query).exec(),
    ])

    return {
      records: rows.map((row) => normalizeMongooseDocument(row)),
      total: this.normalizeNumber(total, 0),
      page: queryOptions.page,
      limit: queryOptions.limit,
    }
  }

  async getSummaryByUserId(userId, options = {}) {
    this.ensureDatabaseReady()
    const normalizedUserId = this.normalizeText(userId, 64)
    if (!normalizedUserId) {
      return this.buildEmptySummary()
    }

    const queryOptions = this.normalizeQueryOptions(options)
    const query = this.buildMatchQuery(normalizedUserId, queryOptions)
    const rows = await BattleRecordModel.aggregate([
      { $match: query },
      {
        $group: {
          _id: '$userId',
          totalGames: { $sum: 1 },
          winCount: {
            $sum: {
              $cond: [{ $eq: ['$rank', 1] }, 1, 0],
            },
          },
          totalScoreChange: { $sum: '$totalScore' },
          avgScore: { $avg: '$totalScore' },
        },
      },
    ]).exec()

    const summary = rows[0]
    if (!summary) {
      return this.buildEmptySummary()
    }

    return {
      totalGames: this.normalizeNumber(summary.totalGames, 0),
      winCount: this.normalizeNumber(summary.winCount, 0),
      totalScoreChange: this.normalizeNumber(summary.totalScoreChange, 0),
      avgScore: this.normalizeNumber(summary.avgScore, 0),
    }
  }

  async archiveAndCleanupExpired(options = {}) {
    this.ensureDatabaseReady()
    const normalizedOptions = this.normalizeCleanupOptions(options)
    const query = this.buildExpiredMatchQuery(normalizedOptions.expireBefore)
    const rows = await BattleRecordModel.find(query)
      .sort({ finishedAt: 1, updatedAt: 1 })
      .limit(normalizedOptions.batchSize)
      .lean()
      .exec()

    if (rows.length === 0) {
      return {
        scanned: 0,
        archived: 0,
        deleted: 0,
        hasMore: false,
      }
    }

    if (normalizedOptions.archiveEnabled) {
      const archivedAt = Date.now()
      const operations = rows.map((row) => {
        const { _id, ...record } = row
        return {
          updateOne: {
            filter: {
              userId: record.userId,
              matchId: record.matchId,
            },
            update: {
              $set: {
                ...record,
                archivedAt,
              },
            },
            upsert: true,
          },
        }
      })

      await BattleRecordArchiveModel.bulkWrite(operations, { ordered: false })
    }

    const ids = rows
      .map((row) => row?._id)
      .filter(Boolean)
    const deleteResult = ids.length > 0
      ? await BattleRecordModel.deleteMany({ _id: { $in: ids } }).exec()
      : { deletedCount: 0 }
    const deleted = this.normalizeNumber(deleteResult?.deletedCount, 0)

    return {
      scanned: rows.length,
      archived: normalizedOptions.archiveEnabled ? rows.length : 0,
      deleted,
      hasMore: rows.length >= normalizedOptions.batchSize,
    }
  }

  async safeListIndexes(model) {
    try {
      return await model.collection.indexes()
    } catch (error) {
      if (error?.codeName === 'NamespaceNotFound' || /ns does not exist/i.test(error?.message || '')) {
        return []
      }
      throw error
    }
  }

  normalizeIndexes(rows = []) {
    return rows.map((row) => ({
      name: row?.name || '',
      key: row?.key || {},
      unique: row?.unique === true,
    }))
  }

  findMissingIndexes(expected, actual) {
    const actualByKey = new Map(
      actual.map((entry) => [JSON.stringify(entry.key), entry]),
    )

    return expected
      .filter((target) => {
        const matched = actualByKey.get(JSON.stringify(target.key))
        if (!matched) {
          return true
        }

        if (target.unique !== matched.unique) {
          return true
        }

        return false
      })
      .map((target) => ({
        key: target.key,
        unique: target.unique,
      }))
  }

  async auditIndexes() {
    this.ensureDatabaseReady()

    const [primaryRows, archiveRows] = await Promise.all([
      this.safeListIndexes(BattleRecordModel),
      this.safeListIndexes(BattleRecordArchiveModel),
    ])

    const primaryIndexes = this.normalizeIndexes(primaryRows)
    const archiveIndexes = this.normalizeIndexes(archiveRows)
    const primaryMissing = this.findMissingIndexes(EXPECTED_PRIMARY_INDEXES, primaryIndexes)
    const archiveMissing = this.findMissingIndexes(EXPECTED_ARCHIVE_INDEXES, archiveIndexes)

    return {
      healthy: primaryMissing.length === 0 && archiveMissing.length === 0,
      primary: {
        expected: EXPECTED_PRIMARY_INDEXES,
        indexes: primaryIndexes,
        missing: primaryMissing,
      },
      archive: {
        expected: EXPECTED_ARCHIVE_INDEXES,
        indexes: archiveIndexes,
        missing: archiveMissing,
      },
    }
  }
}

module.exports = { BattleRecordRepository }
