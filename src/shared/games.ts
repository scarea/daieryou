// 平台上的游戏注册表：大厅入口、牌桌列表、服务端路由都以此为准。
// 新增一个游戏：在这里登记，再分别实现规则引擎（shared）、牌桌服务（server）和牌桌场景（client）。

export type GameId = 'd2y' | 'mahjong'

export interface GameInfo {
  id: GameId
  name: string
  /** 大厅卡片上的一句话 */
  tagline: string
  /** 一桌几个人 */
  seats: number
  /** 一个字的图标 */
  glyph: string
}

export const PLATFORM_NAME = '金殿棋牌'
export const PLATFORM_TAGLINE = '约上好友 · 随时开一桌'

export const GAMES: GameInfo[] = [
  { id: 'mahjong', name: '红中麻将', tagline: '四人 · 只能自摸 · 杀鬼翻倍', seats: 4, glyph: '中' },
  { id: 'd2y', name: '逮二游', tagline: '三人 · 第二名才是输家', seats: 3, glyph: '逮' },
]

export function gameById(id: string): GameInfo | undefined {
  return GAMES.find((game) => game.id === id)
}
