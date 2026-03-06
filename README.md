# 逮二游 - 三人炸金花棋牌游戏

一个基于Web的多人在线棋牌游戏，支持3人同时游戏的炸金花变种玩法。

## 游戏规则

### 基本规则
- 3名玩家一个房间
- 使用54张牌（A-K + 大小王）
- 每轮比大小，第二名为输家
- 共进行5轮游戏

### 游戏流程
1. **第1轮**: 每人发5张起始牌，配合第1张公牌选择2张组成炸金花牌型
2. **第2-3轮**: 输家先摸牌，每人补充2张牌，继续选牌比大小
3. **第4轮**: 暗牌回合，看不到公牌内容但仍需选牌
4. **第5轮**: 最终回合，统计总积分

### 积分规则
- 各轮积分: 1、2、3、4、5分（可配置）
- 输家向赢家转移积分
- 最终统计总积分排名

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
- `DAIERYOU_VERBOSE_LOG`: 是否输出每条消息日志（`1` 启用）
- `DAIERYOU_ROOM_SWEEP_INTERVAL_MS`: 房间回收扫描间隔
- `DAIERYOU_FINISHED_ROOM_TTL_MS`: 结算房间回收阈值
- `DAIERYOU_OFFLINE_WAITING_ROOM_TTL_MS`: 全离线等待房间回收阈值

## 游戏特性

### 已实现功能
- ✅ 用户登录系统
- ✅ 邮箱账号体系（验证码注册 + 密码登录）
- ✅ 会员体系 MVP（自助开通/续费）
- ✅ 邀请码体系（会员生成 + 注册消费）
- ✅ 管理台 MVP（会员发放 + 邀请码列表/禁用）
- ✅ 房间创建/加入
- ✅ 实时多人游戏
- ✅ 完整的炸金花牌型判断
- ✅ 5轮游戏流程
- ✅ 积分计算系统
- ✅ 暗牌机制
- ✅ 游戏历史记录

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

## 许可证
MIT License
