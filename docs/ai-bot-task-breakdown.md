# AI 人机接入任务拆分（MVP）

> 关联文档：`docs/ai-bot-prd.md`  
> 更新时间：2026-03-07

## 0. 总体节奏
1. `S1`：后端能力骨架（玩家模型扩展 + 决策接口 + 路由）
2. `S2`：前端控制面板（房主添加/移除 AI + 房间内标签）
3. `S3`：观测与灰度（日志、指标、开关、回归）

## 1. S1 - 后端能力骨架

### T1.1 配置与运行时开关
- 文件：
  - `server/config/runtime-config.json`
  - `server/src/config/runtimeConfig.js`
- 交付：
  - 增加 `bot` 配置段：`enabled/maxPerRoom/decisionTimeoutMs/defaultDifficulty`
- 验收：
  - 环境变量可覆盖
  - 默认关闭不改变现网行为

### T1.2 决策接口与 provider
- 文件（建议新增）：
  - `server/src/application/bot/botDecisionService.js`
  - `server/src/application/bot/providers/ruleDecisionProvider.js`
  - `server/src/application/bot/providers/fallbackDecisionProvider.js`
- 交付：
  - 统一 `decide(input, budgetMs)` 接口
  - 超时/异常 fallback 逻辑
- 验收：
  - provider 超时不会阻塞回合
  - 返回动作满足规则约束

### T1.3 房间服务支持 AI 补位
- 文件：
  - `server/src/application/roomService.js`
  - `server/app/servers/game/handler/roomHandler.js`
  - `server/app.js`（allowlist）
- 交付：
  - 新增 `addBots/removeBot` 能力，仅房主可操作，仅 waiting 状态
- 验收：
  - AI 玩家数量受 `maxPerRoom` 限制
  - 真人玩家进入后可继续正常对局

### T1.4 对局流程接入 AI 决策
- 文件：
  - `server/src/application/gameService.js`
- 交付：
  - AI 玩家在轮次中自动决策（不等待手动输入）
  - 决策超时 fallback
- 验收：
  - 人机混合对局可完整结算
  - 不影响纯真人对局

## 2. S2 - 前端能力

### T2.1 房主控制入口
- 文件：
  - `client/src/scenes/RoomScene.jsx`
  - `client/src/services/gameService.js`
  - `client/src/store/gameStore.js`
- 交付：
  - waiting 状态房主可点击“添加 AI / 移除 AI”
- 验收：
  - 非房主看不到或不可操作
  - 操作反馈与错误提示一致

### T2.2 对局与列表展示
- 文件：
  - `client/src/scenes/RoomScene.jsx`
  - `client/src/scenes/GameScene.jsx`
- 交付：
  - AI 玩家标识（昵称/标签）
  - 托管与 AI 行为显示清晰
- 验收：
  - 真人/AI 身份不混淆

## 3. S3 - 观测、审计与灰度

### T3.1 AI 行为审计
- 文件（建议新增）：
  - `server/src/infrastructure/botActionLogRepository.js`
  - `server/src/application/bot/botActionLogService.js`
- 交付：
  - 记录 `roomId/round/playerId/provider/latency/fallback/action`
- 验收：
  - 可按 roomId 与时间检索

### T3.2 指标与日志
- 文件：
  - `server/app.js`
- 交付：
  - 指标：AI 决策次数、fallback 次数、超时次数、平均耗时
- 验收：
  - 网关/服务日志可定位 AI 异常

### T3.3 回归与发布
- 文件：
  - `server/tests/*`
  - `e2e/*`（新增人机场景用例）
- 交付：
  - 单测：房主权限、状态限制、fallback
  - e2e：房间补位 -> 开局 -> 结算
- 验收：
  - `cd server && npm test`
  - `npm run test:e2e`
  - `npm run build:client`

## 4. 任务优先级（建议）
1. T1.1
2. T1.2
3. T1.3
4. T1.4
5. T2.1
6. T2.2
7. T3.1
8. T3.2
9. T3.3

## 5. 上线门槛
- 灰度开关默认关闭
- fallback 稳定可用
- e2e 新增人机场景通过
- 审计日志可查
