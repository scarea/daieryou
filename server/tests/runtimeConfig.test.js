const test = require('node:test')
const assert = require('node:assert/strict')
const { loadRuntimeConfig } = require('../src/config/runtimeConfig')
const { DEFAULT_BOT_LLM_SYSTEM_PROMPT } = require('../src/application/bot/prompts')

test('loadRuntimeConfig should include battleRecordLifecycle defaults', () => {
  const config = loadRuntimeConfig({})

  assert.equal(config.battleRecordLifecycle.enabled, false)
  assert.equal(config.battleRecordLifecycle.sweepIntervalMs, 3600000)
  assert.equal(config.battleRecordLifecycle.retentionMs, 7776000000)
  assert.equal(config.battleRecordLifecycle.cleanupBatchSize, 500)
  assert.equal(config.battleRecordLifecycle.maxBatchesPerSweep, 3)
  assert.equal(config.battleRecordLifecycle.archiveBeforeCleanup, true)
  assert.equal(config.bot.enabled, false)
  assert.equal(config.bot.provider, 'rule')
  assert.equal(config.bot.maxPerRoom, 2)
  assert.equal(config.bot.decisionTimeoutMs, 120)
  assert.equal(config.bot.defaultDifficulty, 'normal')
  assert.equal(config.bot.llm.enabled, false)
  assert.equal(config.bot.llm.endpoint, 'https://api.openai.com/v1')
  assert.equal(config.bot.llm.apiKey, '')
  assert.equal(config.bot.llm.modelName, 'gpt-4o-mini')
  assert.equal(config.bot.llm.systemPrompt, DEFAULT_BOT_LLM_SYSTEM_PROMPT)
  assert.equal(config.game.roundSelectionTimeoutMs, 60000)
})

test('loadRuntimeConfig should parse battleRecordLifecycle env overrides', () => {
  const config = loadRuntimeConfig({
    DAIERYOU_BATTLE_RECORD_CLEANUP_ENABLED: '1',
    DAIERYOU_BATTLE_RECORD_CLEANUP_INTERVAL_MS: '7200000',
    DAIERYOU_BATTLE_RECORD_RETENTION_MS: '2592000000',
    DAIERYOU_BATTLE_RECORD_CLEANUP_BATCH_SIZE: '1000',
    DAIERYOU_BATTLE_RECORD_CLEANUP_MAX_BATCHES: '6',
    DAIERYOU_BATTLE_RECORD_ARCHIVE_BEFORE_CLEANUP: 'false',
    DAIERYOU_BOT_ENABLED: 'true',
    DAIERYOU_BOT_PROVIDER: 'LLM',
    DAIERYOU_BOT_MAX_PER_ROOM: '1',
    DAIERYOU_BOT_DECISION_TIMEOUT_MS: '200',
    DAIERYOU_BOT_DEFAULT_DIFFICULTY: 'HARD',
    DAIERYOU_BOT_LLM_ENABLED: 'true',
    DAIERYOU_BOT_LLM_ENDPOINT: 'https://example.com/v1',
    DAIERYOU_BOT_LLM_API_KEY: 'sk-test',
    DAIERYOU_BOT_LLM_MODEL_NAME: 'gpt-test',
    DAIERYOU_BOT_LLM_SYSTEM_PROMPT: 'custom prompt',
    DAIERYOU_ROUND_SELECTION_TIMEOUT_MS: '90000',
  })

  assert.equal(config.battleRecordLifecycle.enabled, true)
  assert.equal(config.battleRecordLifecycle.sweepIntervalMs, 7200000)
  assert.equal(config.battleRecordLifecycle.retentionMs, 2592000000)
  assert.equal(config.battleRecordLifecycle.cleanupBatchSize, 1000)
  assert.equal(config.battleRecordLifecycle.maxBatchesPerSweep, 6)
  assert.equal(config.battleRecordLifecycle.archiveBeforeCleanup, false)
  assert.equal(config.bot.enabled, true)
  assert.equal(config.bot.provider, 'llm')
  assert.equal(config.bot.maxPerRoom, 1)
  assert.equal(config.bot.decisionTimeoutMs, 200)
  assert.equal(config.bot.defaultDifficulty, 'hard')
  assert.equal(config.bot.llm.enabled, true)
  assert.equal(config.bot.llm.endpoint, 'https://example.com/v1')
  assert.equal(config.bot.llm.apiKey, 'sk-test')
  assert.equal(config.bot.llm.modelName, 'gpt-test')
  assert.equal(config.bot.llm.systemPrompt, 'custom prompt')
  assert.equal(config.game.roundSelectionTimeoutMs, 90000)
})
