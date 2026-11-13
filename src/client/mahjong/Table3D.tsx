// 立体麻将桌：方桌、牌墙、朝向各家的弃牌、立在桌边的对手手牌。
// 所有物件都是真正的 3D 盒子（CSS preserve-3d），镜头从我的座位斜向下看。
//
// 桌面坐标：以桌心为原点，+y 朝向"这一家"的座位。每家的物件先按"坐在下方"摆好，
// 再整体绕桌心旋转到各自的方位，所以弃牌、手牌、牌墙天然朝向各家。
import { memo } from 'react'
import type { Meld } from '../../shared/mahjong/game.ts'
import { kindOf, sortTiles } from '../../shared/mahjong/tiles.ts'
import type { MjView } from '../../shared/mahjong/view.ts'
import { tileSrc } from './Tile.tsx'

const TW = 38 // 牌宽
const TH = 52 // 牌高
const TD = 22 // 牌厚
const RIVER_Y = 82 // 弃牌第一行离桌心的距离
const WALL_Y = 304 // 牌墙离桌心的距离
const HAND_Y = 366 // 立牌离桌心的距离
const STACKS_PER_SIDE = 14

type Pose = 'flat' | 'down' | 'stand'

/** 一张 3D 牌。flat：正面朝上平躺；down：背面朝上（牌墙）；stand：立着，正面朝向这一家 */
const Tile3 = memo(function Tile3({ kind, x, y, pose, depth = TD, className = '' }: { kind: number; x: number; y: number; pose: Pose; depth?: number; className?: string }) {
  if (pose === 'stand') {
    // 占地 TW × TD，高 TH
    return (
      <div className={`t3 stand ${className}`} style={{ transform: `translate3d(${x - TW / 2}px, ${y - TD / 2}px, 0)` }}>
        <i className="f cap" />
        <i className="f n" />
        <i className="f s" />
        <i className="f e" />
        <i className="f w" />
      </div>
    )
  }
  return (
    <div className={`t3 ${pose} ${className}`} style={{ transform: `translate3d(${x - TW / 2}px, ${y - TH / 2}px, 0)`, ['--d' as string]: `${depth}px` }}>
      <i className="f top">{pose === 'flat' && kind >= 0 && <img src={tileSrc(kind)} alt="" draggable={false} />}</i>
      <i className="f s" />
      <i className="f n" />
      <i className="f e" />
      <i className="f w" />
    </div>
  )
})

function MeldRow({ melds, startX }: { melds: Meld[]; startX: number }) {
  let cursor = startX
  return (
    <>
      {melds.map((meld, index) => {
        const begin = cursor
        cursor += meld.tiles.length * TW + 10
        return meld.tiles.map((tile, tileIndex) => {
          // 暗杠：别人的全盖着；亮出来的四张里两头盖着
          const hidden = meld.type === 'ankan' && (meld.kind < 0 || tileIndex === 0 || tileIndex === 3)
          return (
            <Tile3
              key={`${index}-${tileIndex}`}
              kind={hidden ? -1 : kindOf(tile)}
              x={begin + tileIndex * TW + TW / 2}
              y={HAND_Y - 14}
              pose={hidden ? 'down' : 'flat'}
              className="meld"
            />
          )
        })
      })}
    </>
  )
}

export function Table3D({ table, showSpot = true }: { table: MjView; showSpot?: boolean }) {
  const playing = table.phase === 'play' || table.phase === 'claim' || table.phase === 'over'
  const lastTile = table.lastDiscard

  // 牌墙：112 张按 56 墩绕桌一圈。前面摸走的（发牌 + 摸牌）从头减，杠后补牌从尾减。
  const back = table.kongs.length
  const front = 112 - back - table.wallCount
  const stacks: { side: number; index: number; count: number }[] = []
  if (playing && table.phase !== 'over') {
    for (let stack = 0; stack < 56; stack += 1) {
      let count = 0
      for (const slot of [stack * 2, stack * 2 + 1]) if (slot >= front && slot < 112 - back) count += 1
      // 从庄家那一侧开始码牌
      if (count > 0) stacks.push({ side: (table.dealer + Math.floor(stack / STACKS_PER_SIDE)) % 4, index: stack % STACKS_PER_SIDE, count })
    }
  }

  return (
    <div className="mj3-cam">
      <div className="mj3-table">
        <div className="mj3-felt">{showSpot && <i className="mj-spot" />}</div>
        <i className="mj3-skirt s" />
        <i className="mj3-skirt e" />
        <i className="mj3-skirt w" />

        {/* 桌心：余牌、庄家与当前出牌方的指示灯 */}
        {playing && (
          <div className="mj3-console">
            <i className="f top">
              <small>余牌</small>
              <b className={`num ${table.wallCount <= 12 ? 'low' : ''}`}>{table.wallCount}</b>
              {[0, 1, 2, 3].map((seat) => {
                const active = table.phase === 'claim' ? table.claimSeat === seat : table.phase === 'play' && table.turn === seat
                return <span key={seat} className={`lamp lamp-${seat} ${active ? 'on' : ''} ${table.dealer === seat ? 'dealer' : ''}`}>{table.dealer === seat ? '庄' : ''}</span>
              })}
            </i>
            <i className="f s" />
            <i className="f e" />
            <i className="f w" />
          </div>
        )}

        {playing && table.seats.map((seat) => {
          const mine = seat.seat === 0
          const meldWidth = seat.melds.reduce((sum, meld) => sum + meld.tiles.length * TW + 10, 0)
          // 有副露时手牌往左让一让
          const handCount = mine ? 0 : seat.hand ? seat.hand.length : seat.handCount
          const handWidth = handCount * TW
          const handLeft = -(handWidth + (meldWidth ? meldWidth + 14 : 0)) / 2
          const shown = seat.hand ? sortTiles(seat.hand) : null
          return (
            <div key={seat.seat} className="mj3-seat" style={{ transform: `rotateZ(${-90 * seat.seat}deg)` }}>
              {/* 弃牌：6 张一行，从桌心往自己这边排 */}
              {seat.discards.map((tile, index) => {
                const isLast = lastTile?.seat === seat.seat && index === seat.discards.length - 1
                return (
                  <Tile3
                    key={tile}
                    kind={kindOf(tile)}
                    x={((index % 6) - 2.5) * TW}
                    y={RIVER_Y + Math.floor(index / 6) * TH + TH / 2}
                    pose="flat"
                    className={`river ${isLast ? 'last' : ''}`}
                  />
                )
              })}

              {/* 对手的手牌：立在桌边；结束后推倒亮开 */}
              {!mine && Array.from({ length: handCount }, (_, index) => (
                shown
                  ? <Tile3 key={shown[index]} kind={kindOf(shown[index])} x={handLeft + index * TW + TW / 2} y={HAND_Y - 14} pose="flat" className="reveal" />
                  : <Tile3 key={index} kind={-1} x={handLeft + index * TW + TW / 2} y={HAND_Y} pose="stand" />
              ))}
              {!mine && <MeldRow melds={seat.melds} startX={handLeft + handWidth + 14} />}
            </div>
          )
        })}

        {/* 牌墙 */}
        {[0, 1, 2, 3].map((side) => (
          <div key={side} className="mj3-seat" style={{ transform: `rotateZ(${-90 * side}deg)` }}>
            {stacks.filter((stack) => stack.side === side).map((stack) => (
              <Tile3 key={stack.index} kind={-1} x={(stack.index - (STACKS_PER_SIDE - 1) / 2) * TW} y={WALL_Y + TH / 2} pose="down" depth={stack.count * TD} className="wall" />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
