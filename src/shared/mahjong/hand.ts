// 胡牌判定、向听数与进张计算（都支持红中当癞子）。
import { KIND_COUNT, ZHONG } from './tiles.ts'

// ------------------------------ 胡牌判定 ------------------------------

const needCache = new Map<number, number>()
const suitKey = (counts: number[], offset: number): number => {
  let key = 0
  for (let i = 0; i < 9; i += 1) key = key * 5 + counts[offset + i]
  return key
}

/** 把一门花色的牌全部组成顺子 / 刻子，最少还要几张癞子 */
function suitNeed(counts: number[], offset: number): number {
  const key = suitKey(counts, offset)
  const cached = needCache.get(key)
  if (cached !== undefined) return cached

  let first = -1
  for (let i = 0; i < 9; i += 1) {
    if (counts[offset + i] > 0) {
      first = i
      break
    }
  }
  if (first === -1) {
    needCache.set(key, 0)
    return 0
  }

  const at = offset + first
  const have = counts[at]
  let best = 99

  // 刻子：缺几张补几张癞子
  const take = Math.min(have, 3)
  counts[at] -= take
  best = Math.min(best, 3 - take + suitNeed(counts, offset))
  counts[at] += take

  // 顺子：以这张为最小牌，另外两张可以由癞子顶替
  if (first <= 7 && counts[at + 1] > 0) {
    counts[at] -= 1
    counts[at + 1] -= 1
    if (first <= 6 && counts[at + 2] > 0) {
      counts[at + 2] -= 1
      best = Math.min(best, suitNeed(counts, offset))
      counts[at + 2] += 1
    }
    best = Math.min(best, 1 + suitNeed(counts, offset))
    counts[at] += 1
    counts[at + 1] += 1
  }
  if (first <= 6 && counts[at + 2] > 0) {
    counts[at] -= 1
    counts[at + 2] -= 1
    best = Math.min(best, 1 + suitNeed(counts, offset))
    counts[at] += 1
    counts[at + 2] += 1
  }

  needCache.set(key, best)
  return best
}

export interface WinOptions {
  /** 七对是否算胡 */
  sevenPairs: boolean
  /** 手握四张红中直接胡 */
  fourZhong: boolean
}

/** 四组（顺子 / 刻子）加一对将 */
function standardWin(counts: number[]): boolean {
  const jokers = counts[ZHONG]
  const needs = [suitNeed(counts, 0), suitNeed(counts, 9), suitNeed(counts, 18)]
  const total = needs[0] + needs[1] + needs[2]
  // 两张癞子做将
  if (total + 2 <= jokers) return true
  for (let kind = 0; kind < ZHONG; kind += 1) {
    const have = counts[kind]
    if (have === 0) continue
    const suit = Math.floor(kind / 9)
    const rest = total - needs[suit]
    if (have >= 2) {
      counts[kind] -= 2
      const ok = rest + suitNeed(counts, suit * 9) <= jokers
      counts[kind] += 2
      if (ok) return true
    }
    // 一张真牌 + 一张癞子做将
    counts[kind] -= 1
    const ok = rest + suitNeed(counts, suit * 9) + 1 <= jokers
    counts[kind] += 1
    if (ok) return true
  }
  return false
}

function sevenPairsWin(counts: number[]): boolean {
  let odd = 0
  for (let kind = 0; kind < ZHONG; kind += 1) odd += counts[kind] % 2
  return odd <= counts[ZHONG]
}

/**
 * 判断手牌能否胡。counts 是暗手牌（不含已碰杠的牌）的各牌种张数，
 * 张数必须是 3n+2；melds 是已碰 / 杠的组数。
 */
export function canWin(counts: number[], melds: number, options: WinOptions): boolean {
  let size = 0
  for (let kind = 0; kind < KIND_COUNT; kind += 1) size += counts[kind]
  if (size % 3 !== 2 || size + melds * 3 !== 14) return false
  if (options.fourZhong && counts[ZHONG] === 4) return true
  if (standardWin(counts)) return true
  return options.sevenPairs && melds === 0 && sevenPairsWin(counts)
}

/** 杀鬼：胡牌时手里没有红中 */
export function isShaGui(counts: number[]): boolean {
  return counts[ZHONG] === 0
}

// ------------------------------ 向听数 ------------------------------

/** 一门花色里，凑出 m 组面子时最多还能有几个搭子（对子 / 两面 / 嵌张 / 边张） */
const blockCache = new Map<number, number[]>()

function suitBlocks(counts: number[], offset: number): number[] {
  const key = suitKey(counts, offset)
  const cached = blockCache.get(key)
  if (cached) return cached
  const best = [-1, -1, -1, -1, -1]

  const search = (index: number, melds: number, partials: number): void => {
    while (index < 9 && counts[offset + index] === 0) index += 1
    if (index >= 9) {
      if (partials > best[melds]) best[melds] = partials
      return
    }
    const at = offset + index
    if (melds < 4) {
      if (counts[at] >= 3) {
        counts[at] -= 3
        search(index, melds + 1, partials)
        counts[at] += 3
      }
      if (index <= 6 && counts[at + 1] > 0 && counts[at + 2] > 0) {
        counts[at] -= 1
        counts[at + 1] -= 1
        counts[at + 2] -= 1
        search(index, melds + 1, partials)
        counts[at] += 1
        counts[at + 1] += 1
        counts[at + 2] += 1
      }
    }
    if (counts[at] >= 2) {
      counts[at] -= 2
      search(index, melds, partials + 1)
      counts[at] += 2
    }
    if (index <= 7 && counts[at + 1] > 0) {
      counts[at] -= 1
      counts[at + 1] -= 1
      search(index, melds, partials + 1)
      counts[at] += 1
      counts[at + 1] += 1
    }
    if (index <= 6 && counts[at + 2] > 0) {
      counts[at] -= 1
      counts[at + 2] -= 1
      search(index, melds, partials + 1)
      counts[at] += 1
      counts[at + 2] += 1
    }
    // 这张当孤张
    const keep = counts[at]
    counts[at] = 0
    search(index + 1, melds, partials)
    counts[at] = keep
  }
  search(0, 0, 0)
  // 面子少一些、搭子不会更少：补齐单调性，方便后面合并
  for (let m = 3; m >= 0; m -= 1) if (best[m] < best[m + 1]) best[m] = Math.max(best[m], best[m + 1])
  blockCache.set(key, best)
  return best
}

