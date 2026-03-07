# AI 人机接入 PRD（MVP）

> 更新时间：2026-03-07  
> 状态：规划完成，待开发

## 1. 背景与问题
- 当前对局需要 3 名真人玩家，等待时长影响开局率。
- 当前“超时托管自动选牌”仅是兜底机制，不是可持续的人机对手。
- 计划引入 AI 相关能力，但大模型不适合直接进入实时出牌关键链路。

## 2. 产品目标（MVP）
1. 支持 waiting 房间补位 1-2 名 AI 玩家，降低等人开局成本。
2. AI 行为可控、可审计、可灰度开关，不影响现有真人对局稳定性。
3. 为后续“AI 陪练”和“LLM 复盘教练”预留统一决策接口。

## 3. 非目标（MVP 不做）
- 不做端到端 LLM 实时出牌主决策。
- 不做复杂人格化对话系统。
- 不做跨局长期记忆的 AI 对手成长系统。

## 4. 用户场景
1. 房主创建房间后，点击“添加 AI”，快速凑满 3 人并开局。
2. 真人掉线或离开后，按配置选择是否允许 AI 接管席位（可选，MVP 建议不启用）。
3. 局后查看 AI 操作摘要，用于争议排查与调优。

## 5. 成功指标（建议）
- 开局等待时长（P50/P90）下降。
- 房间开局率提升。
- AI 对局完成率稳定，异常中断率不高于真人对局基线。
- AI 决策超时 fallback 比例可控（例如 < 1%）。

## 6. 核心设计原则
1. 实时链路可预测：优先规则/策略引擎，LLM 不阻塞关键路径。
2. 失败可回退：决策超时或错误时立即走 fallback。
3. 公平可解释：AI 只能访问其可见信息，行为可审计。
4. 灰度可控：按环境/开关逐步放量。

## 7. 架构方案

### 7.1 决策分层
- `RuleDecisionProvider`（MVP 主决策）：基于规则或轻量策略，毫秒级返回。
- `FallbackProvider`：极端情况下兜底（例如选 `[0,1]`）。
- `LLMAdvisorProvider`（后续）：不进实时链路，局后复盘/建议使用。

### 7.2 统一接口（建议）
```ts
interface BotDecisionProvider {
  name: string
  decide(input: BotDecisionInput, budgetMs: number): Promise<BotDecisionOutput>
}
```

### 7.3 实时执行流程（每轮）
1. 轮到 AI 需要出牌时构造 `BotDecisionInput`（仅可见信息）。
2. 调用主 provider 并设置 `budgetMs`（例如 80-120ms）。
3. 超时/异常立即 fallback。
4. 写入 AI 审计日志（provider、latency、fallback、action）。

## 8. LLM 接入边界

### 8.1 可以接
- 局后复盘：解释关键回合为什么输赢。
- 陪练建议：给玩家下一步策略建议。
- 风格标签：稳健/激进等建议层输出。

### 8.2 不建议接（MVP）
- 回合内实时出牌主决策。

### 8.3 若必须实时用 LLM（后续）
- 只能作为“建议层”，最终动作仍由规则/策略引擎裁决。
- 必须设置严格 deadline 和 fallback。

## 9. 数据与审计设计

### 9.1 玩家对象扩展（建议）
- `isBot: boolean`
- `botProfileId: string`
- `botDifficulty: 'easy' | 'normal' | 'hard'`
- `decisionProvider: string`

### 9.2 AI 行为日志（建议新集合）
- `roomId`, `round`, `playerId`, `provider`, `inputHash`, `action`, `latencyMs`, `fallback`, `createdAt`

## 10. 接口与交互（MVP 建议）

### 10.1 后端路由
- `game.roomHandler.addBots`
  - 入参：`roomId`, `count`, `difficulty`, `operationId`
- `game.roomHandler.removeBot`
  - 入参：`roomId`, `botPlayerId`, `operationId`

### 10.2 前端
- 大厅房间页（waiting 状态、房主可见）增加：
  - “添加 AI（+1）”
  - “移除 AI”
  - AI 标签展示（难度/策略）

## 11. 配置与灰度
- `DAIERYOU_BOT_ENABLED`
- `DAIERYOU_BOT_MAX_PER_ROOM`
- `DAIERYOU_BOT_DECISION_TIMEOUT_MS`
- `DAIERYOU_BOT_DEFAULT_DIFFICULTY`
- `DAIERYOU_BOT_ALLOW_IN_RANKED`（如后续有排位）

默认建议：全部关闭，仅测试环境开启。

## 12. 验收口径（MVP）
1. 房主可在 waiting 房间补位 AI，满员后可正常开始与结算。
2. AI 决策超时不会阻塞回合，fallback 可用。
3. AI 对局日志可查询，可定位异常。
4. 关闭 `DAIERYOU_BOT_ENABLED` 后系统行为与当前完全一致。
5. 回归基线通过：`server test`、`test:e2e`、`build:client`。

## 13. 上线策略
1. Dev 环境验证：功能正确与日志完整。
2. Staging 灰度：仅内部账号可用，观察 3-7 天。
3. 生产灰度：小流量开放，监控等待时长/异常率/fallback 比例。

## 14. 主要风险
- 直接接入大模型实时决策导致时延和成本不可控。
- AI 强度失衡影响公平体验。
- 缺少审计与回放导致争议无法排查。
