const DEFAULT_RESEND_API_ENDPOINT = 'https://api.resend.com/emails'

class EmailSender {
  constructor({
    transport = 'console',
    webhookUrl = '',
    fromAddress = '',
    resendApiKey = '',
    logger = console,
  } = {}) {
    this.transport = transport
    this.webhookUrl = typeof webhookUrl === 'string' ? webhookUrl.trim() : ''
    this.fromAddress = typeof fromAddress === 'string' ? fromAddress.trim() : ''
    this.resendApiKey = typeof resendApiKey === 'string' ? resendApiKey.trim() : ''
    this.logger = logger
  }

  buildContent({ email, code, purpose, ttlMinutes }) {
    const normalizedPurpose = purpose === 'login' ? '登录验证' : '账号注册'
    const subject = `逮二游${normalizedPurpose}验证码`
    const text = `你的验证码是 ${code}，${ttlMinutes} 分钟内有效。若非本人操作请忽略本邮件。`
    const html = `
      <div style="font-family: Arial, sans-serif; line-height: 1.5;">
        <h2>逮二游 ${normalizedPurpose}</h2>
        <p>你的验证码：</p>
        <p style="font-size: 24px; font-weight: bold; letter-spacing: 3px;">${code}</p>
        <p>${ttlMinutes} 分钟内有效。若非本人操作请忽略本邮件。</p>
        <p style="color: #6b7280;">接收邮箱：${email}</p>
      </div>
    `.trim()

    return {
      subject,
      text,
      html,
    }
  }

  async sendViaResend({ email, subject, text, html }) {
    if (!this.resendApiKey || !this.fromAddress) {
      throw new Error('Resend 配置不完整，请检查 DAIERYOU_RESEND_API_KEY / DAIERYOU_EMAIL_FROM')
    }

    const response = await fetch(DEFAULT_RESEND_API_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: this.fromAddress,
        to: [email],
        subject,
        text,
        html,
      }),
    })

    if (!response.ok) {
      const raw = await response.text()
      throw new Error(`Resend 发送失败: ${response.status} ${raw}`)
    }

    return { delivered: true, delivery: 'resend' }
  }

  async sendViaWebhook({ email, subject, text, html, code, purpose, ttlMinutes }) {
    if (!this.webhookUrl) {
      throw new Error('Webhook 配置为空，请检查 DAIERYOU_EMAIL_WEBHOOK_URL')
    }

    const response = await fetch(this.webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: email,
        subject,
        text,
        html,
        code,
        purpose,
        ttlMinutes,
      }),
    })

    if (!response.ok) {
      const raw = await response.text()
      throw new Error(`Webhook 发送失败: ${response.status} ${raw}`)
    }

    return { delivered: true, delivery: 'webhook' }
  }

  async sendVerificationCode({ email, code, purpose, ttlMinutes }) {
    const { subject, text, html } = this.buildContent({
      email,
      code,
      purpose,
      ttlMinutes,
    })

    if (this.transport === 'resend') {
      return this.sendViaResend({ email, subject, text, html })
    }

    if (this.transport === 'webhook') {
      return this.sendViaWebhook({
        email,
        subject,
        text,
        html,
        code,
        purpose,
        ttlMinutes,
      })
    }

    this.logger.log(`[email-dev] to=${email} purpose=${purpose} code=${code} ttl=${ttlMinutes}m`)
    return { delivered: true, delivery: 'console' }
  }
}

module.exports = { EmailSender }
