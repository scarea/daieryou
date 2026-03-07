const DEFAULT_SWEEP_INTERVAL_MS = 60 * 60 * 1000
const DEFAULT_RETENTION_MS = 90 * 24 * 60 * 60 * 1000
const DEFAULT_CLEANUP_BATCH_SIZE = 500
const DEFAULT_MAX_BATCHES_PER_SWEEP = 3

function toSafePositiveInteger(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const number = Math.floor(Number(value))
  if (!Number.isFinite(number) || number < min) {
    return fallback
  }

  return Math.min(number, max)
}

class BattleRecordLifecycleService {
  constructor({
    battleRecordRepository = null,
    enabled = false,
    sweepIntervalMs = DEFAULT_SWEEP_INTERVAL_MS,
    retentionMs = DEFAULT_RETENTION_MS,
    cleanupBatchSize = DEFAULT_CLEANUP_BATCH_SIZE,
    maxBatchesPerSweep = DEFAULT_MAX_BATCHES_PER_SWEEP,
    archiveBeforeCleanup = true,
  } = {}) {
    this.battleRecordRepository = battleRecordRepository
    this.enabled = enabled === true
    this.sweepIntervalMs = toSafePositiveInteger(
      sweepIntervalMs,
      DEFAULT_SWEEP_INTERVAL_MS,
      { min: 1000 },
    )
    this.retentionMs = toSafePositiveInteger(
      retentionMs,
      DEFAULT_RETENTION_MS,
      { min: 1000 },
    )
    this.cleanupBatchSize = toSafePositiveInteger(
      cleanupBatchSize,
      DEFAULT_CLEANUP_BATCH_SIZE,
      { min: 1, max: 5000 },
    )
    this.maxBatchesPerSweep = toSafePositiveInteger(
      maxBatchesPerSweep,
      DEFAULT_MAX_BATCHES_PER_SWEEP,
      { min: 1, max: 100 },
    )
    this.archiveBeforeCleanup = archiveBeforeCleanup !== false
    this.timer = null
  }

  start() {
    if (!this.enabled || this.timer) {
      return
    }

    this.timer = setInterval(() => {
      this.cleanupExpiredRecords().then((result) => {
        if (!result.enabled) {
          return
        }

        if (result.deleted > 0 || result.archived > 0) {
          console.log(`[battle-record-lifecycle] cleanup archived=${result.archived} deleted=${result.deleted} expireBefore=${result.expireBefore}`)
        }
      }).catch((error) => {
        console.error('[battle-record-lifecycle] cleanup failed:', error.message)
      })
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

  async cleanupExpiredRecords(now = Date.now()) {
    if (!this.enabled || !this.battleRecordRepository?.archiveAndCleanupExpired) {
      return {
        enabled: false,
        archived: 0,
        deleted: 0,
        scanned: 0,
        expireBefore: null,
      }
    }

    const expireBefore = now - this.retentionMs
    let archived = 0
    let deleted = 0
    let scanned = 0
    let batches = 0

    for (let index = 0; index < this.maxBatchesPerSweep; index += 1) {
      const batch = await this.battleRecordRepository.archiveAndCleanupExpired({
        expireBefore,
        batchSize: this.cleanupBatchSize,
        archiveEnabled: this.archiveBeforeCleanup,
      })

      batches += 1
      archived += Number(batch?.archived) || 0
      deleted += Number(batch?.deleted) || 0
      scanned += Number(batch?.scanned) || 0

      if (!batch?.hasMore || Number(batch?.scanned) <= 0) {
        break
      }
    }

    return {
      enabled: true,
      archived,
      deleted,
      scanned,
      batches,
      expireBefore,
      retentionMs: this.retentionMs,
      cleanupBatchSize: this.cleanupBatchSize,
      archiveBeforeCleanup: this.archiveBeforeCleanup,
    }
  }

  async getIndexAuditReport() {
    if (!this.battleRecordRepository?.auditIndexes) {
      throw new Error('战绩索引巡检不可用')
    }

    return this.battleRecordRepository.auditIndexes()
  }
}

module.exports = { BattleRecordLifecycleService }
