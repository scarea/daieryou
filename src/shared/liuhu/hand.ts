// 六胡抢：门子与胡数、胡牌判定、吃牌（含下伙）。
//
// 胡牌牌型（张数由规则自然决定）：
//   - 没有提 / 龙 / 跑：5 门，共 15 张；
//   - 有提 / 龙 / 跑：一共 4 门（四张的也算一门）+ 1 对将。
//     （第一个四张的门子要打一张，之后的"重跑"不打，所以每多一个四张的门，总张数多一张。）
// 另须胡数 ≥ 6。
import { LH_KINDS, lhIsBig, lhIsRed, lhKind, lhRank, lhTwin } from './tiles.ts'

export type GroupType =
  | 'peng' // 碰：一对 + 别人打出 / 摸出的第三张（全亮）
  | 'kan' // 坎：起手就有的三张（暗）
  | 'xiao' // 笑：一对 + 自己摸到第三张
  | 'pao' // 跑：别人的第四张
  | 'ti' // 提 / 龙：自己摸到第四张，或起手四张
  | 'seq' // 顺子（含一二三）
  | 'ershi' // 二七十
  | 'da' // 搭：大小三搭
  | 'pair' // 将

export const GROUP_NAME: Record<GroupType, string> = {
  peng: '碰', kan: '坎', xiao: '笑', pao: '跑', ti: '提', seq: '顺子', ershi: '二七十', da: '搭', pair: '将',
}

export interface LhGroup {
  type: GroupType
  /** 组成这一门的牌种 */
  kinds: number[]
  hu: number
}

export interface LhRules {
  /** 普通顺子（四五六等）是否也算胡数；否则只有一二三、二七十算 */
  seqAllScore: boolean
  /** 起胡的胡数 */
  minHu: number
}

export const LH_RULES: LhRules = { seqAllScore: false, minHu: 6 }

const pick = (kind: number, small: number, big: number) => (lhIsBig(kind) ? big : small)

/** 各种门子的胡数：大字 = 小字 + 3 */
export function groupHu(type: GroupType, kinds: number[], rules: LhRules = LH_RULES): number {
  const kind = kinds[0]
  switch (type) {
    case 'peng': return pick(kind, 0, 3)
    case 'kan':
    case 'xiao': return pick(kind, 3, 6)
    case 'pao': return pick(kind, 6, 9)
    case 'ti': return pick(kind, 9, 12)
    case 'ershi': return pick(kind, 3, 6)
    case 'seq': {
      const lowest = Math.min(...kinds.map(lhRank))
      return lowest === 1 || rules.seqAllScore ? pick(kind, 3, 6) : 0
    }
    default: return 0
  }
}

export const makeGroup = (type: GroupType, kinds: number[], rules: LhRules = LH_RULES): LhGroup => ({ type, kinds, hu: groupHu(type, kinds, rules) })

export const isFour = (type: GroupType) => type === 'pao' || type === 'ti'

/** 含有某张牌、且三张都在同一种字里的组合：顺子与二七十 */
function runsWith(kind: number): number[][] {
  const base = lhIsBig(kind) ? 10 : 0
  const rank = lhRank(kind)
  const result: number[][] = []
  for (let low = Math.max(1, rank - 2); low <= Math.min(8, rank); low += 1) result.push([base + low - 1, base + low, base + low + 1])
  if (rank === 2 || rank === 7 || rank === 10) result.push([base + 1, base + 6, base + 9])
  return result
}
const isErShi = (kinds: number[]) => kinds.map(lhRank).sort((a, b) => a - b).join() === '2,7,10'

// ------------------------------ 把手牌拆成门子 ------------------------------

interface Split {
  hu: number
  groups: LhGroup[]
}

/**
 * 把一手牌全部拆成门子，求最大胡数。
 * @param counts  各牌种张数（会被就地修改再还原）
 * @param fours   桌上已有的四张门子数（提 / 跑）
 * @param outside 刚进来的那张牌的牌种（-1 表示没有）：用它凑成的三张不算坎
 * @param self    那张牌是不是自己摸的（自己摸 → 笑，别人的 → 碰）
 */
