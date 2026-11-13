// 麻将牌：牌体用 CSS 做出厚度与光影，牌面使用 FluffyStuff/riichi-mahjong-tiles 的矢量图（公有领域，见 public/tiles/CREDITS.txt）。
import { memo } from 'react'
import { ZHONG, kindName, rankOf, suitOf } from '../../shared/mahjong/tiles.ts'

const SUIT_FILE = ['m', 's', 'p']

export function tileSrc(kind: number): string {
  return kind === ZHONG ? '/tiles/zhong.svg' : `/tiles/${SUIT_FILE[suitOf(kind)]}${rankOf(kind)}.svg`
}

/** 进入牌桌时预加载全部牌面，避免第一次出现时闪一下 */
export function preloadTiles(): void {
  for (let kind = 0; kind <= ZHONG; kind += 1) {
    const image = new Image()
    image.src = tileSrc(kind)
  }
}

/** kind 为 -1 时显示牌背 */
export const Tile = memo(function Tile({ kind, className = '' }: { kind: number; className?: string }) {
  if (kind < 0) return <span className={`mj-tile mj-back ${className}`} />
  return (
    <span className={`mj-tile ${className}`} title={kindName(kind)}>
      <img src={tileSrc(kind)} alt={kindName(kind)} draggable={false} />
    </span>
  )
})
