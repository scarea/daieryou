# 零成本部署：Vercel + Cloudflare Workers + Supabase（无需信用卡）

| 部分 | 平台 | 说明 |
|---|---|---|
| 前端（3D 页面） | Vercel Hobby | 免费，仅限个人非商业用途 |
| 游戏服务端（WebSocket） | Cloudflare Workers + Durable Objects（免费版） | 不需要信用卡；不休眠、无冷启动 |
| 数据库 | Supabase 免费 Postgres | 500 MB；7 天无访问会被暂停 |

## 架构

- 所有 WebSocket 连接由 Worker 转交给同一个 Durable Object（`GameServer`），它与 Node 版服务端共用同一套服务与消息网关（`server/src/gateway/gateway.js`），房间状态在内存中。
- 配置了 `DAIERYOU_DATABASE_URL` 时使用 Postgres，启动时自动建表（表结构见 `supabase/schema.sql`）。所有表开启 RLS 且不开放策略；Supabase 项目创建时也关闭了 Data API。
- 访问 `/healthz` 会唤醒 Durable Object 并写一次数据库心跳，可用于外部保活。

### 免费版限制与对策

- **每次请求 CPU 上限 10ms**：AI 模拟次数限制为 80（`DAIERYOU_BOT_MAX_SIMULATIONS`），AI 会比 Node 版稍弱；密码哈希迭代次数降为 20000（`DAIERYOU_PASSWORD_HASH_ITERATIONS`，迭代次数随哈希一起存储，以后可调整而不影响已有账号）。
- **每天 13,000 GB·秒时长额度**：一个常驻对象全天约 10,800 GB·秒，在额度内。
- **无人连接时对象可能被回收**：此时内存中的房间会清空（与断线超时清理的效果一致）。

## 部署步骤

### 1. Supabase
1. 新建项目（区域 Southeast Asia (Singapore)），可关闭 Data API。
2. 项目页顶部 **Connect → Session pooler**，复制连接串（形如 `postgresql://postgres.<项目ID>:<数据库密码>@<pooler 主机>:5432/postgres`）。
   忘记密码可在 **Project Settings → Database → Reset database password** 重置。

### 2. Cloudflare（游戏服务端）
```bash
cd server
npx wrangler login                     # 浏览器中授权
npx wrangler deploy                    # 部署，得到 https://daieryou.<子域名>.workers.dev
openssl rand -hex 32 | npx wrangler secret put DAIERYOU_SESSION_TOKEN_SECRET
npx wrangler secret put DAIERYOU_DATABASE_URL   # 粘贴 Supabase 连接串
```
访问 `https://daieryou.<子域名>.workers.dev/healthz`，看到 `"database":"postgres"` 即成功。

本地调试：在 `server/.dev.vars` 写入密钥后运行 `npx wrangler dev`（`.dev.vars` 已被 git 忽略）。
用 `E2E_EXTERNAL_WS_URL=ws://127.0.0.1:8787 npx playwright test e2e/full-game.spec.js` 可在 Cloudflare 运行时上跑完整对局测试。

### 3. Vercel（前端）
1. **Add New → Project**，导入本仓库，**Root Directory** 选 `client`。
2. 环境变量 `VITE_WS_URL` = `wss://daieryou.<子域名>.workers.dev`。
3. 部署。之后推送 `main` 会自动重新部署前端；服务端更新需在 `server/` 下重新执行 `npx wrangler deploy`。

### 4. 保活（可选）
Durable Object 不会像 Render 那样休眠，无需保活。若担心 Supabase 7 天无访问被暂停（长时间没人玩时），可在 Supabase SQL Editor 执行 `supabase/keepalive.sql`（把地址换成 `https://daieryou.<子域名>.workers.dev/healthz`），每 10 分钟访问一次，顺带写数据库心跳。

## 其他部署方式

- **自托管 / Docker**：`docker compose up -d`（需要在 `.env` 设置 `DAIERYOU_SESSION_TOKEN_SECRET`）。
- **Render**：仓库根目录的 `render.yaml` 可直接作为 Blueprint 使用，但 Render 需要绑定信用卡验证身份。
