// 字牌：细长的纸牌，上下各印一个字（下面那个倒着）。二、七、十是红字。
import { memo } from 'react'
import { lhIsBig, lhIsRed, lhKind, lhName, lhRank, lhSort } from '../../shared/liuhu/tiles.ts'

/** kind 为 -1 时显示牌背 */
export const Zi = memo(function Zi({ kind, className = '' }: { kind: number; className?: string }) {
  if (kind < 0) return <span className={`zi zi-back ${className}`} />
  const name = lhName(kind)
  return (
    <span className={`zi ${lhIsRed(kind) ? 'red' : ''} ${lhIsBig(kind) ? 'big' : ''} ${className}`}>
      <b>{name}</b>
      <i>{name}</i>
    </span>
  )
})

/** 把手牌理成一列一列：坎、二七十、一二三、搭、顺子、对子、差一张的搭子、单张 */
export function arrangeHand(hand: number[]): number[][] {
  const pool = new Map<number, number[]>()
  for (const tile of lhSort(hand)) pool.set(lhKind(tile), [...(pool.get(lhKind(tile)) ?? []), tile])
  const count = (kind: number) => pool.get(kind)?.length ?? 0
  const take = (kind: number) => (pool.get(kind) as number[]).shift() as number
  const columns: number[][] = []
  const each = (fn: (kind: number) => void) => { for (let kind = 0; kind < 20; kind += 1) fn(kind) }
  const run = (kinds: number[]) => { while (kinds.every((kind) => count(kind) > 0)) columns.push(kinds.map(take)) }

  each((kind) => { if (count(kind) >= 3) columns.push((pool.get(kind) as number[]).splice(0)) })
  for (const base of [0, 10]) {
    run([base + 1, base + 6, base + 9])
    run([base, base + 1, base + 2])
  }
  for (let rank = 0; rank < 10; rank += 1) {
    if (count(rank) === 2 && count(rank + 10) === 1) columns.push([take(rank), take(rank), take(rank + 10)])
    else if (count(rank) === 1 && count(rank + 10) === 2) columns.push([take(rank), take(rank + 10), take(rank + 10)])
  }
  for (const base of [0, 10]) for (let low = 0; low < 8; low += 1) run([base + low, base + low + 1, base + low + 2])
  each((kind) => { if (count(kind) === 2) columns.push([take(kind), take(kind)]) })
  // 差一张的搭子：相邻、隔一张、大小同点
  for (const gap of [1, 2]) {
    each((kind) => {
      const next = kind + gap
      if (next < 20 && Math.floor(kind / 10) === Math.floor(next / 10) && count(kind) > 0 && count(next) > 0) columns.push([take(kind), take(next)])
    })
  }
  for (let rank = 0; rank < 10; rank += 1) if (count(rank) > 0 && count(rank + 10) > 0) columns.push([take(rank), take(rank + 10)])
  each((kind) => { while (count(kind) > 0) columns.push([take(kind)]) })
  const key = (column: number[]) => lhRank(lhKind(column[0])) * 2 + (lhIsBig(lhKind(column[0])) ? 1 : 0)
  return columns.sort((a, b) => key(a) - key(b) || b.length - a.length)
}
