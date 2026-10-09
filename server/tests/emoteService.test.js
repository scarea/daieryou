const test = require('node:test')
const assert = require('node:assert/strict')
const { EmoteService } = require('../src/application/emoteService')

function createFixture() {
  const room = {
    id: 'room-emote',
    players: [{ id: 'u1' }, { id: 'u2' }, { id: 'u3' }],
  }
  const broadcasts = []
  let now = 10_000
  const service = new EmoteService({
    roomRepository: { get: (roomId) => (roomId === room.id ? room : null) },
    broadcaster: { broadcast: (target, event, payload) => broadcasts.push({ target, event, payload }) },
    cooldownMs: 1000,
    now: () => now,
  })
  return { service, broadcasts, advance: (ms) => { now += ms } }
}

test('sendEmote should broadcast whitelisted emote to the room', () => {
  const { service, broadcasts } = createFixture()
  const payload = service.sendEmote({ id: 'u1' }, { roomId: 'room-emote', emoteId: 'gotcha', targetId: 'u2' })

  assert.equal(payload.targetId, 'u2')
  assert.equal(broadcasts.length, 1)
  assert.equal(broadcasts[0].event, 'emote')
  assert.equal(broadcasts[0].payload.fromId, 'u1')
})

test('sendEmote should reject unknown emotes, outsiders and spam', () => {
  const { service, broadcasts, advance } = createFixture()

  assert.throws(() => service.sendEmote({ id: 'u1' }, { roomId: 'room-emote', emoteId: '<script>' }), /表情不存在/)
  assert.throws(() => service.sendEmote({ id: 'stranger' }, { roomId: 'room-emote', emoteId: 'clap' }), /不在该房间中/)

  service.sendEmote({ id: 'u1' }, { roomId: 'room-emote', emoteId: 'clap', targetId: 'not-in-room' })
  assert.equal(broadcasts[0].payload.targetId, null)
  assert.throws(() => service.sendEmote({ id: 'u1' }, { roomId: 'room-emote', emoteId: 'clap' }), /发送太频繁了/)

  advance(1001)
  service.sendEmote({ id: 'u1' }, { roomId: 'room-emote', emoteId: 'fire' })
  assert.equal(broadcasts.length, 2)
})
