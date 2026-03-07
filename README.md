# 逮二游 - 三人炸金花棋牌游戏

一个基于Web的多人在线棋牌游戏，支持3人同时游戏的炸金花变种玩法。

## 游戏规则

### 基本规则
- 3名玩家一个房间
- 使用54张牌（A-K + 大小王）
- 大小王作为赖子：自动按当前三张组合推导为“最大牌型”（无需手动声明）
- 每轮比大小，第二名为输家
- 共进行5轮游戏

### 游戏流程
1. **第1轮**: 每人发5张起始牌，配合第1张公牌选择2张；出牌进入“出牌区”，不会回到手牌
2. **第2-3轮**: 每轮结算后，按“本轮输家先摸”顺序每人摸2张，手牌回到5张，再继续选牌
3. **第4轮**: 暗牌公牌回合（牌面隐藏），仍需选择2张；本轮后不再摸牌
4. **第5轮**: 无公牌，直接用每人剩余3张手牌比大小并结算最终积分

### 积分规则
- 各轮积分: 1、2、3、4、5分（可配置）
- 次名为输家：需要分别向头名与末位各结算一笔积分
- 常规单笔结算分值为当轮基础分
- 若“输家”和“某一位赢家”都为豹子（含赖子自动推导成豹子），该笔结算翻倍
- 输家本轮总扣分 = 对两位赢家两笔结算之和；两位赢家本轮加分可不同
- 最终统计总积分排名

示例（当轮基础分 = 1）：
- 牌型：`QQQ`（头名）、`888`（次名）、`AJ4`（末位）
- 结算：次名输给头名 `2` 分（豹子对豹子翻倍），次名输给末位 `1` 分（常规）
- 本轮积分变化：头名 `+2`、次名 `-3`、末位 `+1`

## 技术栈

### 前端
- React + JavaScript
- Ant Design UI组件
- Zustand 状态管理
- 原生 WebSocket 实时通信
- Vite 构建工具

### 后端
- Node.js + JavaScript
- `ws` WebSocket 服务
- 内存仓库（可选连接 MongoDB）

## 项目结构

```
daieryou/
├── client/                 # 前端项目
│   ├── src/
│   │   ├── components/    # UI组件
│   │   ├── scenes/        # 游戏场景
│   │   ├── store/         # 状态管理
│   │   └── utils/         # 工具函数
│   └── package.json
├── server/                # 后端项目
│   ├── app/
│   │   └── servers/       # 协议路由处理器
│   ├── config/            # 配置文件
│   └── package.json
└── shared/                # 共享代码
    └── game-rules/        # 游戏规则
```

## 快速开始

### 安装依赖
```bash
# 安装所有依赖
npm run install:all

# 或分别安装
cd client && npm install
cd ../server && npm install
```

### 启动服务

1. 启动服务器
```bash
cd server
npm start
```

2. 启动前端（新终端）
```bash
cd client
npm run dev
```

3. 访问游戏
打开浏览器访问 http://localhost:3000

### 一键启动（本地开发）
```bash
npm run dev:all
```

默认行为：
- 自动检测并安装 workspace 依赖（`node_modules` 缺失时）
- 启动后端：`ws://localhost:3014`
- 启动前端：`http://localhost:3000`

可选环境变量：
- `DAIERYOU_WS_PORT`：后端端口（默认 `3014`）
- `DAIERYOU_CLIENT_PORT`：前端端口（默认 `3000`）
- `DAIERYOU_SKIP_MONGO`：是否跳过 Mongo（默认 `0`，建议保持开启）

### 运行时配置
后端运行时参数默认在 `server/config/runtime-config.json`，也支持环境变量覆盖：

