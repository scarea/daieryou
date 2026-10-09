// 牌桌坐标系：桌面在 y=0，+z 指向自己（镜头）方向，+x 向右
export const TABLE_RADIUS_X = 3.3
export const TABLE_RADIUS_Z = 2.2
export const TABLE_SURFACE_Y = 0
export const FLOOR_Y = -1.55
export const CARD_REST_Y = TABLE_SURFACE_Y + 0.012

export const SEAT_ORDER = ['bottom', 'left', 'right']

export const SEATS = {
  bottom: {
    avatar: [0, FLOOR_Y, 3.25],
    facing: Math.PI,
    hand: [0, CARD_REST_Y, 1.75],
    play: [0, CARD_REST_Y, 1.05],
    label: [0, 0.9, 2.6],
    color: '#d9a441',
  },
  left: {
    avatar: [-3.85, FLOOR_Y, -0.35],
    facing: Math.PI / 2,
    hand: [-2.55, CARD_REST_Y, -0.35],
    play: [-1.7, CARD_REST_Y, 0.5],
    label: [-4.15, 1.75, -0.35],
    color: '#38bdf8',
  },
  right: {
    avatar: [3.85, FLOOR_Y, -0.35],
    facing: -Math.PI / 2,
    hand: [2.55, CARD_REST_Y, -0.35],
    play: [1.7, CARD_REST_Y, 0.5],
    label: [4.15, 1.75, -0.35],
    color: '#f472b6',
  },
}

export const DECK_POSITION = [0, CARD_REST_Y, -1.72]
export const DISCARD_POSITION = [2.1, CARD_REST_Y, -1.3]
export const PUBLIC_ROW_Z = -0.62
export const PUBLIC_CARD_SPACING = 0.86

export const FACE_UP = [-Math.PI / 2, 0, 0]
export const FACE_DOWN = [Math.PI / 2, 0, 0]

export function publicCardPosition(index, total = 4) {
  const offset = (index - (total - 1) / 2) * PUBLIC_CARD_SPACING
  return [offset, CARD_REST_Y, PUBLIC_ROW_Z]
}

export function deckLayerPosition(layer) {
  return [DECK_POSITION[0], DECK_POSITION[1] + layer * 0.014, DECK_POSITION[2]]
}

// 自己的手牌：竖起来朝向镜头，呈扇形展开
export function selfHandTransform(index, total, { lifted = false, hovered = false } = {}) {
  const spread = Math.min(0.62, 3.1 / Math.max(total, 1))
  const center = (total - 1) / 2
  const offset = index - center
  const lift = lifted ? 0.32 : hovered ? 0.1 : 0
  return {
    position: [
      offset * spread,
      0.42 + lift - Math.abs(offset) * 0.03,
      2.3 - Math.abs(offset) * 0.04 - (lifted ? 0.12 : 0),
    ],
    rotation: [-0.82, 0, -offset * 0.06],
  }
}

// 对手手牌：扣在桌上，沿座位方向排成一列扇形
export function opponentHandTransform(seat, index, total) {
  const base = SEATS[seat].hand
  const direction = seat === 'left' ? 1 : -1
  const center = (total - 1) / 2
  const offset = index - center
  return {
    position: [base[0], base[1] + index * 0.004, base[2] + offset * 0.3],
    rotation: [Math.PI / 2, 0, direction * (Math.PI / 2 + offset * 0.05)],
  }
}

export function playSpotTransform(seat, index, total, { faceUp = false } = {}) {
  const base = SEATS[seat].play
  const center = (total - 1) / 2
  const offset = index - center
  const yaw = seat === 'left' ? -0.35 : seat === 'right' ? 0.35 : 0
  const along = offset * 0.58
  return {
    position: [
      base[0] + along * Math.cos(yaw),
      base[1] + index * 0.004,
      base[2] - along * Math.sin(yaw),
    ],
    rotation: faceUp ? [-Math.PI / 2, 0, yaw] : [Math.PI / 2, 0, -yaw],
  }
}

export function buildSeatAssignments(players = [], selfPlayerId = '') {
  if (!Array.isArray(players) || players.length === 0) {
    return []
  }

  const selfIndex = players.findIndex((player) => player.id === selfPlayerId)
  const orderedPlayers = selfIndex >= 0
    ? [players[selfIndex], ...players.slice(selfIndex + 1), ...players.slice(0, selfIndex)]
    : [...players]

  return orderedPlayers.slice(0, SEAT_ORDER.length).map((player, index) => ({
    player,
    seat: SEAT_ORDER[index],
  }))
}

// 每个座位面前的筹码堆位置（筹码飞行动画的起点/终点）
export function chipStackPosition(seat) {
  if (seat === 'bottom') {
    return [1.75, 0, 1.3]
  }
  const config = SEATS[seat]
  return [config.hand[0] * 0.9, 0, config.hand[2] + 1.25]
}
