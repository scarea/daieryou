// 端到端联机测试：对着运行中的服务器，两名真人 + 一个机器人打完整局。
// 用法：node --import tsx tests/e2e.manual.ts [http://localhost:8787]
import WebSocket from 'ws'
import type { RoomView, ServerEvent, UserProfile } from '../src/shared/protocol.ts'

const base = process.argv[2] || 'http://localhost:8787'
const assert = (cond: unknown, message: string) => { if (!cond) { console.error('✗', message); process.exit(1) } else console.log('✓', message) }

async function guest(): Promise<{ token: string; user: UserProfile }> {
  const response = await fetch(`${base}/api/auth/guest`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
  return response.json() as Promise<{ token: string; user: UserProfile }>
}

class Client {
  ws: WebSocket
  room: RoomView | null = null
  seq = 0
  waiters = new Map<number, (event: Extract<ServerEvent, { ev: 'res' }>) => void>()
  seenHands = new Set<string>()
  constructor(readonly token: string, readonly name: string) {
    this.ws = new WebSocket(base.replace('http', 'ws') + '/ws')
    this.ws.on('message', (raw) => {
      const event = JSON.parse(raw.toString()) as ServerEvent
      if (event.ev === 'res') this.waiters.get(event.id)?.(event)
      if (event.ev === 'room') {
        this.room = event.room
        event.room?.game?.hand.forEach((card) => this.seenHands.add(card.id))
        this.autoPlay()
      }
    })
  }
  open() { return new Promise<void>((resolve) => this.ws.on('open', () => resolve())) }
  send(op: Record<string, unknown>) {
    this.seq += 1
    const id = this.seq
    return new Promise<Extract<ServerEvent, { ev: 'res' }>>((resolve) => {
      this.waiters.set(id, resolve)
      this.ws.send(JSON.stringify({ ...op, id }))
    })
  }
  autoPlay() {
    const game = this.room?.game
    if (!game || this.room?.status !== 'playing' || game.phase !== 'selecting' || game.round >= 5 || game.picked) return
    setTimeout(() => void this.send({ op: 'play', round: game.round, cardIds: [game.hand[0].id, game.hand[1].id] }), 300)
  }
}

const [a, b] = await Promise.all([guest(), guest()])
const A = new Client(a.token, 'A')
const B = new Client(b.token, 'B')
await Promise.all([A.open(), B.open()])
assert((await A.send({ op: 'auth', token: a.token })).ok, 'A 登录')
assert((await B.send({ op: 'auth', token: b.token })).ok, 'B 登录')
assert(!(await B.send({ op: 'play', round: 1, cardIds: ['S1', 'S2'] })).ok, '不在对局中不能出牌')
assert((await A.send({ op: 'create', hallId: 'qingyun', isPrivate: false })).ok, 'A 创建牌桌')
const roomId = A.room!.id
assert((await B.send({ op: 'join', roomId })).ok, `B 加入房间 ${roomId}`)
assert(!(await B.send({ op: 'start' })).ok, '非房主不能开始')
assert(!(await A.send({ op: 'start' })).ok, '不足 3 人不能开始')
assert((await A.send({ op: 'addBot', level: 'hard' })).ok, 'A 添加机器人')
assert((await A.send({ op: 'start' })).ok, 'A 开始游戏')
assert(!(await A.send({ op: 'play', round: 1, cardIds: ['XX', 'YY'] })).ok, '不能出不在手里的牌')

await new Promise<void>((resolve) => {
  const timer = setInterval(() => {
    if (A.room?.status === 'finished' && B.room?.status === 'finished') { clearInterval(timer); resolve() }
  }, 200)
})
const final = A.room!
assert(final.game!.results.length === 5, '打满 5 轮')
assert(final.settlement!.length === 3, '结算包含三家')
assert(final.settlement!.reduce((sum, entry) => sum + entry.total, 0) === 0, '总分零和')
assert(final.settlement!.every((entry) => entry.coinsDelta === entry.total * 10 || final.seats[entry.seat]?.isBot), '金币 = 总分 × 底注')
// 自己整局见过的手牌 = 5 + 2×3 = 11 张，且从未收到别人的手牌
assert(A.seenHands.size === 11 && B.seenHands.size === 11, '每人整局只见过自己的 11 张手牌')
assert([...A.seenHands].every((id) => !B.seenHands.has(id)), '双方手牌互不泄露')
for (const result of final.game!.results) {
  const sorted = [...result.entries].sort((x, y) => y.evaluation.key - x.evaluation.key)
  const distinct = new Set(sorted.map((entry) => entry.evaluation.key)).size
  if (distinct === 3) assert(result.losers.length === 1 && result.losers[0] === sorted[1].seat, `第 ${result.round} 轮：第二名被逮（${sorted.map((e) => e.delta).join(' / ')}）`)
}
const me = await (await fetch(`${base}/api/me`, { headers: { Authorization: `Bearer ${a.token}` } })).json() as { user: UserProfile }
const mine = final.settlement!.find((entry) => entry.seat === final.mySeat)!
assert(me.user.coins === a.user.coins + mine.coinsDelta && me.user.games === 1, `A 的金币已入账（金币 ${me.user.coins}，本局 ${mine.coinsDelta}，局数 ${me.user.games}）`)
assert((await A.send({ op: 'again' })).ok && (await B.send({ op: 'again' })).ok, '双方再来一局')
await new Promise((resolve) => setTimeout(resolve, 300))
assert(A.room?.status === 'playing' && A.room.game?.round === 1, '全员准备后自动开新局')
await A.send({ op: 'leave' })
await B.send({ op: 'leave' })
console.log('\n端到端联机测试全部通过')
process.exit(0)