export function splitHand(counts: number[], fours: number, outside: number, self: boolean, rules: LhRules = LH_RULES): Split | null {
  // 起手就有的三张 / 四张是坎 / 提，不能拆开另作他用
  const locked = counts.map((count, kind) => count >= 3 && kind !== outside)
  let best: Split | null = null
  const stack: LhGroup[] = []

  const search = (hu: number, usedPair: boolean, handFours: number): void => {
    let kind = 0
    while (kind < LH_KINDS && counts[kind] === 0) kind += 1
    if (kind === LH_KINDS) {
      // 有四张的门子才需要一对将，没有则不能有将
      if ((fours + handFours > 0) !== usedPair) return
      if (!best || hu > best.hu) best = { hu, groups: [...stack] }
      return
    }
    const take = (group: LhGroup, remove: number[], pair: boolean, four: number) => {
      for (const item of remove) counts[item] -= 1
      stack.push(group)
      search(hu + group.hu, usedPair || pair, handFours + four)
      stack.pop()
      for (const item of remove) counts[item] += 1
    }
    const have = counts[kind]

    if (have === 4) {
      // 四张都在手里：提（不论哪张是刚进来的，四张的门子只有提或跑两种）
      take(makeGroup(kind === outside && !self ? 'pao' : 'ti', [kind, kind, kind, kind], rules), [kind, kind, kind, kind], false, 1)
      if (locked[kind]) return
    }
    if (have >= 3) {
      // 手里本来就有三张、外来的是第四张时，这三张仍是坎
      const type: GroupType = kind === outside && have === 3 ? (self ? 'xiao' : 'peng') : 'kan'
      take(makeGroup(type, [kind, kind, kind], rules), [kind, kind, kind], false, 0)
      if (locked[kind]) return
    }
    if (locked[kind]) return
    if (have >= 2 && !usedPair) take(makeGroup('pair', [kind, kind], rules), [kind, kind], true, 0)
    for (const run of runsWith(kind)) {
      // 只从当前最小的牌往后凑，避免重复搜索；二七十以二为起点
      if (Math.min(...run) !== kind) continue
      if (run.some((item) => counts[item] === 0 || locked[item])) continue
      take(makeGroup(isErShi(run) ? 'ershi' : 'seq', run, rules), run, false, 0)
    }
    // 搭：两张 + 另一种字的同点数一张
    const twin = lhTwin(kind)
    if (twin > kind && !locked[twin]) {
      if (have >= 2 && counts[twin] >= 1) take(makeGroup('da', [kind, kind, twin], rules), [kind, kind, twin], false, 0)
      if (counts[twin] >= 2) take(makeGroup('da', [kind, twin, twin], rules), [kind, twin, twin], false, 0)
    }
  }
  search(0, false, 0)
  return best
}

// ------------------------------ 胡牌判定 ------------------------------

export interface WinResult {
  hu: number
  /** 桌上的门子 + 手里拆出的门子（含将） */
  groups: LhGroup[]
  reds: number
}

export interface TableMeld {
  type: GroupType
  kind: number
  /** 组成的牌 id */
  tiles: number[]
  hu: number
}

/**
 * 判断能不能胡，返回胡数最大的拆法。
 * @param melds 已经亮在桌上的门子
 * @param hand  手牌 id
 * @param tile  要胡的那张牌（id）；null 表示手牌本身已经成牌（如庄家起手）
 * @param self  那张牌是不是自己摸的
 */
