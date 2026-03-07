// 音效管理系统
class AudioManager {
  constructor() {
    this.context = null
    this.masterVolume = 0.5
    this.enabled = true
    this.initialized = false
  }

  init() {
    if (this.initialized || typeof window === 'undefined') {
      return
    }

    const AudioContextClass = window.AudioContext || window.webkitAudioContext
    if (!AudioContextClass) {
      return
    }

    this.context = new AudioContextClass()
    this.initialized = true
  }

  resume() {
    if (this.context && this.context.state === 'suspended') {
      this.context.resume().catch(() => {})
    }
  }

  setVolume(volume) {
    this.masterVolume = Math.max(0, Math.min(1, volume))
  }

  setEnabled(enabled) {
    this.enabled = enabled
  }

  // 选牌音效（原有）
  playCardSelect() {
    if (!this.enabled || !this.context) {
      return
    }

    this.resume()

    const now = this.context.currentTime
    const oscillator = this.context.createOscillator()
    const gainNode = this.context.createGain()

    oscillator.type = 'triangle'
    oscillator.frequency.setValueAtTime(820, now)
    oscillator.frequency.exponentialRampToValueAtTime(580, now + 0.05)

    gainNode.gain.setValueAtTime(0.0001, now)
    gainNode.gain.exponentialRampToValueAtTime(0.075 * this.masterVolume, now + 0.01)
    gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.09)

    oscillator.connect(gainNode)
    gainNode.connect(this.context.destination)
    oscillator.start(now)
    oscillator.stop(now + 0.1)
  }

  // 出牌成功音效
  playCardPlay() {
    if (!this.enabled || !this.context) {
      return
    }

    this.resume()

    const now = this.context.currentTime
    const oscillator = this.context.createOscillator()
    const gainNode = this.context.createGain()

    oscillator.type = 'sine'
    oscillator.frequency.setValueAtTime(600, now)
    oscillator.frequency.exponentialRampToValueAtTime(800, now + 0.1)

    gainNode.gain.setValueAtTime(0.0001, now)
    gainNode.gain.exponentialRampToValueAtTime(0.1 * this.masterVolume, now + 0.02)
    gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.15)

    oscillator.connect(gainNode)
    gainNode.connect(this.context.destination)
    oscillator.start(now)
    oscillator.stop(now + 0.15)
  }

  // 回合结束音效
  playRoundEnd() {
    if (!this.enabled || !this.context) {
      return
    }

    this.resume()

    const now = this.context.currentTime
    const oscillator = this.context.createOscillator()
    const gainNode = this.context.createGain()

    oscillator.type = 'square'
    oscillator.frequency.setValueAtTime(440, now)
    oscillator.frequency.setValueAtTime(554, now + 0.1)
    oscillator.frequency.setValueAtTime(659, now + 0.2)

    gainNode.gain.setValueAtTime(0.0001, now)
    gainNode.gain.exponentialRampToValueAtTime(0.08 * this.masterVolume, now + 0.01)
    gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.3)

    oscillator.connect(gainNode)
    gainNode.connect(this.context.destination)
    oscillator.start(now)
    oscillator.stop(now + 0.3)
  }

  // 胜利音效
  playWin() {
    if (!this.enabled || !this.context) {
      return
    }

    this.resume()

    const now = this.context.currentTime
    const notes = [523, 659, 784, 1047] // C5, E5, G5, C6

    notes.forEach((freq, index) => {
      const oscillator = this.context.createOscillator()
      const gainNode = this.context.createGain()

      oscillator.type = 'sine'
      oscillator.frequency.setValueAtTime(freq, now + index * 0.1)

      gainNode.gain.setValueAtTime(0.0001, now + index * 0.1)
      gainNode.gain.exponentialRampToValueAtTime(0.12 * this.masterVolume, now + index * 0.1 + 0.02)
      gainNode.gain.exponentialRampToValueAtTime(0.0001, now + index * 0.1 + 0.15)

      oscillator.connect(gainNode)
      gainNode.connect(this.context.destination)
      oscillator.start(now + index * 0.1)
      oscillator.stop(now + index * 0.1 + 0.15)
    })
  }

  // 失败音效
  playLose() {
    if (!this.enabled || !this.context) {
      return
    }

    this.resume()

    const now = this.context.currentTime
    const oscillator = this.context.createOscillator()
    const gainNode = this.context.createGain()

    oscillator.type = 'sawtooth'
    oscillator.frequency.setValueAtTime(400, now)
    oscillator.frequency.exponentialRampToValueAtTime(200, now + 0.3)

    gainNode.gain.setValueAtTime(0.0001, now)
    gainNode.gain.exponentialRampToValueAtTime(0.1 * this.masterVolume, now + 0.02)
    gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.35)

    oscillator.connect(gainNode)
    gainNode.connect(this.context.destination)
    oscillator.start(now)
    oscillator.stop(now + 0.35)
  }

  // 倒计时警告音效
  playCountdownWarning() {
    if (!this.enabled || !this.context) {
      return
    }

    this.resume()

    const now = this.context.currentTime
    const oscillator = this.context.createOscillator()
    const gainNode = this.context.createGain()

    oscillator.type = 'square'
    oscillator.frequency.setValueAtTime(880, now)

    gainNode.gain.setValueAtTime(0.0001, now)
    gainNode.gain.exponentialRampToValueAtTime(0.15 * this.masterVolume, now + 0.01)
    gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.08)

    oscillator.connect(gainNode)
    gainNode.connect(this.context.destination)
    oscillator.start(now)
    oscillator.stop(now + 0.08)
  }
}

// 单例模式
const audioManager = new AudioManager()

// 自动初始化（在用户首次交互时）
if (typeof window !== 'undefined') {
  const initOnInteraction = () => {
    audioManager.init()
    window.removeEventListener('click', initOnInteraction)
    window.removeEventListener('touchstart', initOnInteraction)
  }
  window.addEventListener('click', initOnInteraction, { once: true })
  window.addEventListener('touchstart', initOnInteraction, { once: true })
}

export default audioManager

