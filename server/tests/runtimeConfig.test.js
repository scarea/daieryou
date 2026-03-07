const test = require('node:test')
const assert = require('node:assert/strict')
const { loadRuntimeConfig } = require('../src/config/runtimeConfig')

test('loadRuntimeConfig should include battleRecordLifecycle defaults', () => {
  const config = loadRuntimeConfig({})

  assert.equal(config.battleRecordLifecycle.enabled, false)
  assert.equal(config.battleRecordLifecycle.sweepIntervalMs, 3600000)
  assert.equal(config.battleRecordLifecycle.retentionMs, 7776000000)
  assert.equal(config.battleRecordLifecycle.cleanupBatchSize, 500)
  assert.equal(config.battleRecordLifecycle.maxBatchesPerSweep, 3)
  assert.equal(config.battleRecordLifecycle.archiveBeforeCleanup, true)
})

test('loadRuntimeConfig should parse battleRecordLifecycle env overrides', () => {
  const config = loadRuntimeConfig({
    DAIERYOU_BATTLE_RECORD_CLEANUP_ENABLED: '1',
    DAIERYOU_BATTLE_RECORD_CLEANUP_INTERVAL_MS: '7200000',
    DAIERYOU_BATTLE_RECORD_RETENTION_MS: '2592000000',
    DAIERYOU_BATTLE_RECORD_CLEANUP_BATCH_SIZE: '1000',
    DAIERYOU_BATTLE_RECORD_CLEANUP_MAX_BATCHES: '6',
    DAIERYOU_BATTLE_RECORD_ARCHIVE_BEFORE_CLEANUP: 'false',
  })

  assert.equal(config.battleRecordLifecycle.enabled, true)
  assert.equal(config.battleRecordLifecycle.sweepIntervalMs, 7200000)
  assert.equal(config.battleRecordLifecycle.retentionMs, 2592000000)
  assert.equal(config.battleRecordLifecycle.cleanupBatchSize, 1000)
  assert.equal(config.battleRecordLifecycle.maxBatchesPerSweep, 6)
  assert.equal(config.battleRecordLifecycle.archiveBeforeCleanup, false)
})
