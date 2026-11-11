// 音效：全部用 WebAudio 实时合成，无需任何音频文件。
const MUTE_KEY = 'daieryou.muted'

let context: AudioContext | null = null
let master: GainNode | null = null
let muted = false
try {
  muted = localStorage.getItem(MUTE_KEY) === '1'
} catch {
  muted = false
}

function audio(): { ctx: AudioContext; out: GainNode } | null {
  if (muted) return null
  try {
    if (!context) {
      context = new AudioContext()
      master = context.createGain()
      master.gain.value = 0.5
      master.connect(context.destination)
    }
    if (context.state === 'suspended') void context.resume()
    return { ctx: context, out: master as GainNode }
  } catch {
    return null
  }
}

function tone(freq: number, duration: number, options: { type?: OscillatorType; gain?: number; delay?: number; slideTo?: number } = {}): void {
  const a = audio()
  if (!a) return
  const start = a.ctx.currentTime + (options.delay ?? 0)
  const osc = a.ctx.createOscillator()
  const gain = a.ctx.createGain()
  osc.type = options.type ?? 'sine'
  osc.frequency.setValueAtTime(freq, start)
  if (options.slideTo) osc.frequency.exponentialRampToValueAtTime(options.slideTo, start + duration)
  gain.gain.setValueAtTime(0.0001, start)
  gain.gain.exponentialRampToValueAtTime(options.gain ?? 0.2, start + 0.012)
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration)
  osc.connect(gain).connect(a.out)
  osc.start(start)
  osc.stop(start + duration + 0.05)
}

function noise(duration: number, options: { gain?: number; delay?: number; freq?: number; q?: number } = {}): void {
  const a = audio()
  if (!a) return
  const start = a.ctx.currentTime + (options.delay ?? 0)
  const length = Math.max(1, Math.floor(a.ctx.sampleRate * duration))
  const buffer = a.ctx.createBuffer(1, length, a.ctx.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 2
  const source = a.ctx.createBufferSource()
  source.buffer = buffer
  const filter = a.ctx.createBiquadFilter()
  filter.type = 'bandpass'
  filter.frequency.value = options.freq ?? 2400
  filter.Q.value = options.q ?? 0.8
  const gain = a.ctx.createGain()
  gain.gain.value = options.gain ?? 0.25
  source.connect(filter).connect(gain).connect(a.out)
  source.start(start)
}

/** 拨弦音色（近似古筝）：三角波 + 泛音，快速衰减 */
function pluck(freq: number, options: { gain?: number; delay?: number; duration?: number } = {}): void {
  const duration = options.duration ?? 0.9
  tone(freq, duration, { type: 'triangle', gain: options.gain ?? 0.16, delay: options.delay })
  tone(freq * 2, duration * 0.5, { type: 'sine', gain: (options.gain ?? 0.16) * 0.35, delay: options.delay })
  tone(freq * 3, duration * 0.25, { type: 'sine', gain: (options.gain ?? 0.16) * 0.12, delay: options.delay })
}

/** 扫频噪声：出牌、转场的"唰"声 */
function whoosh(duration: number, from: number, to: number, gain = 0.2, delay = 0): void {
  const a = audio()
  if (!a) return
  const start = a.ctx.currentTime + delay
  const length = Math.floor(a.ctx.sampleRate * duration)
  const buffer = a.ctx.createBuffer(1, length, a.ctx.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < length; i += 1) data[i] = (Math.random() * 2 - 1) * Math.sin((Math.PI * i) / length)
  const source = a.ctx.createBufferSource()
  source.buffer = buffer
  const filter = a.ctx.createBiquadFilter()
  filter.type = 'bandpass'
  filter.Q.value = 1.2
  filter.frequency.setValueAtTime(from, start)
  filter.frequency.exponentialRampToValueAtTime(to, start + duration)
  const out = a.ctx.createGain()
  out.gain.value = gain
  source.connect(filter).connect(out).connect(a.out)
  source.start(start)
}

// ------------------------------ 背景音乐 ------------------------------
const MUSIC_KEY = 'daieryou.music'
let musicOn = true
try {
  musicOn = localStorage.getItem(MUSIC_KEY) !== '0'
} catch {
  musicOn = true
}
let musicEl: HTMLAudioElement | null = null

function startMusic(): void {
  if (!musicOn) return
  if (!musicEl) {
    musicEl = new Audio('/audio/bgm.mp3')
    musicEl.loop = true
    musicEl.volume = 0.22
  }
  void musicEl.play().catch(() => {})
}

export const music = {
  isOn: () => musicOn,
  setOn(value: boolean) {
    musicOn = value
    try {
      localStorage.setItem(MUSIC_KEY, value ? '1' : '0')
    } catch {
      // ignore
    }
    if (value) startMusic()
    else musicEl?.pause()
  },
  /** 浏览器要求用户操作后才能播放：在第一次点击时启动 */
  arm() {
    const kick = () => {
      startMusic()
      window.removeEventListener('pointerdown', kick)
      window.removeEventListener('keydown', kick)
    }
    window.addEventListener('pointerdown', kick)
    window.addEventListener('keydown', kick)
  },
}

/** 五声音阶（宫商角徵羽），用来做有东方韵味的提示音 */
const PENTA = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.5]

