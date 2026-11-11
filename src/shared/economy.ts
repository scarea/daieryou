// 积分体系定义：金币（场次底注）、荣誉（爵位）、经验（等级）、签到与救济。
import { MAX_ROUNDS, ROUND_SCORES } from './engine.ts'

export interface Hall {
  id: string
  name: string
  tagline: string
  /** 底注：每 1 分对局积分折算的金币 */
  stake: number
  /** 入场所需最低金币 */
  minCoins: number
  honorScale: number
}

/** 入场门槛 = 底注 × 30（每轮都被逮的常规最大输分） */
const ENTRY_SCORE = ROUND_SCORES.slice(0, MAX_ROUNDS).reduce((sum, score) => sum + score * 2, 0)

export const HALLS: Hall[] = [
  { id: 'qingyun', name: '青云厅', tagline: '初入江湖 · 小试牛刀', stake: 10, minCoins: 10 * ENTRY_SCORE, honorScale: 1 },
  { id: 'liujin', name: '鎏金阁', tagline: '牌逢对手 · 渐入佳境', stake: 50, minCoins: 50 * ENTRY_SCORE, honorScale: 1.5 },
  { id: 'longfeng', name: '龙凤殿', tagline: '高手云集 · 一掷千金', stake: 200, minCoins: 200 * ENTRY_SCORE, honorScale: 2 },
  { id: 'lingxiao', name: '凌霄殿', tagline: '问鼎之巅 · 富可敌国', stake: 1000, minCoins: 1000 * ENTRY_SCORE, honorScale: 3 },
]

export function hallById(id: string): Hall | undefined {
  return HALLS.find((hall) => hall.id === id)
}

export const START_COINS = 5000

// ------------------------------ 爵位（荣誉分） ------------------------------

export interface Title {
  name: string
  min: number
  color: string
}

export const TITLES: Title[] = [
  { name: '布衣', min: 0, color: '#b9a98a' },
  { name: '乡绅', min: 80, color: '#7fc8a9' },
  { name: '富贾', min: 240, color: '#6fb6f2' },
  { name: '巨贾', min: 600, color: '#c08cf5' },
  { name: '王侯', min: 1200, color: '#ff9a5a' },
  { name: '财神', min: 2400, color: '#ffd76a' },
]

export function titleOf(honor: number): { title: Title; index: number; next: Title | null; progress: number } {
  let index = 0
  TITLES.forEach((title, i) => { if (honor >= title.min) index = i })
  const title = TITLES[index]
  const next = TITLES[index + 1] ?? null
  const progress = next ? (honor - title.min) / (next.min - title.min) : 1
  return { title, index, next, progress: Math.max(0, Math.min(1, progress)) }
}

/** 一局结束的荣誉分变化：头名 +20、居中 +4、垫底 -12（按场次倍率） */
export function honorDelta(placement: number, lastPlacement: number, hall: Hall): number {
  const base = placement === 1 ? 20 : placement === lastPlacement ? -12 : 4
  return Math.round(base * hall.honorScale)
}

// ------------------------------ 等级（经验） ------------------------------

export function expGain(placement: number, total: number): number {
  return 20 + (placement === 1 ? 15 : 0) + Math.max(0, total) * 2
}

/** 升到 level+1 级所需经验 */
function expForLevel(level: number): number {
  return 80 + level * 40
}

export function levelOf(exp: number): { level: number; current: number; need: number } {
  let level = 1
  let rest = exp
  while (rest >= expForLevel(level) && level < 99) {
    rest -= expForLevel(level)
    level += 1
  }
  return { level, current: rest, need: expForLevel(level) }
}

// ------------------------------ 签到与救济 ------------------------------

export const SIGNIN_REWARDS = [500, 800, 1000, 1500, 2000, 3000, 6000]
export const RELIEF_THRESHOLD = HALLS[0].minCoins
export const RELIEF_AMOUNT = 2000
export const RELIEF_DAILY_LIMIT = 3

// ------------------------------ 头像 ------------------------------

export interface AvatarDef {
  glyph: string
  name: string
  from: string
  to: string
}

/** 头像为鎏金瑞兽印章：一个字 + 一组漆色 */
export const AVATARS: AvatarDef[] = [
  { glyph: '龙', name: '金龙', from: '#b3121d', to: '#5a070d' },
  { glyph: '凤', name: '丹凤', from: '#c2410c', to: '#6b1d05' },
  { glyph: '虎', name: '啸虎', from: '#92600a', to: '#4a2f03' },
  { glyph: '麟', name: '麒麟', from: '#0f766e', to: '#063b37' },
  { glyph: '鹤', name: '仙鹤', from: '#1d4ed8', to: '#0c1f5c' },
  { glyph: '狮', name: '瑞狮', from: '#7c2d92', to: '#3b0f47' },
  { glyph: '貔', name: '貔貅', from: '#166534', to: '#062c16' },
  { glyph: '鲤', name: '锦鲤', from: '#be123c', to: '#5c0519' },
  { glyph: '鹿', name: '福鹿', from: '#a16207', to: '#4d2e02' },
  { glyph: '龟', name: '玄龟', from: '#334155', to: '#0f172a' },
  { glyph: '蟾', name: '金蟾', from: '#4d7c0f', to: '#1f3305' },
  { glyph: '鹏', name: '鲲鹏', from: '#0369a1', to: '#062f4a' },
]

export function formatCoins(value: number): string {
  const abs = Math.abs(value)
  if (abs >= 100000000) return `${(value / 100000000).toFixed(2).replace(/\.?0+$/, '')}亿`
  if (abs >= 100000) return `${(value / 10000).toFixed(1).replace(/\.0$/, '')}万`
  return value.toLocaleString('en-US')
}
