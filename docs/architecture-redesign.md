# Daieryou 架构重构说明

## 现状问题

当前项目更像“能跑的原型”，主要风险不在单个 bug，而在架构边界：

1. 前端把通信协议、会话恢复、UI 场景、业务状态全部塞进一个 Zustand store。
2. 前端依赖 `window.pomelo`，但后端实际是自定义 WebSocket 协议，两边概念不一致。
3. `App.jsx` 用局部 `currentScene` 控制流程，和全局房间/游戏状态并行，容易状态漂移。
4. 游戏事件订阅散落在组件内部，回合结果、结算、房间同步没有统一入口。
5. 后端仍是 handler + 全局变量风格，后续加匹配、断线重连、观战会很难扩展。

## 本次调整

本次先落“客户端重写骨架”，目标是先把最脆弱的边界稳定下来：

- `config/`：环境与部署配置。
- `services/realtimeClient.js`：统一维护 WebSocket 连接、请求响应、服务端推送事件。
- `services/gameService.js`：封装业务 API，组件和 store 不再直接拼路由字符串。
- `store/gameStore.js`：只负责应用状态与业务编排，不再直接操作底层 socket。
- `App.jsx`：根据全局状态推导页面流转，去掉额外的局部场景状态。

## 推荐目标架构

### 前端

建议继续演进为 4 层：

1. `app/`：应用启动、Provider、路由/场景编排。
2. `features/`：登录、房间、对局、结算等业务模块。
3. `entities/`：玩家、房间、牌局等可复用领域模型。
4. `shared/`：通信、存储、UI 原子组件、配置、工具函数。

### 后端

建议下一步拆成 5 层：

1. `transport/`：WebSocket 接入与协议编解码。
2. `application/`：`login/createRoom/startGame/selectCards` 用例。
3. `domain/`：房间聚合、牌局聚合、积分规则、发牌/比牌逻辑。
4. `infrastructure/`：MongoDB、Redis、内存房间仓库。
5. `shared/`：协议常量、错误码、配置。

## 重写优先级

### P0
- 把后端 `global.broadcastToRoom` 和 `rooms` 全局状态收口到 `RoomRepository` / `GameGateway`。
- 把游戏规则提纯成纯函数模块，允许单元测试。
- 定义统一协议事件名与 payload 结构。

### P1
- 接入断线重连与会话恢复。
- 房间列表改为事件驱动，不再轮询。
- 增加日志、错误码、观测点。

### P2
- 切 TypeScript。
- 抽 shared package 复用协议与规则。
- 支持 AI/托管、观战、战绩回放。

## 判断：重构还是重写

我的建议是：

- 前端：继续在现有代码上“渐进式重写”，保留 UI 资源和已实现页面。
- 后端：从房间与牌局领域开始做“分层式重构”，不要继续堆 handler。

也就是说，不是一次性推倒重来，而是**先重写交互边界，再重构领域核心**。
