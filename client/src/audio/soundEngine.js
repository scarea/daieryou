// 程序化 ASMR 音效引擎：全部声音由 WebAudio 实时合成，没有音频素材。
// 设计取向：近场、柔和、细节丰富 —— 纸牌在绒布上的摩擦、陶土筹码的清脆碰撞、木质轻敲，
// 统一经过一个短混响的“小房间”，让声音有空间感但不吵。

const SEAT_PAN = { bottom: 0, left: -0.6, right: 0.6, center: 0 }

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function rand(min, max) {
  return min + Math.random() * (max - min)
}

class SoundEngine {
  constructor() {
    this.ctx = null
    this.master = null
    this.sfxBus = null
    this.ambienceBus = null
    this.reverbSend = null
    this.noiseBuffer = null
    this.brownBuffer = null
    this.volumes = { sfx: 0.8, ambience: 0.5 }
    this.muted = false
    this.ambienceNodes = null
    this.ambienceWanted = false
    this.ambienceTimer = null
    this.lastHoverAt = 0
  }

  // 浏览器要求用户交互后才能出声：第一次点击/触摸时初始化
  ensure() {
    if (this.ctx || typeof window === 'undefined') {
      if (this.ctx?.state === 'suspended') {
        this.ctx.resume().catch(() => {})
      }
      return Boolean(this.ctx)
    }
    const AudioContextClass = window.AudioContext || window.webkitAudioContext
    if (!AudioContextClass) {
      return false
    }

    const ctx = new AudioContextClass()
    this.ctx = ctx
    this.master = ctx.createGain()
    this.master.gain.value = this.muted ? 0 : 1
    const compressor = ctx.createDynamicsCompressor()
    compressor.threshold.value = -18
    compressor.knee.value = 12
    compressor.ratio.value = 3
    compressor.attack.value = 0.004
    compressor.release.value = 0.2
    this.master.connect(compressor)
    compressor.connect(ctx.destination)

    this.sfxBus = ctx.createGain()
    this.sfxBus.gain.value = this.volumes.sfx
    this.sfxBus.connect(this.master)
    this.ambienceBus = ctx.createGain()
    this.ambienceBus.gain.value = this.volumes.ambience
    this.ambienceBus.connect(this.master)

    // 小房间混响：衰减噪声生成的脉冲响应，再做低通让尾音温暖
    const reverb = ctx.createConvolver()
    reverb.buffer = this.createImpulse(1.1, 3.2)
    const reverbTone = ctx.createBiquadFilter()
    reverbTone.type = 'lowpass'
    reverbTone.frequency.value = 3800
    this.reverbSend = ctx.createGain()
    this.reverbSend.gain.value = 0.22
    this.reverbSend.connect(reverb)
    reverb.connect(reverbTone)
    reverbTone.connect(this.master)

    this.noiseBuffer = this.createNoise('white', 2)
    this.brownBuffer = this.createNoise('brown', 4)

    if (this.ambienceWanted) {
      this.startAmbience()
    }
    return true
  }

  createImpulse(seconds, decay) {
    const { ctx } = this
    const length = Math.floor(ctx.sampleRate * seconds)
    const impulse = ctx.createBuffer(2, length, ctx.sampleRate)
    for (let channel = 0; channel < 2; channel += 1) {
      const data = impulse.getChannelData(channel)
      for (let index = 0; index < length; index += 1) {
        data[index] = (Math.random() * 2 - 1) * (1 - index / length) ** decay
      }
    }
    return impulse
  }

  createNoise(color, seconds) {
    const { ctx } = this
    const length = Math.floor(ctx.sampleRate * seconds)
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    let last = 0
    for (let index = 0; index < length; index += 1) {
      const white = Math.random() * 2 - 1
      if (color === 'brown') {
        last = (last + 0.02 * white) / 1.02
        data[index] = last * 3.5
      } else {
        data[index] = white
      }
    }
    return buffer
  }

  setVolumes({ sfx, ambience }) {
    if (Number.isFinite(sfx)) {
      this.volumes.sfx = clamp(sfx, 0, 1)
    }
    if (Number.isFinite(ambience)) {
      this.volumes.ambience = clamp(ambience, 0, 1)
    }
    if (this.ctx) {
      const now = this.ctx.currentTime
      this.sfxBus.gain.setTargetAtTime(this.volumes.sfx, now, 0.05)
      this.ambienceBus.gain.setTargetAtTime(this.volumes.ambience, now, 0.2)
    }
  }

