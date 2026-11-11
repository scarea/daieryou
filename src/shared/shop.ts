// 商城：用金币购买的外观（头像框、牌背、桌布）。纯装饰，不影响对局。
export type ShopKind = 'frame' | 'cardback' | 'felt'

export interface ShopItem {
  id: string
  kind: ShopKind
  name: string
  desc: string
  price: number
}

export const SHOP_KIND_NAME: Record<ShopKind, string> = { frame: '头像框', cardback: '牌背', felt: '桌布' }

export const SHOP_ITEMS: ShopItem[] = [
  { id: 'frame-jade', kind: 'frame', name: '翡翠框', desc: '温润碧玉，君子之风', price: 3000 },
  { id: 'frame-flame', kind: 'frame', name: '赤焰框', desc: '烈焰环身，气势如虹', price: 8000 },
  { id: 'frame-dragon', kind: 'frame', name: '盘龙框', desc: '金龙盘绕，贵不可言', price: 30000 },
  { id: 'frame-crown', kind: 'frame', name: '帝王框', desc: '九五之尊，唯我独尊', price: 100000 },
  { id: 'back-jade', kind: 'cardback', name: '青玉牌背', desc: '青玉为底，金线勾边', price: 2000 },
  { id: 'back-ink', kind: 'cardback', name: '水墨牌背', desc: '墨色氤氲，素雅留白', price: 5000 },
  { id: 'back-royal', kind: 'cardback', name: '紫金牌背', desc: '紫气东来，金玉满堂', price: 20000 },
  { id: 'felt-crimson', kind: 'felt', name: '朱砂桌布', desc: '一桌朱红，鸿运当头', price: 4000 },
  { id: 'felt-navy', kind: 'felt', name: '靛青桌布', desc: '沉静如海，运筹帷幄', price: 4000 },
  { id: 'felt-purple', kind: 'felt', name: '紫檀桌布', desc: '紫檀生香，雍容华贵', price: 15000 },
]

export function shopItem(id: string): ShopItem | undefined {
  return SHOP_ITEMS.find((item) => item.id === id)
}
