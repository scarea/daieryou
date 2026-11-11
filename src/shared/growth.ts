// 成长体系：每日任务、成就、赛季。
import { TITLES, titleOf } from './economy.ts'

export interface GrowthStats {
  games: number
  wins: number
  leopards: number
  bestWin: number
  honor: number
  isGuest: boolean
  dayGames: number
  dayWins: number
  signedToday: boolean
}

export interface GrowthDef {
  id: string
  title: string
  desc: string
  reward: number
  target: number
  progress: (stats: GrowthStats) => number
}

export const DAILY_TASKS: GrowthDef[] = [
  { id: 't_signin', title: '每日一签', desc: '完成今日签到', reward: 200, target: 1, progress: (s) => (s.signedToday ? 1 : 0) },
  { id: 't_games3', title: '小试身手', desc: '今日完成 3 局对局', reward: 600, target: 3, progress: (s) => s.dayGames },
  { id: 't_win1', title: '拔得头筹', desc: '今日拿下 1 次整局头名', reward: 800, target: 1, progress: (s) => s.dayWins },
  { id: 't_games8', title: '乐此不疲', desc: '今日完成 8 局对局', reward: 1500, target: 8, progress: (s) => s.dayGames },
]

export const ACHIEVEMENTS: GrowthDef[] = [
  { id: 'a_first', title: '初出茅庐', desc: '完成第 1 局对局', reward: 500, target: 1, progress: (s) => s.games },
  { id: 'a_bind', title: '名正言顺', desc: '绑定正式账号', reward: 1000, target: 1, progress: (s) => (s.isGuest ? 0 : 1) },
  { id: 'a_g20', title: '身经百战', desc: '累计完成 20 局', reward: 2000, target: 20, progress: (s) => s.games },
  { id: 'a_g100', title: '牌桌常客', desc: '累计完成 100 局', reward: 8000, target: 100, progress: (s) => s.games },
  { id: 'a_w10', title: '常胜将军', desc: '累计 10 次整局头名', reward: 3000, target: 10, progress: (s) => s.wins },
  { id: 'a_w50', title: '独孤求败', desc: '累计 50 次整局头名', reward: 15000, target: 50, progress: (s) => s.wins },
  { id: 'a_leo1', title: '豹子头', desc: '打出 1 次豹子', reward: 1000, target: 1, progress: (s) => s.leopards },
  { id: 'a_leo10', title: '豹子王', desc: '累计打出 10 次豹子', reward: 6000, target: 10, progress: (s) => s.leopards },
  { id: 'a_rich', title: '腰缠万贯', desc: '单局赢取 2,000 金币以上', reward: 2000, target: 2000, progress: (s) => s.bestWin },
  { id: 'a_title2', title: '富甲一方', desc: `爵位达到「${TITLES[2].name}」`, reward: 3000, target: TITLES[2].min, progress: (s) => s.honor },
  { id: 'a_title4', title: '封王拜侯', desc: `爵位达到「${TITLES[4].name}」`, reward: 20000, target: TITLES[4].min, progress: (s) => s.honor },
]

export interface GrowthItem {
  id: string
  title: string
  desc: string
  reward: number
  target: number
  progress: number
  done: boolean
  claimed: boolean
}

export function growthItems(defs: GrowthDef[], stats: GrowthStats, claimed: string[]): GrowthItem[] {
  return defs.map((def) => {
    const progress = Math.min(def.target, def.progress(stats))
    return {
      id: def.id, title: def.title, desc: def.desc, reward: def.reward, target: def.target,
      progress, done: progress >= def.target, claimed: claimed.includes(def.id),
    }
  })
}

// ------------------------------ 赛季 ------------------------------

/** 赛季按自然月（东八区）划分，例如 2026-11 */
export function seasonId(now = Date.now()): string {
  const date = new Date(now + 8 * 3600 * 1000)
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

/** 赛季结束时按爵位发放的金币奖励 */
export const SEASON_REWARDS = [0, 500, 1500, 4000, 10000, 30000]

/** 新赛季荣誉分保留四成 */
export function seasonReset(honor: number): { honor: number; reward: number; title: string } {
  const { title, index } = titleOf(honor)
  return { honor: Math.floor(honor * 0.4), reward: SEASON_REWARDS[index] ?? 0, title: title.name }
}

/** 距离赛季结束还有几天 */
export function seasonDaysLeft(now = Date.now()): number {
  const date = new Date(now + 8 * 3600 * 1000)
  const end = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1)
  return Math.max(1, Math.ceil((end - date.getTime()) / 86400000))
}
