// 错误提示工具函数
import { message } from 'antd'

// 错误类型映射到友好提示
const ERROR_MESSAGES = {
  // 网络错误
  'Network Error': {
    message: '网络连接失败',
    description: '请检查您的网络连接后重试',
  },
  'timeout': {
    message: '请求超时',
    description: '服务器响应时间过长，请稍后重试',
  },

  // 认证错误
  'Invalid credentials': {
    message: '登录失败',
    description: '邮箱或密码错误，请检查后重试',
  },
  'Invalid verification code': {
    message: '验证码错误',
    description: '请检查验证码是否正确，或重新获取验证码',
  },
  'Invalid invite code': {
    message: '邀请码无效',
    description: '请检查邀请码是否正确，或联系管理员获取新的邀请码',
  },

  // 游戏错误
  'Room not found': {
    message: '房间不存在',
    description: '该房间可能已关闭，请刷新房间列表',
  },
  'Room is full': {
    message: '房间已满',
    description: '该房间人数已满，请选择其他房间或创建新房间',
  },
  'Game already started': {
    message: '游戏已开始',
    description: '该房间游戏已开始，无法加入',
  },
  'Not your turn': {
    message: '还未轮到你',
    description: '请等待其他玩家操作完成',
  },
  'Invalid card selection': {
    message: '选牌无效',
    description: '请选择2张手牌进行出牌',
  },

  // 权限错误
  'Permission denied': {
    message: '权限不足',
    description: '您没有权限执行此操作',
  },
  'Not room host': {
    message: '仅房主可操作',
    description: '只有房主可以开始游戏或添加机器人',
  },
}

// 显示友好的错误提示
export function showFriendlyError(error) {
  const errorMessage = error?.message || error?.toString() || '未知错误'

  // 查找匹配的错误类型
  const errorKey = Object.keys(ERROR_MESSAGES).find((key) =>
    errorMessage.includes(key)
  )

  if (errorKey) {
    const { message: msg, description } = ERROR_MESSAGES[errorKey]
    message.error({
      content: (
        <div>
          <div style={{ fontWeight: 'bold' }}>{msg}</div>
          <div style={{ fontSize: '12px', marginTop: '4px', opacity: 0.85 }}>
            {description}
          </div>
        </div>
      ),
      duration: 4,
    })
  } else {
    // 默认错误提示
    message.error({
      content: errorMessage,
      duration: 3,
    })
  }
}

// 显示成功提示
export function showSuccess(msg, description = null) {
  if (description) {
    message.success({
      content: (
        <div>
          <div style={{ fontWeight: 'bold' }}>{msg}</div>
          <div style={{ fontSize: '12px', marginTop: '4px', opacity: 0.85 }}>
            {description}
          </div>
        </div>
      ),
      duration: 3,
    })
  } else {
    message.success(msg)
  }
}

// 显示警告提示
export function showWarning(msg, description = null) {
  if (description) {
    message.warning({
      content: (
        <div>
          <div style={{ fontWeight: 'bold' }}>{msg}</div>
          <div style={{ fontSize: '12px', marginTop: '4px', opacity: 0.85 }}>
            {description}
          </div>
        </div>
      ),
      duration: 3,
    })
  } else {
    message.warning(msg)
  }
}

export default {
  showFriendlyError,
  showSuccess,
  showWarning,
}