  setMuted(muted) {
    this.muted = muted
    if (this.ctx) {
      this.master.gain.setTargetAtTime(muted ? 0 : 1, this.ctx.currentTime, 0.05)
    }
  }

  // ---------- 基础发声单元 ----------

  output(pan = 0, wet = 1) {
    const { ctx } = this
    const panner = ctx.createStereoPanner()
    panner.pan.value = clamp(pan, -1, 1)
    panner.connect(this.sfxBus)
    if (wet > 0) {
      const send = ctx.createGain()
      send.gain.value = wet
      panner.connect(send)
      send.connect(this.reverbSend)
    }
    return panner
  }

  noise({
    at = 0, duration = 0.1, type = 'bandpass', frequency = 2000, frequencyEnd = null, q = 1,
    gain = 0.2, attack = 0.004, pan = 0, wet = 1, buffer = null, rate = 1,
  }) {
    const { ctx } = this
    const start = ctx.currentTime + at
    const source = ctx.createBufferSource()
    source.buffer = buffer || this.noiseBuffer
    source.playbackRate.value = rate
    const filter = ctx.createBiquadFilter()
    filter.type = type
    filter.Q.value = q
    filter.frequency.setValueAtTime(frequency, start)
    if (frequencyEnd) {
      filter.frequency.exponentialRampToValueAtTime(frequencyEnd, start + duration)
    }
    const envelope = ctx.createGain()
    envelope.gain.setValueAtTime(0.0001, start)
    envelope.gain.exponentialRampToValueAtTime(gain, start + attack)
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration)
    source.connect(filter)
    filter.connect(envelope)
    envelope.connect(this.output(pan, wet))
    const offset = Math.random() * Math.max(0, source.buffer.duration - duration - 0.05)
    source.start(start, offset, duration + 0.05)
  }

  tone({
    at = 0, frequency = 440, frequencyEnd = null, type = 'sine', duration = 0.2,
    gain = 0.1, attack = 0.005, pan = 0, wet = 1, detune = 0,
  }) {
    const { ctx } = this
    const start = ctx.currentTime + at
    const oscillator = ctx.createOscillator()
    oscillator.type = type
    oscillator.detune.value = detune
    oscillator.frequency.setValueAtTime(frequency, start)
    if (frequencyEnd) {
      oscillator.frequency.exponentialRampToValueAtTime(frequencyEnd, start + duration)
    }
    const envelope = ctx.createGain()
    envelope.gain.setValueAtTime(0.0001, start)
    envelope.gain.exponentialRampToValueAtTime(gain, start + attack)
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration)
    oscillator.connect(envelope)
    envelope.connect(this.output(pan, wet))
    oscillator.start(start)
    oscillator.stop(start + duration + 0.05)
  }

  play(fn) {
    if (!this.ensure() || this.muted) {
      return
    }
    try {
      fn()
    } catch (error) {
      // 音效失败不应影响游戏
    }
  }

  // ---------- 纸牌 ----------

  // 纸牌擦过绒布：带通噪声由高往低扫
  cardSlide({ at = 0, pan = 0, soft = 1 } = {}) {
    this.play(() => {
      this.noise({ at, duration: rand(0.11, 0.16), frequency: rand(3200, 4200), frequencyEnd: rand(900, 1300), q: 0.8, gain: 0.07 * soft, attack: 0.012, pan, wet: 0.6 })
    })
  }

  // 纸牌落在绒布上：一声极短的纸边“嗒” + 低频闷响
  cardPlace({ at = 0, pan = 0, soft = 1 } = {}) {
    this.play(() => {
      this.noise({ at, duration: 0.03, type: 'highpass', frequency: 2400, gain: 0.05 * soft, attack: 0.001, pan, wet: 0.5 })
      this.tone({ at, frequency: rand(130, 160), frequencyEnd: 70, duration: 0.09, gain: 0.07 * soft, attack: 0.002, pan, wet: 0.3 })
    })
  }

  // 翻牌：两声快速“啪嗒” + 一点风声
  cardFlip({ at = 0, pan = 0 } = {}) {
    this.play(() => {
      this.noise({ at, duration: 0.07, frequency: 2600, frequencyEnd: 5200, q: 0.7, gain: 0.05, attack: 0.008, pan, wet: 0.5 })
      this.noise({ at: at + 0.055, duration: 0.025, type: 'highpass', frequency: 3000, gain: 0.08, attack: 0.001, pan, wet: 0.6 })
      this.tone({ at: at + 0.055, frequency: 210, frequencyEnd: 110, duration: 0.06, gain: 0.05, attack: 0.002, pan, wet: 0.3 })
    })
  }

  cardSelect({ selected = true } = {}) {
    this.play(() => {
      this.noise({ duration: 0.035, type: 'highpass', frequency: selected ? 3600 : 2600, gain: 0.06, attack: 0.001, wet: 0.4 })
      this.tone({ frequency: selected ? 1760 : 1320, duration: 0.07, gain: 0.018, attack: 0.002, wet: 0.6 })
    })
  }

  cardHover() {
    const now = performance.now()
    if (now - this.lastHoverAt < 70) {
      return
    }
    this.lastHoverAt = now
    this.play(() => {
      this.noise({ duration: 0.04, frequency: 5200, q: 2, gain: 0.018, attack: 0.002, wet: 0.3 })
    })
  }

  // 洗牌：越来越密的细碎纸牌声 + 一层摩擦底噪
  shuffle({ at = 0 } = {}) {
    this.play(() => {
      this.noise({ at, duration: 0.75, frequency: 2800, q: 0.5, gain: 0.025, attack: 0.25, wet: 0.5 })
      let time = at
      for (let index = 0; index < 34; index += 1) {
        time += 0.028 - index * 0.0005
        this.noise({ at: time, duration: 0.018, type: 'highpass', frequency: rand(2500, 4500), gain: rand(0.015, 0.035), attack: 0.001, pan: rand(-0.2, 0.2), wet: 0.4 })
      }
      this.cardPlace({ at: time + 0.08, soft: 1.3 })
    })
  }

  deal({ count = 6, at = 0, pans = [0] } = {}) {
    for (let index = 0; index < count; index += 1) {
      const pan = pans[index % pans.length]
      const time = at + index * 0.085
      this.cardSlide({ at: time, pan, soft: 0.8 })
      this.cardPlace({ at: time + 0.12, pan, soft: 0.6 })
    }
  }

  // ---------- 筹码 ----------

  // 陶土筹码碰撞：几组非谐波分音快速衰减
  chipClink({ at = 0, pan = 0, soft = 1 } = {}) {
    this.play(() => {
      const base = rand(2300, 3300)
      ;[1, 2.71, 4.93].forEach((ratio, index) => {
        this.tone({ at, frequency: base * ratio, duration: 0.09 - index * 0.02, gain: (0.035 - index * 0.009) * soft, attack: 0.001, pan, wet: 0.7 })
      })
      this.noise({ at, duration: 0.02, type: 'highpass', frequency: 5000, gain: 0.04 * soft, attack: 0.001, pan, wet: 0.5 })
    })
  }

  chipCascade({ count = 6, at = 0, fromPan = 0, toPan = 0, spacing = 0.07 } = {}) {
    for (let index = 0; index < count; index += 1) {
      const progress = count > 1 ? index / (count - 1) : 1
      const time = at + index * spacing + rand(0, 0.02)
      this.chipClink({ at: time, pan: fromPan + (toPan - fromPan) * progress, soft: 0.8 + Math.random() * 0.4 })
      if (Math.random() < 0.5) {
        this.chipClink({ at: time + rand(0.02, 0.04), pan: toPan, soft: 0.45 })
      }
    }
  }

  // ---------- 演出 ----------

  whoosh({ at = 0, duration = 0.7 } = {}) {
    this.play(() => {
      this.noise({ at, duration, frequency: 280, frequencyEnd: 1400, q: 0.9, gain: 0.05, attack: duration * 0.45, wet: 0.8 })
    })
  }

  // 盖章：低沉一击 + 纸张拍打
  stamp({ at = 0, pan = 0 } = {}) {
    this.play(() => {
      this.tone({ at, frequency: 95, frequencyEnd: 42, duration: 0.32, gain: 0.22, attack: 0.002, pan, wet: 0.5 })
      this.noise({ at, duration: 0.12, type: 'lowpass', frequency: 1400, gain: 0.16, attack: 0.001, pan, wet: 0.7 })
      this.noise({ at: at + 0.01, duration: 0.05, type: 'highpass', frequency: 2500, gain: 0.05, attack: 0.001, pan, wet: 0.4 })
    })
  }

  // 胜利：八音盒式五声音阶琶音
  winChime({ at = 0 } = {}) {
    this.play(() => {
      ;[783.99, 987.77, 1174.66, 1567.98, 1975.53].forEach((frequency, index) => {
        this.tone({ at: at + index * 0.09, frequency, duration: 1.1, gain: 0.045, attack: 0.003, wet: 1.4 })
        this.tone({ at: at + index * 0.09, frequency: frequency * 2.01, duration: 0.4, gain: 0.012, attack: 0.003, wet: 1.2 })
      })
    })
  }

  // 失利：柔和下行的两个闷音，不刺耳
  loseTone({ at = 0 } = {}) {
    this.play(() => {
      this.tone({ at, frequency: 392, frequencyEnd: 370, type: 'triangle', duration: 0.5, gain: 0.05, attack: 0.02, wet: 1 })
      this.tone({ at: at + 0.28, frequency: 311, frequencyEnd: 262, type: 'triangle', duration: 0.9, gain: 0.05, attack: 0.02, wet: 1.2 })
    })
  }

  // 大牌闪光：一串随机高频小铃
  sparkle({ at = 0, pan = 0 } = {}) {
    this.play(() => {
      for (let index = 0; index < 18; index += 1) {
        this.tone({ at: at + index * 0.035 + rand(0, 0.02), frequency: rand(2600, 6200), duration: rand(0.15, 0.4), gain: 0.012, attack: 0.002, pan: pan + rand(-0.3, 0.3), wet: 1.5 })
      }
      this.tone({ at, frequency: 523.25, frequencyEnd: 1046.5, duration: 0.5, gain: 0.03, attack: 0.01, pan, wet: 1.2 })
    })
  }

  heartbeat({ at = 0, intensity = 1 } = {}) {
    this.play(() => {
      this.tone({ at, frequency: 62, frequencyEnd: 40, duration: 0.16, gain: 0.16 * intensity, attack: 0.004, wet: 0.2 })
      this.tone({ at: at + 0.2, frequency: 55, frequencyEnd: 38, duration: 0.18, gain: 0.11 * intensity, attack: 0.004, wet: 0.2 })
    })
  }

  // 木质轻敲，用于倒计时与 UI
  woodTick({ at = 0, pitch = 1 } = {}) {
    this.play(() => {
      this.noise({ at, duration: 0.05, frequency: 1500 * pitch, q: 6, gain: 0.07, attack: 0.001, wet: 0.5 })
      this.tone({ at, frequency: 820 * pitch, duration: 0.05, gain: 0.02, attack: 0.001, wet: 0.4 })
    })
  }

  uiClick() {
    this.woodTick({ pitch: 1.3 })
  }

  // 终局鼓点：刷子军鼓渐强
  drumroll({ at = 0, duration = 1.6 } = {}) {
    this.play(() => {
      const hits = Math.floor(duration / 0.045)
      for (let index = 0; index < hits; index += 1) {
        const progress = index / hits
        this.noise({ at: at + index * 0.045 + rand(0, 0.01), duration: 0.06, frequency: rand(1800, 2600), q: 0.6, gain: 0.012 + progress * 0.05, attack: 0.002, pan: rand(-0.15, 0.15), wet: 0.6 })
      }
      this.tone({ at: at + duration, frequency: 110, frequencyEnd: 55, duration: 0.5, gain: 0.18, attack: 0.002, wet: 0.8 })
      this.noise({ at: at + duration, duration: 0.6, type: 'highpass', frequency: 4000, gain: 0.05, attack: 0.002, wet: 1.4 })
    })
  }

  emotePop({ pan = 0 } = {}) {
    this.play(() => {
      this.tone({ frequency: 520, frequencyEnd: 1180, duration: 0.12, gain: 0.05, attack: 0.004, pan, wet: 0.6 })
      this.tone({ at: 0.06, frequency: 1500, duration: 0.15, gain: 0.02, attack: 0.002, pan, wet: 0.8 })
    })
  }

  // ---------- 环境氛围 ----------

  setAmbience(enabled) {
    this.ambienceWanted = enabled
    if (!this.ctx) {
      return
    }
    if (enabled) {
      this.startAmbience()
    } else {
      this.stopAmbience()
    }
  }

  startAmbience() {
    if (this.ambienceNodes || !this.ctx) {
      return
    }
    const { ctx } = this
    // 房间底噪：低通棕噪声
    const room = ctx.createBufferSource()
    room.buffer = this.brownBuffer
    room.loop = true
    const roomFilter = ctx.createBiquadFilter()
    roomFilter.type = 'lowpass'
    roomFilter.frequency.value = 420
    const roomGain = ctx.createGain()
    roomGain.gain.value = 0.05
    room.connect(roomFilter)
    roomFilter.connect(roomGain)
    roomGain.connect(this.ambienceBus)

    // 远处人声般的起伏：带通噪声 + 缓慢 LFO
    const murmur = ctx.createBufferSource()
    murmur.buffer = this.brownBuffer
    murmur.loop = true
    murmur.playbackRate.value = 1.7
    const murmurFilter = ctx.createBiquadFilter()
    murmurFilter.type = 'bandpass'
    murmurFilter.frequency.value = 520
    murmurFilter.Q.value = 1.4
    const murmurGain = ctx.createGain()
    murmurGain.gain.value = 0.018
    const lfo = ctx.createOscillator()
    lfo.frequency.value = 0.13
    const lfoDepth = ctx.createGain()
    lfoDepth.gain.value = 0.01
    lfo.connect(lfoDepth)
    lfoDepth.connect(murmurGain.gain)
    murmur.connect(murmurFilter)
    murmurFilter.connect(murmurGain)
    murmurGain.connect(this.ambienceBus)

    room.start()
    murmur.start()
    lfo.start()
    this.ambienceNodes = [room, murmur, lfo]
    this.scheduleDistantChips()
  }

  // 隔壁桌偶尔传来的筹码声
  scheduleDistantChips() {
    window.clearTimeout(this.ambienceTimer)
    this.ambienceTimer = window.setTimeout(() => {
      if (!this.ambienceNodes || this.muted) {
        this.scheduleDistantChips()
        return
      }
      const pan = rand(-0.9, 0.9)
      const count = Math.floor(rand(2, 6))
      const { ctx } = this
      const lowpass = ctx.createBiquadFilter()
      lowpass.type = 'lowpass'
      lowpass.frequency.value = 2200
      const gain = ctx.createGain()
      gain.gain.value = 0.35
      lowpass.connect(gain)
      gain.connect(this.ambienceBus)
      const send = ctx.createGain()
      send.gain.value = 0.8
      gain.connect(send)
      send.connect(this.reverbSend)
      for (let index = 0; index < count; index += 1) {
        const start = ctx.currentTime + index * rand(0.05, 0.12)
        const oscillator = ctx.createOscillator()
        oscillator.frequency.value = rand(2200, 3200)
        const envelope = ctx.createGain()
        envelope.gain.setValueAtTime(0.0001, start)
        envelope.gain.exponentialRampToValueAtTime(0.02, start + 0.002)
        envelope.gain.exponentialRampToValueAtTime(0.0001, start + 0.08)
        const panner = ctx.createStereoPanner()
        panner.pan.value = pan
        oscillator.connect(envelope)
        envelope.connect(panner)
        panner.connect(lowpass)
        oscillator.start(start)
        oscillator.stop(start + 0.1)
      }
      this.scheduleDistantChips()
    }, rand(4000, 9000))
  }

  stopAmbience() {
    window.clearTimeout(this.ambienceTimer)
    if (!this.ambienceNodes) {
      return
    }
    this.ambienceNodes.forEach((node) => {
      try {
        node.stop()
      } catch (error) {
        // 已停止
      }
    })
    this.ambienceNodes = null
  }
}

const soundEngine = new SoundEngine()

if (typeof window !== 'undefined') {
  const unlock = () => {
    soundEngine.ensure()
  }
  window.addEventListener('pointerdown', unlock, { passive: true })
  window.addEventListener('keydown', unlock)
}

export function seatPan(seat) {
  return SEAT_PAN[seat] ?? 0
}

// 移动端轻触反馈
export function haptic(pattern = 8) {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(pattern)
    }
  } catch (error) {
    // 不支持震动的设备直接忽略
  }
}

export default soundEngine
