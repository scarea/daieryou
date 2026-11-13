// 红中麻将真人联机端到端测试：两名真人约局 + 机器人补位，对着运行中的服务器打完一局。
// 用法：node --import tsx tests/mjRoomE2e.manual.ts [http://localhost:8787]
import WebSocket from 'ws'
import type { MjView } from '../src/shared/mahjong/view.ts'
import type { ServerEvent, UserProfile } from '../src/shared/protocol.ts'

const base = process.argv[2] || 'http://localhost:8787'
const assert = (cond: unknown, message: string) => { if (!cond) { console.error('✗', message); process.exit(1) } else console.log('✓', message) }
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

class Player {
  ws!: WebSocket
  table: MjView | null = null
  lobby: any = null
  seq = 0
  waiters = new Map<number, (event: any) => void>()
  token = ''
  user!: UserProfile
  async init() {
    const data = await (await fetch(`${base}/api/auth/guest`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json() as any
    if (!data.token) { console.error('✗ 游客登录失败', data.error); process.exit(1) }
    this.token = data.token
    this.user = data.user
    this.ws = new WebSocket(base.replace('http', 'ws') + '/ws')
    this.ws.on('message', (raw) => {
      const event = JSON.parse(raw.toString()) as ServerEvent
      if (event.ev === 'res') this.waiters.get(event.id)?.(event)
      if (event.ev === 'mj') this.table = event.table
      if (event.ev === 'lobby') this.lobby = event.lobby
    })
    await new Promise<void>((resolve) => this.ws.on('open', () => resolve()))
    return this.send({ op: 'auth', token: this.token })
  }
  send(op: Record<string, unknown>) {
    this.seq += 1
    const id = this.seq
    return new Promise<any>((resolve) => { this.waiters.set(id, resolve); this.ws.send(JSON.stringify({ ...op, id })) })
  }
  async step() {
    const view = this.table
    if (!view || view.phase === 'waiting' || view.phase === 'dice' || view.phase === 'over') return false
    const actor = view.phase === 'claim' ? view.claimSeat : view.turn
    if (actor !== 0) return false
    const c = view.choices
    const action = view.phase === 'claim' ? (c.kong ? { type: 'kong' } : { type: 'pass' })
      : c.hu ? { type: 'hu' } : { type: 'discard', tile: view.drawn ?? c.discards[0] }
    const before = view.seq
    await this.send({ op: 'mj:act', action })
    for (let i = 0; i < 100 && this.table && this.table.seq === before; i += 1) await sleep(20)
    return true
  }
}

const [a, b] = [new Player(), new Player()]
assert((await a.init()).ok && (await b.init()).ok, '两名玩家登录')
assert((await a.send({ op: 'mj:create', hallId: 'qingyun', isPrivate: false, level: 'hard', options: { sevenPairs: true, fourZhong: true, zhongDiscard: true } })).ok, 'A 开一桌')
const roomId = a.table!.roomId
assert(/^9\d{5}$/.test(roomId) && a.table!.phase === 'waiting', `等人入座，房号 ${roomId}`)
await sleep(400)
assert(b.lobby?.rooms?.some((room: any) => room.id === roomId && room.game === 'mahjong'), 'B 在大厅列表里看到这桌麻将')
assert((await b.send({ op: 'join', roomId })).ok, 'B 用房号加入（统一的加入入口）')
await sleep(300)
assert(a.table!.seats.filter((seat) => !seat.empty).length === 2 && b.table!.hostSeat !== 0, '两人入座，B 看到 A 是房主')
assert(!(await b.send({ op: 'mj:begin' })).ok, '非房主不能开始')
assert((await a.send({ op: 'mj:begin' })).ok, '房主开始，空位由机器人补齐')
await sleep(400)
assert(b.table!.seats.filter((seat) => seat.isBot).length === 2, '补了两个机器人')

const started = Date.now()
while (!(a.table?.phase === 'over' && b.table?.phase === 'over')) {
  const moved = (await a.step()) || (await b.step())
  if (!moved) await sleep(60)
  if (Date.now() - started > 300000) { console.error('✗ 超时'); process.exit(1) }
}
const [va, vb] = [a.table!, b.table!]
assert(va.seats[0].userId === a.user.id && vb.seats[0].userId === b.user.id, '各自的视角里自己都在 0 号位')
assert(va.seats.reduce((sum, seat) => sum + seat.score, 0) === 0, `四家分数零和（用时 ${Math.round((Date.now() - started) / 1000)} 秒）`)
const scoreOfBInA = va.seats.find((seat) => seat.userId === b.user.id)!.score
assert(scoreOfBInA === vb.seats[0].score, '两人看到的分数一致')
const winnerA = va.result!.winner >= 0 ? va.seats[va.result!.winner].name : '流局'
const winnerB = vb.result!.winner >= 0 ? vb.seats[vb.result!.winner].name : '流局'
assert(winnerA === winnerB, `两人看到的结果一致：${winnerA}`)
for (const [player, view] of [[a, va], [b, vb]] as const) {
  const me = await (await fetch(`${base}/api/me`, { headers: { Authorization: `Bearer ${player.token}` } })).json() as { user: UserProfile }
  assert(me.user.coins === player.user.coins + view.seats[0].score * 10 && view.settlement?.coinsDelta === view.seats[0].score * 10, `金币各自入账（${view.settlement?.coinsDelta}）`)
}
await a.send({ op: 'mj:next' })
await sleep(300)
assert(b.table!.phase === 'over' && b.table!.seats.find((seat) => seat.userId === a.user.id)!.ready, 'A 点了下一局，B 看到 A 已准备')
await b.send({ op: 'mj:next' })
await sleep(300)
assert(a.table!.handNo === 2 && a.table!.phase !== 'over', '两人都准备后开第二局')
await b.send({ op: 'mj:leave' })
await sleep(300)
assert(b.table === null && a.table !== null && a.table.seats.every((seat) => seat.userId !== b.user.id || seat.trustee), 'B 离开后 A 还能继续，B 的座位由机器人代打')
await a.send({ op: 'mj:leave' })
console.log('\n红中麻将真人联机端到端测试全部通过')
process.exit(0)
