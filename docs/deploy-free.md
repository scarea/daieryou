# 零成本部署：Vercel + Render + Supabase

| 部分 | 平台 | 说明 |
|---|---|---|
| 前端（3D 页面） | Vercel Hobby | 免费，仅限个人非商业用途 |
| 游戏服务端（WebSocket） | Render 免费 Web Service | 15 分钟无流量会休眠，唤醒约 1 分钟；每月 750 小时 |
| 数据库 | Supabase 免费 Postgres | 500 MB；7 天无访问会被暂停 |

服务端配置了 `DAIERYOU_DATABASE_URL` 时自动使用 Postgres，启动时自动建表（`server/src/infrastructure/postgres/schema.sql`，副本见 `supabase/schema.sql`），所有表开启 RLS 且不开放任何策略，Supabase 的公开 REST 接口无法读写。

## 1. Supabase

1. 新建项目，区域建议 **Southeast Asia (Singapore)**，与 Render 服务端同区域。
2. 项目页面顶部点 **Connect**，选择 **Session pooler**（Render 免费实例只支持 IPv4，不要用 Direct connection），复制连接串，形如：
   `postgresql://postgres.<项目ID>:<数据库密码>@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres`
3. 无需手动建表，服务端首次启动会自动执行。

## 2. Render（游戏服务端）

1. 用 GitHub 账号注册 Render，授权访问本仓库。
2. **New → Blueprint**，选择本仓库，Render 会读取根目录的 `render.yaml` 创建 `daieryou-server`。
   - `DAIERYOU_SESSION_TOKEN_SECRET` 由 Render 自动生成。
   - `DAIERYOU_DATABASE_URL` 需要手动填入上一步的 Supabase 连接串。
3. 部署完成后访问 `https://<服务名>.onrender.com/healthz`，看到 `{"ok":true,...,"database":"postgres"}` 即成功。

## 3. Vercel（前端）

1. **Add New → Project**，导入本仓库。
2. **Root Directory** 选 `client`（框架会识别为 Vite，配置见 `client/vercel.json`）。
3. 环境变量添加 `VITE_WS_URL` = `wss://<服务名>.onrender.com`。
4. 部署。之后每次推送 `main` 会自动重新部署。

## 4. 保活（让服务端不休眠）

Render 免费服务 15 分钟内没有请求或 WebSocket 消息就会休眠。一个服务全天运行一个月约 744 小时，在 750 小时额度内。

- **推荐**：在 [cron-job.org](https://cron-job.org) 或 [UptimeRobot](https://uptimerobot.com) 新建监控，每 10 分钟访问一次 `https://<服务名>.onrender.com/healthz`。
- **备份**：在 Supabase SQL Editor 执行 `supabase/keepalive.sql`（先替换其中的地址），用 `pg_cron` + `pg_net` 定时访问。
- 服务端每 6 小时会写一次数据库心跳（`service_heartbeats` 表），只要服务端醒着，Supabase 就不会因不活跃被暂停。

注意：
- 750 小时是整个 Render 账号共用的，账号里不要再放其他需要常驻的免费服务。
- 服务端重新部署或平台维护重启时，进行中的牌局会丢失（房间状态在内存中）。
- 前端启动时会先访问 `/healthz` 唤醒服务端，并显示“正在唤醒牌桌服务器”的进度提示。