- `DAIERYOU_WS_PORT`: WebSocket 服务端口（默认 `3014`）
- `DAIERYOU_MONGO_URI`: MongoDB 连接串
- `DAIERYOU_SKIP_MONGO`: 是否跳过 Mongo 连接（`1/true`）
- `DAIERYOU_DISCONNECT_GRACE_MS`: 断线保席窗口（默认 `15000`）
- `DAIERYOU_MAX_USER_PROFILES`: 内存用户档案缓存上限（默认 `5000`）
- `DAIERYOU_SESSION_TOKEN_SECRET`: 会话签名密钥（生产环境务必替换）
- `DAIERYOU_SESSION_TOKEN_TTL_MS`: 会话 token 有效期（默认 `2592000000`，30 天）
- `DAIERYOU_WS_MAX_PAYLOAD_BYTES`: 单条 WebSocket 消息最大字节数（默认 `65536`）
- `DAIERYOU_REQUEST_RATE_WINDOW_MS`: 限流窗口时长（默认 `1000`）
- `DAIERYOU_REQUEST_RATE_MAX_REQUESTS`: 每连接每窗口最大请求数（默认 `80`）
- `DAIERYOU_REQUEST_DEDUP_TTL_MS`: 幂等响应缓存时长（默认 `3000`）
- `DAIERYOU_REQUEST_DEDUP_MAX_ENTRIES`: 幂等缓存最大条目数（默认 `20000`）
- `DAIERYOU_MAX_IN_MEMORY_ROOMS`: 内存房间上限（默认 `5000`，超限会本地淘汰低优先级房间）
- `DAIERYOU_REDIS_URI`: Redis 连接串（配置后启用房间热状态镜像）
- `DAIERYOU_ROOM_MIRROR_KEY_PREFIX`: Redis 镜像键前缀（默认 `daieryou:room-mirror`）
- `DAIERYOU_ROOM_MIRROR_SNAPSHOT_TTL_MS`: 单房间镜像 TTL（默认 `86400000`）
- `DAIERYOU_ROOM_MIRROR_CONNECT_TIMEOUT_MS`: Redis 连接超时（默认 `3000`）
- `DAIERYOU_ROOM_MIRROR_SYNC_INTERVAL_MS`: 增量同步间隔（默认 `5000`）
- `DAIERYOU_ROOM_MIRROR_PREFER_READS`: 是否优先从 Redis 镜像读（`1/true`，默认关闭）
- `DAIERYOU_ROOM_MIRROR_PRIMARY_WRITES`: 是否启用 Redis 主写模式（`1/true`；失败时自动降级本地写并入重试队列）
- `DAIERYOU_ROOM_MIRROR_RETRY_INTERVAL_MS`: 镜像写失败重试间隔（默认 `2000`）
- `DAIERYOU_EMAIL_TRANSPORT`: 邮件发送通道（`console`/`webhook`/`resend`，默认 `console`）
- `DAIERYOU_EMAIL_WEBHOOK_URL`: 自定义邮件 webhook 地址（`transport=webhook` 时生效）
- `DAIERYOU_RESEND_API_KEY`: Resend API Key（`transport=resend` 时生效）
- `DAIERYOU_EMAIL_FROM`: 发件地址（`transport=resend` 时必填）
- `DAIERYOU_EMAIL_VERIFY_CODE_TTL_MS`: 验证码有效期（默认 `600000`）
- `DAIERYOU_EMAIL_SEND_COOLDOWN_MS`: 同邮箱发送冷却（默认 `60000`）
- `DAIERYOU_EMAIL_MAX_VERIFY_ATTEMPTS`: 验证码最大尝试次数（默认 `5`）
- `DAIERYOU_EMAIL_EXPOSE_DEV_CODE`: 开发模式是否在接口返回 `debugCode`（默认 `false`）
- `DAIERYOU_AUTH_MEMBER_DEFAULT_DAYS`: 会员默认开通/续费天数（默认 `30`）
- `DAIERYOU_AUTH_ADMIN_EMAILS`: 管理员邮箱白名单（逗号分隔）
- `DAIERYOU_AUTH_ADMIN_INVITE_LIST_LIMIT`: 管理端单次邀请码列表上限（默认 `50`）
- `DAIERYOU_AUTH_ADMIN_AUDIT_LIST_LIMIT`: 管理端单次审计日志列表上限（默认 `50`）
- `DAIERYOU_VERBOSE_LOG`: 是否输出每条消息日志（`1` 启用）
- `DAIERYOU_ROOM_SWEEP_INTERVAL_MS`: 房间回收扫描间隔
- `DAIERYOU_FINISHED_ROOM_TTL_MS`: 结算房间回收阈值
- `DAIERYOU_OFFLINE_WAITING_ROOM_TTL_MS`: 全离线等待房间回收阈值
- `DAIERYOU_BATTLE_RECORD_CLEANUP_ENABLED`: 战绩清理任务灰度开关（默认关闭）
- `DAIERYOU_BATTLE_RECORD_CLEANUP_INTERVAL_MS`: 战绩清理扫描间隔
- `DAIERYOU_BATTLE_RECORD_RETENTION_MS`: 战绩保留窗口（毫秒）
- `DAIERYOU_BATTLE_RECORD_CLEANUP_BATCH_SIZE`: 单批清理条数
- `DAIERYOU_BATTLE_RECORD_CLEANUP_MAX_BATCHES`: 单轮最大清理批次数
- `DAIERYOU_BATTLE_RECORD_ARCHIVE_BEFORE_CLEANUP`: 是否先归档再删除
- `DAIERYOU_BOT_ENABLED`: 是否启用 AI 人机能力（默认关闭）
- `DAIERYOU_BOT_PROVIDER`: AI 决策提供方（`rule/llm`，默认 `rule`；当前仅 `rule` 生效）
- `DAIERYOU_BOT_MAX_PER_ROOM`: 单房间最多 AI 数量（默认 `2`）
- `DAIERYOU_BOT_DECISION_TIMEOUT_MS`: AI 决策超时阈值（默认 `120`）
- `DAIERYOU_BOT_DEFAULT_DIFFICULTY`: 默认 AI 难度（`easy/normal/hard`，默认 `normal`）
- `DAIERYOU_BOT_LLM_ENABLED`: 是否开启 LLM 配置段（默认关闭，当前仅做配置预留）
- `DAIERYOU_BOT_LLM_ENDPOINT`: LLM API Endpoint（默认 `https://api.openai.com/v1`）
- `DAIERYOU_BOT_LLM_API_KEY`: LLM API Key（当前仅读取，不发起调用）
- `DAIERYOU_BOT_LLM_MODEL_NAME`: LLM 模型名（默认 `gpt-4o-mini`）
- `DAIERYOU_BOT_LLM_SYSTEM_PROMPT`: LLM 系统提示词（支持环境变量覆盖默认模板）
- `DAIERYOU_ROUND_SELECTION_TIMEOUT_MS`: 回合选牌时限默认值（默认 `60000`，可在创建房间时覆盖）

