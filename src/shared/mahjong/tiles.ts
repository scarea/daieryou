// 红中麻将的牌：万、条、筒各 36 张 + 4 张红中，共 112 张。红中是癞子（鬼牌）。
//
// kind（牌种）：0~8 万、9~17 条、18~26 筒、27 红中。
// id（具体某一张）：0~111，kind = id >> 2。

export const KIND_COUNT = 28
export const ZHONG = 27
export const TILE_TOTAL = 112
export const SUIT_NAMES = ['万', '条', '筒'] as const
const NUMERALS = ['一', '二', '三', '四', '五', '六', '七', '八', '九']

export const kindOf = (id: number): number => id >> 2
export const isZhong = (kind: number): boolean => kind === ZHONG
export const suitOf = (kind: number): number => (kind === ZHONG ? 3 : Math.floor(kind / 9))
/** 点数 1~9；红中返回 0 */
export const rankOf = (kind: number): number => (kind === ZHONG ? 0 : (kind % 9) + 1)

export function kindName(kind: number): string {
  if (kind === ZHONG) return '红中'
  return `${NUMERALS[kind % 9]}${SUIT_NAMES[suitOf(kind)]}`
}

/** 简写，如 3万、7条、中 */
export function kindShort(kind: number): string {
  if (kind === ZHONG) return '中'
  return `${rankOf(kind)}${SUIT_NAMES[suitOf(kind)]}`
}

export function allTiles(): number[] {
  return Array.from({ length: TILE_TOTAL }, (_, id) => id)
}

/** 把一组牌 id 统计成 28 个牌种的张数 */
export function countKinds(ids: number[]): number[] {
  const counts = new Array<number>(KIND_COUNT).fill(0)
  for (const id of ids) counts[id >> 2] += 1
  return counts
}

/** 手牌整理：万、条、筒按点数，红中放最左 */
export function sortTiles(ids: number[]): number[] {
  return [...ids].sort((a, b) => {
    const ka = kindOf(a) === ZHONG ? -1 : kindOf(a)
    const kb = kindOf(b) === ZHONG ? -1 : kindOf(b)
    return ka - kb || a - b
  })
}

/**
 * 抓鸟的分值：不分万条筒，只看点数。
 * 一点、九点、红中 = 10 分；其余 = 点数 + 1。
 */
export function birdScore(kind: number): number {
  const rank = rankOf(kind)
  if (rank === 0 || rank === 1 || rank === 9) return 10
  return rank + 1
}
