// 常宁六胡抢的牌：80 张字牌。小字 一~十、大字 壹~拾，各 4 张。二、七、十（贰、柒、拾）是红牌。
//
// kind（牌种）：0~9 小字一~十，10~19 大字壹~拾。id（具体某一张）：0~79，kind = id >> 2。

export const LH_KINDS = 20
export const LH_TOTAL = 80

const SMALL = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十']
const BIG = ['壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖', '拾']

export const lhKind = (id: number): number => id >> 2
export const lhIsBig = (kind: number): boolean => kind >= 10
/** 点数 1~10 */
export const lhRank = (kind: number): number => (kind % 10) + 1
export const lhIsRed = (kind: number): boolean => {
  const rank = lhRank(kind)
  return rank === 2 || rank === 7 || rank === 10
}
export const lhName = (kind: number): string => (kind >= 10 ? BIG[kind - 10] : SMALL[kind])
/** 同点数的另一种字（小 ↔ 大） */
export const lhTwin = (kind: number): number => (kind >= 10 ? kind - 10 : kind + 10)

export function lhCounts(ids: number[]): number[] {
  const counts = new Array<number>(LH_KINDS).fill(0)
  for (const id of ids) counts[id >> 2] += 1
  return counts
}

/** 手牌整理：按点数排，同点数小字在前 */
export function lhSort(ids: number[]): number[] {
  return [...ids].sort((a, b) => lhRank(lhKind(a)) - lhRank(lhKind(b)) || lhKind(a) - lhKind(b) || a - b)
}

/** 红黑倍数：全黑 5 倍、一点 4 倍、小红（8~9 张）2 倍、大红（≥10 张）4 倍，其余平胡 1 倍 */
export function redMultiplier(reds: number): { name: string; mult: number } {
  if (reds === 0) return { name: '全黑', mult: 5 }
  if (reds === 1) return { name: '一点', mult: 4 }
  if (reds >= 10) return { name: '大红', mult: 4 }
  if (reds >= 8) return { name: '小红', mult: 2 }
  return { name: '平胡', mult: 1 }
}
