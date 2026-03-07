const test = require('node:test')
const assert = require('node:assert/strict')
const { BattleRecordLifecycleService } = require('../src/application/battleRecordLifecycleService')

test('battleRecordLifecycleService should skip cleanup when disabled', async () => {
  const service = new BattleRecordLifecycleService({
    battleRecordRepository: {
      async archiveAndCleanupExpired() {
        throw new Error('should not be called')
      },
    },
    enabled: false,
  })

  const result = await service.cleanupExpiredRecords(10_000)
  assert.equal(result.enabled, false)
  assert.equal(result.deleted, 0)
  assert.equal(result.archived, 0)
})

test('battleRecordLifecycleService should cleanup expired records in batches', async () => {
  const calls = []
  const service = new BattleRecordLifecycleService({
    battleRecordRepository: {
      async archiveAndCleanupExpired(options) {
        calls.push(options)
        if (calls.length === 1) {
          return {
            scanned: 2,
            archived: 2,
            deleted: 2,
            hasMore: true,
          }
        }
        return {
          scanned: 1,
          archived: 1,
          deleted: 1,
          hasMore: false,
        }
      },
    },
    enabled: true,
    retentionMs: 1000,
    cleanupBatchSize: 2,
    maxBatchesPerSweep: 5,
    archiveBeforeCleanup: true,
  })

  const result = await service.cleanupExpiredRecords(10_000)
  assert.equal(calls.length, 2)
  assert.equal(calls[0].expireBefore, 9000)
  assert.equal(calls[0].batchSize, 2)
  assert.equal(calls[0].archiveEnabled, true)
  assert.equal(result.enabled, true)
  assert.equal(result.scanned, 3)
  assert.equal(result.archived, 3)
  assert.equal(result.deleted, 3)
  assert.equal(result.batches, 2)
})

test('battleRecordLifecycleService should proxy index audit call', async () => {
  const expected = {
    healthy: true,
  }
  const service = new BattleRecordLifecycleService({
    battleRecordRepository: {
      async auditIndexes() {
        return expected
      },
    },
    enabled: true,
  })

  const report = await service.getIndexAuditReport()
  assert.equal(report, expected)
})
