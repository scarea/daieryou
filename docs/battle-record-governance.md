# 战绩治理与索引巡检说明

> 更新时间：2026-03-07

## 1. 治理目标
- 控制 `battle_records` 集合体量，避免长期增长导致查询退化与存储成本失控。
- 在清理历史战绩前先归档，降低误删导致的数据不可恢复风险。
- 为线上环境提供可重复执行的索引巡检流程。

## 2. 默认策略（按时间窗口）
- 清理窗口：保留最近 `90` 天战绩（`retentionMs=7776000000`）。
- 扫描周期：每 `1` 小时触发一次清理任务（`sweepIntervalMs=3600000`）。
- 单次批量：每批最多处理 `500` 条，单轮最多 `3` 批（最多 `1500` 条/小时）。
- 归档策略：默认开启“先归档后删除”（`archiveBeforeCleanup=true`）。
- 灰度开关：默认关闭（`enabled=false`），需显式开启。

## 3. 运行时配置

配置文件：`server/config/runtime-config.json` 的 `battleRecordLifecycle` 段，或环境变量覆盖：

- `DAIERYOU_BATTLE_RECORD_CLEANUP_ENABLED`
- `DAIERYOU_BATTLE_RECORD_CLEANUP_INTERVAL_MS`
- `DAIERYOU_BATTLE_RECORD_RETENTION_MS`
- `DAIERYOU_BATTLE_RECORD_CLEANUP_BATCH_SIZE`
- `DAIERYOU_BATTLE_RECORD_CLEANUP_MAX_BATCHES`
- `DAIERYOU_BATTLE_RECORD_ARCHIVE_BEFORE_CLEANUP`

## 4. 集合与索引基线

主集合：`battle_records`
- `{"userId":1,"matchId":1}`（唯一）
- `{"userId":1,"finishedAt":-1}`
- `{"userId":1,"roomId":1,"finishedAt":-1}`
- `{"userId":1,"rank":1,"finishedAt":-1}`

归档集合：`battle_record_archives`
- `{"userId":1,"matchId":1}`（唯一）
- `{"userId":1,"finishedAt":-1}`
- `{"archivedAt":-1}`

说明：巡检脚本会同时校验 schema 字段级索引（如 `userId`、`finishedAt`、`rank`）与上述关键复合索引。

## 5. 索引巡检执行

1. 确保 Mongo 可连通（不要设置 `DAIERYOU_SKIP_MONGO=1`）。
2. 执行：

```bash
cd server
npm run audit:battle-indexes
```

3. 判定标准：
- 输出 `healthy=true`：索引完整。
- 输出 `healthy=false`：按 `missing` 字段补齐缺失索引后重跑。

## 6. 灰度上线建议

1. 首次开启建议设置：
- `DAIERYOU_BATTLE_RECORD_CLEANUP_ENABLED=1`
- `DAIERYOU_BATTLE_RECORD_CLEANUP_BATCH_SIZE=100`
- `DAIERYOU_BATTLE_RECORD_CLEANUP_MAX_BATCHES=1`

2. 观察项：
- 清理日志中的 `archived/deleted` 数量是否一致。
- 战绩查询接口 P95/P99 是否有抖动。

3. 稳定后再逐步提升 `batchSize` 与 `maxBatchesPerSweep`。