export const sfx = {
  isMuted: () => muted,
  setMuted(value: boolean) {
    muted = value
    try {
      localStorage.setItem(MUTE_KEY, value ? '1' : '0')
    } catch {
      // ignore
    }
  },
  click: () => tone(880, 0.06, { type: 'triangle', gain: 0.08 }),
  select: () => { noise(0.05, { gain: 0.18, freq: 3200 }); tone(1046.5, 0.07, { type: 'triangle', gain: 0.06 }) },
  deal: (count = 1) => { for (let i = 0; i < count; i += 1) noise(0.07, { gain: 0.2, freq: 2600, delay: i * 0.09 }) },
  play: () => { whoosh(0.22, 700, 2800, 0.2); noise(0.1, { gain: 0.3, freq: 1500, delay: 0.16 }); tone(220, 0.12, { type: 'sine', gain: 0.12, slideTo: 110, delay: 0.16 }) },
  flip: () => noise(0.09, { gain: 0.22, freq: 1800, q: 1.4 }),
  pop: () => tone(660, 0.1, { type: 'sine', gain: 0.1, slideTo: 990 }),
  tick: () => tone(1318.5, 0.05, { type: 'square', gain: 0.04 }),
  stamp: () => { tone(90, 0.3, { type: 'sine', gain: 0.5, slideTo: 40 }); noise(0.18, { gain: 0.35, freq: 400, q: 0.5 }) },
  coins: () => { for (let i = 0; i < 7; i += 1) tone(2200 + Math.random() * 1800, 0.09, { type: 'triangle', gain: 0.07, delay: i * 0.06 }) },
  win: () => { [0, 2, 4, 5, 7].forEach((note, i) => pluck(PENTA[note], { gain: 0.2, delay: i * 0.11 })); tone(196, 1.8, { type: 'sine', gain: 0.24, delay: 0.5 }); tone(98, 2, { type: 'sine', gain: 0.2, delay: 0.5 }) },
  lose: () => [4, 2, 1, 0].forEach((note, i) => pluck(PENTA[note] / 2, { gain: 0.18, delay: i * 0.2, duration: 1.1 })),
  gong: () => { tone(196, 1.6, { type: 'sine', gain: 0.3 }); tone(293.66, 1.3, { type: 'sine', gain: 0.12 }); tone(98, 1.8, { type: 'sine', gain: 0.25 }) },
  whoosh: () => whoosh(0.28, 500, 3200, 0.22),
  hover: () => tone(1568, 0.03, { type: 'sine', gain: 0.025 }),
  error: () => { tone(196, 0.16, { type: 'square', gain: 0.07 }); tone(147, 0.2, { type: 'square', gain: 0.07, delay: 0.1 }) },
  /** 对手出牌：轻一点的落牌声 */
  oppPlay: () => { noise(0.08, { gain: 0.16, freq: 1300 }); whoosh(0.16, 900, 2200, 0.08) },
  /** 新一轮开始：两声拨弦 */
  round: (index = 0) => { pluck(PENTA[index % 5] / 2, { gain: 0.2 }); pluck(PENTA[(index + 2) % 5], { gain: 0.14, delay: 0.14 }) },
  /** 暗牌回合：低沉的悬疑音 */
  mystery: () => { tone(110, 1.2, { type: 'sine', gain: 0.22, slideTo: 82 }); pluck(PENTA[1] / 2, { gain: 0.12, delay: 0.25 }); pluck(PENTA[0] / 2, { gain: 0.12, delay: 0.6 }) },
  /** 豹子：急促上行 + 锣 */
  leopard: () => { [0, 1, 2, 4, 5, 7].forEach((note, i) => pluck(PENTA[note], { gain: 0.16, delay: i * 0.06, duration: 0.5 })); tone(196, 1.4, { type: 'sine', gain: 0.26, delay: 0.36 }); whoosh(0.5, 300, 5000, 0.18) },
  /** 转场：殿门开合 */
  doors: () => { whoosh(0.4, 200, 900, 0.2); tone(70, 0.35, { type: 'sine', gain: 0.4, delay: 0.3, slideTo: 45 }) },
  /** 数字滚动时的金币声 */
  count: () => tone(2400 + Math.random() * 1200, 0.05, { type: 'triangle', gain: 0.035 }),
  /** 升爵 / 大奖 */
  fanfare: () => { [0, 2, 4, 5, 7, 5, 7].forEach((note, i) => pluck(PENTA[note], { gain: 0.18, delay: i * 0.1, duration: 0.7 })); tone(98, 1.6, { type: 'sine', gain: 0.28, delay: 0.7 }) },
  reward: () => { [0, 2, 4, 7].forEach((note, i) => tone(PENTA[note], 0.3, { type: 'triangle', gain: 0.14, delay: i * 0.07 })); sfx.coins() },
}
