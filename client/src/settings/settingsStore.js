import { create } from 'zustand'
import soundEngine, { haptic } from '../audio/soundEngine'

const STORAGE_KEY = 'daieryou_settings_v1'

function readStored() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch (error) {
    return null
  }
}

function writeStored(settings) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch (error) {
    // 隐私模式等场景下无法持久化，忽略
  }
}

function detectDefaults() {
  const isBrowser = typeof window !== 'undefined'
  const coarse = isBrowser && window.matchMedia?.('(pointer: coarse)').matches
  const reducedMotion = isBrowser && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  return {
    musicVolume: 0.3,
    sfxVolume: 0.8,
    ambienceVolume: 0.5,
    muted: false,
    // 触屏设备默认中画质，桌面默认高画质
    quality: coarse ? 'medium' : 'high',
    reducedMotion: Boolean(reducedMotion),
    haptics: true,
  }
}

const PERSISTED_KEYS = ['musicVolume', 'sfxVolume', 'ambienceVolume', 'muted', 'quality', 'reducedMotion', 'haptics']

export const QUALITY_PRESETS = {
  high: { dpr: [1, 1.75], shadows: true, sparkles: 1, backgroundTables: true },
  medium: { dpr: [1, 1.25], shadows: true, sparkles: 0.5, backgroundTables: true },
  low: { dpr: [0.75, 1], shadows: false, sparkles: 0, backgroundTables: false },
}

const initial = typeof window !== 'undefined'
  ? { ...detectDefaults(), ...(readStored() || {}) }
  : detectDefaults()

function applyToEngine(state) {
  soundEngine.setVolumes({ sfx: state.sfxVolume, ambience: state.ambienceVolume })
  soundEngine.setMuted(state.muted)
}

applyToEngine(initial)

const useSettingsStore = create((set, get) => ({
  ...initial,
  update: (patch) => {
    const next = { ...get(), ...patch }
    set(patch)
    applyToEngine(next)
    writeStored(Object.fromEntries(PERSISTED_KEYS.map((key) => [key, next[key]])))
  },
  toggleMuted: () => {
    get().update({ muted: !get().muted })
  },
}))

// 统一的震动入口：尊重用户设置
export function tapFeedback(pattern = 8) {
  if (useSettingsStore.getState().haptics) {
    haptic(pattern)
  }
}

export default useSettingsStore