## 游戏特性

### 已实现功能
- ✅ 用户登录系统
- ✅ 邮箱账号体系（验证码注册 + 密码登录）
- ✅ 会员体系 MVP（自助开通/续费）
- ✅ 邀请码体系（会员生成 + 注册消费）
- ✅ 管理台 MVP（会员发放 + 邀请码列表/禁用）
- ✅ 管理审计日志 MVP（关键操作落审计 + 管理员列表查询）
- ✅ 战绩总览 MVP（近 N 局结果、胜率、总分变化，Mongo 持久化）
- ✅ 战绩治理基础（按时间窗口归档/清理 + 索引巡检脚本）
- ✅ 房间创建/加入
- ✅ 实时多人游戏
- ✅ 完整的炸金花牌型判断
- ✅ 5轮游戏流程
- ✅ 积分计算系统
- ✅ 暗牌机制
- ✅ 当前回合公牌高亮（其余公牌弱化显示）
- ✅ 游戏历史记录

### 战绩能力现状（2026-03-07）
- 查询能力：支持 `page/limit` 分页，支持 `roomId/rank/startTime/endTime` 过滤。
- 治理能力：支持按保留窗口分批“归档后清理”，默认关闭，需灰度开启。
- 巡检能力：支持 `npm run audit:battle-indexes` 校验主集合与归档集合索引完整性。
- 下一步：补齐战绩查询性能基线（Explain/压测）与对外字段文档。

### AI 人机接入状态（进行中）
- 当前已支持：回合超时托管自动选牌（非 AI 对手）。
- 后端已支持：房主在 waiting 房间补位/移除 AI（接口已就绪）、bot 自动决策与 fallback。
- 前端已支持：waiting 房间房主“添加 AI / 移除 AI”入口与 AI 标签展示。
- 前端已支持：大厅一键“单机开局（1人+2AI）”与“调试房（1人+2AI，不自动开局）”。
- 前后端已支持：已出牌不会回到任意玩家手牌或牌堆，AI 估算时也会排除已打出牌。
- 前端已修复：对局改为玩家视角（手牌在下方），并优化为默认视口内可操作（无需页面滚动）与公牌清晰可见。
- 当前未支持：独立人机模式、LLM 实时出牌决策（已支持配置预留，未启用调用）。
- 规划路线：先做“可控策略引擎的人机补位”，再做“LLM 局后复盘教练”。
- 详细方案：
  - `docs/ai-bot-prd.md`
  - `docs/ai-bot-task-breakdown.md`

### 配置系统
游戏规则可通过 `server/config/game-config.json` 配置：
- 各轮积分
- 公牌顺序（随机/固定）
- 游戏参数

### 牌型说明
1. **豹子**: 三张相同牌面
2. **同花顺**: 同花色的连续三张牌
3. **同花**: 同花色的三张牌
4. **顺子**: 连续的三张牌
5. **对子**: 两张相同牌面
6. **单张**: 普通牌型

## 开发说明

### 开发模式
```bash
# 前端开发服务器
npm run dev:client

# 后端开发服务器
npm run dev:server
```

### 测试
```bash
# 服务端单元/集成测试
cd server
npm test

# 战绩索引巡检（Mongo）
npm run audit:battle-indexes

# 前端端到端（Playwright）
cd ..
npm run test:e2e

# 运行单个用例文件
npx playwright test e2e/full-game.spec.js
npx playwright test e2e/reconnect-lifecycle.spec.js
```

### 构建部署
```bash
# 构建前端
npm run build:client

# 启动生产服务器
npm run start:server
```

### Docker Compose（本地容器化）
```bash
docker compose up --build
```

启动后访问：
- 前端：`http://localhost:8080`
- 后端 WS：`ws://localhost:3014`
- Redis：`localhost:6379`
- MongoDB：`localhost:27017`

停止并清理容器：
```bash
docker compose down
```

### 账号体系说明
- 邮箱账号数据已存储在 MongoDB 的 `accounts` 集合。
- 若设置 `DAIERYOU_SKIP_MONGO=1`，游客模式仍可用，但邮箱注册/密码登录会提示不可用。
- 会员中心入口位于大厅，可执行会员开通/续费与邀请码生成。
- 管理员账号通过 `DAIERYOU_AUTH_ADMIN_EMAILS`（逗号分隔邮箱）配置，登录后可见“管理台（最小版）”。
- 当前会员能力为 MVP，尚未接入真实支付订单与回调。
- 战绩治理与索引巡检流程见 `docs/battle-record-governance.md`。

## 许可证
MIT License