export function checkWin(melds: TableMeld[], hand: number[], tile: number | null, self: boolean, rules: LhRules = LH_RULES): WinResult | null {
  const counts = new Array<number>(LH_KINDS).fill(0)
  for (const id of hand) counts[id >> 2] += 1
  const fixed: LhGroup[] = melds.map((meld) => ({ type: meld.type, kinds: meld.tiles.map(lhKind), hu: meld.hu }))
  const fours = melds.filter((meld) => isFour(meld.type)).length
  const candidates: { hu: number; groups: LhGroup[] }[] = []
  const push = (table: LhGroup[], split: Split | null) => {
    if (split) candidates.push({ hu: table.reduce((sum, group) => sum + group.hu, 0) + split.hu, groups: [...table, ...split.groups] })
  }

  if (tile === null) {
    push(fixed, splitHand(counts, fours, -1, true, rules))
  } else {
    const kind = lhKind(tile)
    // 这张牌让桌上的碰 / 笑变成跑 / 提
    const index = melds.findIndex((meld) => meld.kind === kind && (meld.type === 'peng' || meld.type === 'xiao'))
    if (index >= 0) {
      const type: GroupType = melds[index].type === 'xiao' && self ? 'ti' : 'pao'
      const table = fixed.map((group, i) => (i === index ? makeGroup(type, [kind, kind, kind, kind], rules) : group))
      push(table, splitHand(counts, fours + 1, -1, self, rules))
    }
    // 这张牌进手牌（凑坎成提 / 跑、凑对成笑 / 碰、凑顺子、凑搭、凑将）
    counts[kind] += 1
    push(fixed, splitHand(counts, fours, kind, self, rules))
    counts[kind] -= 1
  }

  let best: { hu: number; groups: LhGroup[] } | null = null
  for (const candidate of candidates) if (!best || candidate.hu > best.hu) best = candidate
  if (!best || best.hu < rules.minHu) return null
  const all = [...melds.flatMap((meld) => meld.tiles), ...hand, ...(tile === null ? [] : [tile])]
  return { hu: best.hu, groups: best.groups, reds: all.filter((id) => lhIsRed(id >> 2)).length }
}

// ------------------------------ 吃牌与下伙 ------------------------------

export interface ChiOption {
  /** 每一门的三个牌种；第一门包含被吃的那张，其余是下伙时一起亮出来的 */
  groups: number[][]
}

/** 含有某牌种的所有三张组合（顺子、二七十、搭） */
function groupsWith(kind: number): number[][] {
  const twin = lhTwin(kind)
  return [...runsWith(kind), [kind, kind, twin], [kind, twin, twin]]
}

/**
 * 能怎么吃这张牌。
 * 下伙：吃了之后手里如果还有同样的牌，必须把它们也组成门子一起亮出来；亮不出来就不能吃。
 * 起手的坎（三张）不能拆开用。
 */
export function chiOptions(hand: number[], tile: number): ChiOption[] {
  const counts = new Array<number>(LH_KINDS).fill(0)
  for (const id of hand) counts[id >> 2] += 1
  const locked = counts.map((count) => count >= 3)
  const kind = lhKind(tile)
  if (locked[kind]) return []
  const options: ChiOption[] = []
  const seen = new Set<string>()
  const chosen: number[][] = []

  const usable = (group: number[], fromOutside: boolean): number[] | null => {
    // 这一门需要从手里拿出哪些牌；fromOutside 时其中一张由被吃的牌顶上
    const need = [...group]
    if (fromOutside) need.splice(need.indexOf(kind), 1)
    const used = new Array<number>(LH_KINDS).fill(0)
    for (const item of need) {
      used[item] += 1
      if (locked[item] || used[item] > counts[item]) return null
    }
    return need
  }

  const extend = (): void => {
    if (counts[kind] === 0) {
      const key = chosen.map((group) => [...group].sort((a, b) => a - b).join('.')).sort().join('|')
      if (!seen.has(key)) {
        seen.add(key)
        options.push({ groups: chosen.map((group) => [...group]) })
      }
      return
    }
    // 手里还有同样的牌：继续下伙
    for (const group of groupsWith(kind)) {
      const need = usable(group, false)
      if (!need) continue
      for (const item of need) counts[item] -= 1
      chosen.push(group)
      extend()
      chosen.pop()
      for (const item of need) counts[item] += 1
    }
  }

  for (const group of groupsWith(kind)) {
    const need = usable(group, true)
    if (!need) continue
    for (const item of need) counts[item] -= 1
    chosen.push(group)
    extend()
    chosen.pop()
    for (const item of need) counts[item] += 1
  }
  return options
}

/** 一门吃牌的类型与胡数 */
export function chiGroup(kinds: number[], rules: LhRules = LH_RULES): LhGroup {
  const sameSize = kinds.every((kind) => lhIsBig(kind) === lhIsBig(kinds[0]))
  if (!sameSize) return makeGroup('da', kinds, rules)
  return makeGroup(isErShi(kinds) ? 'ershi' : 'seq', [...kinds].sort((a, b) => a - b), rules)
}