/** 不考虑将牌时，三门花色合计的最好成绩：返回 max(2×面子 + 搭子)，搭子数受"面子 + 搭子 ≤ 4"限制 */
function bestBlocks(counts: number[], fixedMelds: number): number {
  const suits = [suitBlocks(counts, 0), suitBlocks(counts, 9), suitBlocks(counts, 18)]
  let best = 0
  for (let a = 0; a <= 4; a += 1) {
    if (suits[0][a] < 0) continue
    for (let b = 0; a + b <= 4; b += 1) {
      if (suits[1][b] < 0) continue
      for (let c = 0; a + b + c <= 4; c += 1) {
        if (suits[2][c] < 0) continue
        const melds = fixedMelds + a + b + c
        if (melds > 4) continue
        const partials = Math.min(4 - melds, suits[0][a] + suits[1][b] + suits[2][c])
        best = Math.max(best, 2 * melds + partials)
      }
    }
  }
  return best
}

/**
 * 向听数：还差几张有效牌才能听牌（0 = 已听牌，-1 = 已胡）。
 * counts 为暗手牌，melds 为已碰杠组数。红中每张都算一张万能有效牌。
 */
export function shanten(counts: number[], melds: number, options: WinOptions): number {
  let size = 0
  for (let kind = 0; kind < KIND_COUNT; kind += 1) size += counts[kind]
  const floor = size % 3 === 2 ? -1 : 0
  const jokers = counts[ZHONG]
  if (floor === -1 && options.fourZhong && jokers === 4) return -1

  // 一般型：8 − 2×面子 − 搭子 − 将
  let standard = 8 - bestBlocks(counts, melds)
  for (let kind = 0; kind < ZHONG; kind += 1) {
    if (counts[kind] < 2) continue
    counts[kind] -= 2
    standard = Math.min(standard, 7 - bestBlocks(counts, melds))
    counts[kind] += 2
  }
  let result = standard - jokers

  if (options.sevenPairs && melds === 0) {
    let pairs = 0
    for (let kind = 0; kind < ZHONG; kind += 1) pairs += counts[kind] >> 1
    result = Math.min(result, 6 - Math.min(7, pairs) - jokers)
  }
  // 公式在癞子的边界情形可能差一步：靠近听牌 / 胡牌时用精确判定校正
  if (floor === -1) {
    if (canWin(counts, melds, options)) return -1
    return Math.max(0, result)
  }
  if (result <= 1) {
    for (let kind = 0; kind < KIND_COUNT; kind += 1) {
      counts[kind] += 1
      const wins = canWin(counts, melds, options)
      counts[kind] -= 1
      if (wins) return 0
    }
    return Math.max(1, result)
  }
  return result
}

// ------------------------------ 进张 ------------------------------

export interface DiscardOption {
  /** 打出的牌种 */
  kind: number
  /** 打出后的向听数 */
  shanten: number
  /** 能让向听数前进的牌种 */
  accepts: number[]
  /** 这些牌在场上还剩多少张（进张数） */
  ukeire: number
}

/**
 * 分析每一种打法：打出后的向听数与进张。
 * counts 为 3n+2 张的暗手牌；remaining 为各牌种在自己看不到的地方还剩几张。
 */
export function analyzeDiscards(counts: number[], melds: number, remaining: number[], options: WinOptions): DiscardOption[] {
  const result: DiscardOption[] = []
  for (let kind = 0; kind < KIND_COUNT; kind += 1) {
    if (counts[kind] === 0) continue
    counts[kind] -= 1
    const base = shanten(counts, melds, options)
    const accepts: number[] = []
    let ukeire = 0
    for (let draw = 0; draw < KIND_COUNT; draw += 1) {
      if (remaining[draw] <= 0) continue
      counts[draw] += 1
      const next = shanten(counts, melds, options)
      counts[draw] -= 1
      if (next < base) {
        accepts.push(draw)
        ukeire += remaining[draw]
      }
    }
    counts[kind] += 1
    result.push({ kind, shanten: base, accepts, ukeire })
  }
  // 向听数小的在前；同向听进张多的在前
  return result.sort((a, b) => a.shanten - b.shanten || b.ukeire - a.ukeire)
}

/** 听牌时在等哪些牌（counts 为 3n+1 张） */
export function waits(counts: number[], melds: number, remaining: number[], options: WinOptions): { kind: number; left: number }[] {
  const result: { kind: number; left: number }[] = []
  for (let kind = 0; kind < KIND_COUNT; kind += 1) {
    counts[kind] += 1
    if (canWin(counts, melds, options)) result.push({ kind, left: Math.max(0, remaining[kind]) })
    counts[kind] -= 1
  }
  return result
}
