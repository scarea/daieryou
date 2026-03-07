# Bug 修复：游戏结束后离开房间无效

## 问题描述

用户报告：游戏结束后，点击"离开房间"按钮没有效果，无法返回大厅。

## 问题分析

### 根本原因

在 `client/src/store/gameStore.js` 的 `exitCurrentRoom` 函数中：

```javascript
exitCurrentRoom: async () => {
  const { currentRoom } = get()
  if (currentRoom) {
    await get().leaveRoom()  // 如果这里抛出异常，后续代码不会执行
    return
  }
  // ... 清理状态
}
```

**问题：**
1. `leaveRoom()` 是异步操作，可能因为网络问题或服务端错误而失败
2. 如果失败抛出异常，没有 try-catch 捕获
3. 异常导致函数中断，不会执行状态清理
4. 用户界面卡在游戏结束页面，无法返回大厅

### 可能的失败场景

1. **网络超时**：服务器响应慢或网络不稳定
2. **服务端错误**：房间已被删除或状态异常
3. **WebSocket 断开**：连接中断导致请求失败

## 解决方案

### 修改内容

在 `exitCurrentRoom` 函数中添加错误处理，确保即使离开房间失败，也能清理本地状态：

```javascript
exitCurrentRoom: async () => {
  const { currentRoom } = get()
  if (currentRoom) {
    try {
      await get().leaveRoom()
    } catch (error) {
      console.error('离开房间失败:', error)
      // 即使离开房间失败，也清理本地状态
      set({
        currentRoom: null,
        gameState: null,
        finalScores: null,
        finalRoundResult: null,
        latestRoundResult: null,
        gameAlert: null,
      })
    }
    return
  }

  set({
    currentRoom: null,
    gameState: null,
    finalScores: null,
    finalRoundResult: null,
    latestRoundResult: null,
    gameAlert: null,
  })
},
```

### 修改原理

1. **添加 try-catch**：捕获 `leaveRoom()` 可能抛出的异常
2. **记录错误**：使用 `console.error` 记录错误信息，便于调试
3. **强制清理状态**：即使服务端操作失败，也清理本地状态
4. **用户体验优先**：确保用户始终能返回大厅，不会卡在某个页面

## 测试建议

### 正常场景
1. 游戏结束后点击"离开房间"
2. 应该正常返回大厅
3. 房间列表应该更新

### 异常场景
1. **模拟网络断开**：
   - 游戏结束后断开网络
   - 点击"离开房间"
   - 应该仍能返回大厅（本地状态清理）

2. **模拟服务端错误**：
   - 修改服务端代码，让 `leaveRoom` 抛出异常
   - 点击"离开房间"
   - 应该看到控制台错误日志
   - 应该仍能返回大厅

3. **快速点击**：
   - 游戏结束后快速多次点击"离开房间"
   - 不应该出现重复请求或状态错误

## 相关代码位置

- **修改文件**: `client/src/store/gameStore.js` (L850-865)
- **相关组件**: `client/src/components/GameResult.jsx` (L174)
- **相关场景**: `client/src/scenes/GameScene.jsx` (L504)

## 后续优化建议

### 1. 添加用户提示
```javascript
catch (error) {
  console.error('离开房间失败:', error)
  message.warning('离开房间失败，已返回大厅')
  // 清理状态...
}
```

### 2. 添加加载状态
在 GameResult 组件中添加 loading 状态，防止用户重复点击：

```javascript
const [leaving, setLeaving] = useState(false)

const handleLeave = async () => {
  setLeaving(true)
  try {
    await onBackToRoom()
  } finally {
    setLeaving(false)
  }
}

<Button loading={leaving} onClick={handleLeave}>
  离开房间
</Button>
```

### 3. 添加确认对话框
对于游戏进行中的离开操作，可以添加确认对话框：

```javascript
const handleLeave = () => {
  if (gameState && gameState.currentRound < gameState.maxRounds) {
    Modal.confirm({
      title: '确认离开？',
      content: '游戏正在进行中，离开将导致游戏结束',
      onOk: () => exitCurrentRoom(),
    })
  } else {
    exitCurrentRoom()
  }
}
```

## 影响范围

- **用户体验**: ✅ 显著改善，不会再卡在游戏结束页面
- **功能完整性**: ✅ 保持不变，只是增加了容错性
- **性能**: ✅ 无影响
- **兼容性**: ✅ 向后兼容，不影响现有功能

## 部署状态

- ✅ 代码已修改
- ✅ 构建测试通过
- 🟢 可安全部署

---

**修复时间**: 2026-03-07
**修复人员**: AI Assistant
**测试状态**: 待用户验证
