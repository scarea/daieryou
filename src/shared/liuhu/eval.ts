// 六胡抢牌力估算：机器人与复盘共用。
import { TableMeld, checkWin, chiGroup, groupHu } from './hand.ts'
import type { ChiOption } from './hand.ts'
import { LH_KINDS, lhCounts, lhIsBig, lhKind, lhRank, lhTwin } from './tiles.ts'

export const GROUP = 10
export const HU = 1.3

/** 一手散牌的价值：成型的门子、差一张的搭子、对子，以及它们带的胡数 */
export function handValue(counts: number[]): number {
  const cache = new Map<string, number>()
  const locked = counts.map((count) => count >= 3)
  const search = (): number => {
    let kind = 0
    while (kind < LH_KINDS && counts[kind] === 0) kind += 1
    if (kind === LH_KINDS) return 0
    const key = counts.join('')
    const known = cache.get(key)
    if (known !== undefined) return known
    const base = lhIsBig(kind) ? 10 : 0
    const rank = lhRank(kind)
    const at = (r: number) => (r >= 1 && r <= 10 && !locked[base + r - 1] ? counts[base + r - 1] : 0)
    let best = 0
    const use = (kinds: number[], value: number) => {
      for (const item of kinds) counts[item] -= 1
      best = Math.max(best, value + search())
      for (const item of kinds) counts[item] += 1
    }
    if (locked[kind]) {
      // 坎 / 提：整门拿走
      const size = counts[kind]
      counts[kind] = 0
      best = GROUP + groupHu(size === 4 ? 'ti' : 'kan', [kind]) * HU + search()
      counts[kind] = size
      cache.set(key, best)
      return best
    }
    // 单张留着
    use([kind], 0)
    // 顺子与差一张的顺子搭子
    if (at(rank + 1) && at(rank + 2)) use([kind, kind + 1, kind + 2], GROUP + (rank === 1 ? groupHu('seq', [kind, kind + 1, kind + 2]) : 0) * HU)
    if (at(rank + 1)) use([kind, kind + 1], rank === 1 || rank === 2 ? 4.5 : 4)
    if (at(rank + 2)) use([kind, kind + 2], 3)
    // 二七十
    if (rank === 2 && at(7) && at(10)) use([kind, base + 6, base + 9], GROUP + groupHu('ershi', [kind]) * HU)
    if (rank === 2 && at(7)) use([kind, base + 6], 3.5)
    if (rank === 2 && at(10)) use([kind, base + 9], 3.5)
    if (rank === 7 && at(10)) use([kind, base + 9], 3.5)
    // 对子：能碰、能笑、能做将
    if (counts[kind] >= 2) use([kind, kind], 5.5 + (lhIsBig(kind) ? 1 : 0))
    // 搭
    const twin = lhTwin(kind)
    if (twin > kind && !locked[twin] && counts[twin] > 0) {
      if (counts[kind] >= 2) use([kind, kind, twin], GROUP)
      if (counts[twin] >= 2) use([kind, twin, twin], GROUP)
      use([kind, twin], 3)
    }
    cache.set(key, best)
    return best
  }
  return search()
}

/** 这手牌在等哪些牌（按别人打出来算，最保守） */
export function waitsOf(melds: TableMeld[], hand: number[]): number[] {
  const kinds: number[] = []
  for (let kind = 0; kind < LH_KINDS; kind += 1) if (checkWin(melds, hand, kind * 4, false)) kinds.push(kind)
  return kinds
}

export interface DiscardValue {
  kind: number
  /** 打掉之后手牌的价值（含听牌加成） */
  value: number
  waits: number[]
}

/** 每一种能打的牌打出去之后的局面，按价值从高到低 */
export function discardValues(melds: TableMeld[], hand: number[], tiles: number[]): DiscardValue[] {
  const result: DiscardValue[] = []
  for (const kind of new Set(tiles.map(lhKind))) {
    const tile = tiles.find((item) => lhKind(item) === kind) as number
    const rest = hand.filter((item) => item !== tile)
    const waits = waitsOf(melds, rest)
    result.push({ kind, value: handValue(lhCounts(rest)) + waits.length * 6, waits })
  }
  return result.sort((a, b) => b.value - a.value)
}

/** 能打的牌：起手的坎不能拆 */
function freeTiles(hand: number[]): number[] {
  const free = hand.filter((tile) => hand.filter((other) => lhKind(other) === lhKind(tile)).length < 3)
  return free.length > 0 ? free : hand
}

/** 吃 / 碰之后（再打掉最没用的一张）比现在好多少 */
export function takeGain(melds: TableMeld[], hand: number[], removed: number[], gained: number): number {
  const rest = [...hand]
  for (const kind of removed) rest.splice(rest.findIndex((tile) => lhKind(tile) === kind), 1)
  const now = handValue(lhCounts(hand))
  const best = rest.length > 0 ? discardValues(melds, rest, freeTiles(rest))[0].value : 0
  return gained + best - now
}

/** 一种吃法要从手里拿走的牌，以及亮出来的门子值多少 */
export function chiCost(option: ChiOption, tileKind: number): { removed: number[]; gained: number } {
  const removed: number[] = []
  let gained = 0
  option.groups.forEach((kinds, index) => {
    const need = [...kinds]
    if (index === 0) need.splice(need.indexOf(tileKind), 1)
    removed.push(...need)
    gained += GROUP + chiGroup(kinds).hu * HU
  })
  return { removed, gained }
}
