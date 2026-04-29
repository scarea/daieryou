import React, { useEffect, useMemo, useState } from 'react'
import {
  Button,
  Card,
  Divider,
  Input,
  Space,
  Tabs,
  Typography,
  message,
} from 'antd'
import {
  LockOutlined,
  MailOutlined,
  SafetyCertificateOutlined,
  UserOutlined,
  QuestionCircleOutlined,
} from '@ant-design/icons'
import useGameStore from '../store/gameStore'
import GameRules from '../components/GameRules'

const { Title, Text } = Typography

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const LoginScene = ({ onLoginSuccess }) => {
  const [guestUsername, setGuestUsername] = useState('')
  const [loginEmail, setLoginEmail] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [registerEmail, setRegisterEmail] = useState('')
  const [registerUsername, setRegisterUsername] = useState('')
  const [registerPassword, setRegisterPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [verificationCode, setVerificationCode] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [sendingCode, setSendingCode] = useState(false)
  const [codeCountdown, setCodeCountdown] = useState(0)
  const [showRules, setShowRules] = useState(false)

  const {
    login,
    loginWithPassword,
    registerWithEmail,
    sendEmailCode,
    restoreUser,
    authConfig,
  } = useGameStore()

  const emailEnabled = authConfig?.emailEnabled !== false
  const inviteRequired = authConfig?.inviteRequired === true
  const inviteCodeLength = Number(authConfig?.inviteCodeLength) > 0 ? Number(authConfig.inviteCodeLength) : 8

  useEffect(() => {
    const savedUser = restoreUser()
    if (savedUser) {
      setGuestUsername(savedUser.username)
    }
  }, [restoreUser])

  useEffect(() => {
    if (codeCountdown <= 0) {
      return undefined
    }

    const timer = window.setInterval(() => {
      setCodeCountdown((prev) => (prev > 0 ? prev - 1 : 0))
    }, 1000)

    return () => {
      window.clearInterval(timer)
    }
  }, [codeCountdown])

  const canSendCode = useMemo(() => (
    codeCountdown <= 0 && registerEmail.trim().length > 0
  ), [codeCountdown, registerEmail])

  const validateEmail = (email) => EMAIL_PATTERN.test(email.trim().toLowerCase())

  const completeAuthFlow = () => {
    onLoginSuccess && onLoginSuccess()
  }

  const handleGuestLogin = async () => {
    if (!guestUsername.trim()) {
      message.error('请输入用户名')
      return
    }

    setLoading(true)
    try {
      await login(guestUsername)
      message.success('登录成功')
      completeAuthFlow()
    } catch (error) {
      message.error(error.message || '登录失败')
    } finally {
      setLoading(false)
    }
  }

  const handlePasswordLogin = async () => {
    if (!emailEnabled) {
      message.error('邮箱登录未开启')
      return
    }
    if (!validateEmail(loginEmail)) {
      message.error('请输入有效邮箱')
      return
    }

    if (!loginPassword) {
      message.error('请输入密码')
      return
    }

    setLoading(true)
    try {
      await loginWithPassword({
        email: loginEmail.trim().toLowerCase(),
        password: loginPassword,
      })
      message.success('登录成功')
      completeAuthFlow()
    } catch (error) {
      message.error(error.message || '登录失败')
    } finally {
      setLoading(false)
    }
  }

  const handleSendEmailCode = async () => {
    if (!emailEnabled) {
      message.error('邮箱登录未开启')
      return
    }
    if (!validateEmail(registerEmail)) {
      message.error('请输入有效邮箱')
      return
    }

    setSendingCode(true)
    try {
      const result = await sendEmailCode(registerEmail.trim().toLowerCase())
      const countdown = Number(result?.nextAllowedInSeconds) || 60
      setCodeCountdown(Math.max(1, countdown))

      if (result?.debugCode) {
        message.success(`验证码已发送（开发模式验证码：${result.debugCode}）`)
      } else {
        message.success('验证码已发送，请检查邮箱')
      }
    } catch (error) {
      message.error(error.message || '验证码发送失败')
    } finally {
      setSendingCode(false)
    }
  }

  const handleRegister = async () => {
    if (!emailEnabled) {
      message.error('邮箱注册未开启')
      return
    }
    if (!validateEmail(registerEmail)) {
      message.error('请输入有效邮箱')
      return
    }
    if (!verificationCode.trim()) {
      message.error('请输入验证码')
      return
    }
    if (!registerPassword) {
      message.error('请输入密码')
      return
    }
    if (registerPassword !== confirmPassword) {
      message.error('两次密码输入不一致')
      return
    }
    if (inviteRequired && !inviteCode.trim()) {
      message.error('请输入邀请码')
      return
    }

    setLoading(true)
    try {
      await registerWithEmail({
        email: registerEmail.trim().toLowerCase(),
        password: registerPassword,
        verificationCode: verificationCode.trim(),
        username: registerUsername.trim() || undefined,
        inviteCode: inviteCode.trim() || undefined,
      })
      message.success('注册并登录成功')
      completeAuthFlow()
    } catch (error) {
      message.error(error.message || '注册失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <Card className="scene-card login-scene-card" style={{ width: 'min(100%, 520px)' }}>
        <header className="login-scene-header">
          <Title level={2} className="scene-hero-title login-scene-title">
            逮二游
          </Title>
          <p className="scene-hero-subtitle">专业账号体系：邮箱注册 + 验证码 + 密码登录</p>
          <Button
            type="link"
            icon={<QuestionCircleOutlined />}
            onClick={() => setShowRules(true)}
            style={{ padding: 0, height: 'auto' }}
          >
            游戏规则
          </Button>
        </header>

      <Tabs
        defaultActiveKey="guest"
        items={[
          ...(emailEnabled ? [
            {
              key: 'account-login',
              label: '账号登录',
              children: (
                <Space direction="vertical" size={12} style={{ width: '100%' }}>
                  <Input
                    size="large"
                    className="scene-input"
                    placeholder="邮箱地址"
                    prefix={<MailOutlined />}
                    value={loginEmail}
                    onChange={(event) => setLoginEmail(event.target.value)}
                  />
                  <Input.Password
                    size="large"
                    className="scene-input"
                    placeholder="密码"
                    prefix={<LockOutlined />}
                    value={loginPassword}
                    onChange={(event) => setLoginPassword(event.target.value)}
                    onPressEnter={handlePasswordLogin}
                  />
                  <Button
                    type="primary"
                    size="large"
                    block
                    loading={loading}
                    className="scene-primary-btn scene-action-btn"
                    onClick={handlePasswordLogin}
                  >
                    邮箱密码登录
                  </Button>
                </Space>
              ),
            },
            {
              key: 'register',
              label: '注册账号',
              children: (
                <Space direction="vertical" size={12} style={{ width: '100%' }}>
                  <Input
                    size="large"
                    className="scene-input"
                    placeholder="邮箱地址"
                    prefix={<MailOutlined />}
                    value={registerEmail}
                    onChange={(event) => setRegisterEmail(event.target.value)}
                  />
                  <Input
                    size="large"
                    className="scene-input"
                    placeholder="昵称（可选）"
                    prefix={<UserOutlined />}
                    value={registerUsername}
                    maxLength={24}
                    onChange={(event) => setRegisterUsername(event.target.value)}
                  />
                  {inviteRequired && (
                    <Input
                      size="large"
                      className="scene-input"
                      placeholder={`邀请码（${inviteCodeLength}位）`}
                      value={inviteCode}
                      maxLength={inviteCodeLength}
                      onChange={(event) => setInviteCode(event.target.value.toUpperCase())}
                    />
                  )}
                  <Space.Compact style={{ width: '100%' }}>
                    <Input
                      size="large"
                      className="scene-input"
                      placeholder="6位验证码"
                      prefix={<SafetyCertificateOutlined />}
                      value={verificationCode}
                      onChange={(event) => setVerificationCode(event.target.value)}
                    />
                    <Button
                      size="large"
                      disabled={!canSendCode}
                      loading={sendingCode}
                      onClick={handleSendEmailCode}
                    >
                      {codeCountdown > 0 ? `${codeCountdown}s` : '发送验证码'}
                    </Button>
                  </Space.Compact>
                  <Input.Password
                    size="large"
                    className="scene-input"
                    placeholder="设置密码（8-72位，需含字母+数字）"
                    prefix={<LockOutlined />}
                    value={registerPassword}
                    onChange={(event) => setRegisterPassword(event.target.value)}
                  />
                  <Input.Password
                    size="large"
                    className="scene-input"
                    placeholder="确认密码"
                    prefix={<LockOutlined />}
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    onPressEnter={handleRegister}
                  />
                  <Button
                    type="primary"
                    size="large"
                    block
                    loading={loading}
                    className="scene-accent-btn scene-action-btn"
                    onClick={handleRegister}
                  >
                    注册并登录
                  </Button>
                </Space>
              ),
            },
          ] : []),
          {
            key: 'guest',
            label: '游客快速开始',
            children: (
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                <Input
                  size="large"
                  className="scene-input"
                  placeholder="请输入用户名"
                  data-testid="login-username-input"
                  prefix={<UserOutlined />}
                  value={guestUsername}
                  onChange={(event) => setGuestUsername(event.target.value)}
                  onPressEnter={handleGuestLogin}
                />
                <Button
                  type="primary"
                  size="large"
                  block
                  loading={loading}
                  className="scene-primary-btn scene-action-btn"
                  data-testid="login-submit-button"
                  onClick={handleGuestLogin}
                >
                  进入游戏
                </Button>
              </Space>
            ),
          },
        ]}
      />

      <Divider style={{ margin: '16px 0 8px' }} />
      <Text className="scene-form-helper">
        {emailEnabled
          ? '邮箱验证码默认通过邮件服务发送；未配置邮件服务时会在服务端日志输出开发验证码。'
          : '当前环境未开启邮箱登录，仅支持游客快速开始。'}
      </Text>
    </Card>

    <GameRules visible={showRules} onClose={() => setShowRules(false)} />
  </>
  )
}

export default LoginScene
