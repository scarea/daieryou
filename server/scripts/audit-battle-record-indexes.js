const mongoose = require('mongoose')
const { loadRuntimeConfig } = require('../src/config/runtimeConfig')
const { BattleRecordRepository } = require('../src/infrastructure/battleRecordRepository')

async function main() {
  const runtimeConfig = loadRuntimeConfig()
  if (runtimeConfig.skipMongo) {
    console.error('索引巡检失败：当前配置跳过 MongoDB（DAIERYOU_SKIP_MONGO=true）')
    process.exitCode = 1
    return
  }

  await mongoose.connect(runtimeConfig.mongoUri)
  const repository = new BattleRecordRepository()
  const report = await repository.auditIndexes()
  console.log(JSON.stringify(report, null, 2))

  if (!report.healthy) {
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error('战绩索引巡检失败:', error.message)
  process.exitCode = 1
}).finally(async () => {
  try {
    await mongoose.disconnect()
  } catch (error) {
    // ignore disconnect errors
  }
})
