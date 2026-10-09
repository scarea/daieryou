import soundEngine, { seatPan } from './soundEngine'
import useTableUiStore from '../three/tableUiStore'
import { tapFeedback } from '../settings/settingsStore'

/**
 * 按结算时间轴调度音效（与 3D 动画共用同一份 timeline，声画同步）。
 * 返回取消函数；跳过演出时由调用方取消，再调用 playSkippedShowdown 补一个收尾。
 */
export function scheduleShowdownSounds(showdown, { seatByPlayerId, selfId }) {
  const { timeline, startedAt } = showdown
  const timers = []
  const at = (ms, fn) => {
    const wait = startedAt + ms - performance.now()
    if (wait < -50) {
      return
    }
    timers.push(window.setTimeout(fn, Math.max(0, wait)))
  }
  const panOf = (playerId) => seatPan(seatByPlayerId.get(playerId))

  if (timeline.isFinal) {
    at(0, () => soundEngine.drumroll({ duration: Math.max(0.6, timeline.players[0].flips[0] / 1000 - 0.1) }))
  } else {
    at(0, () => soundEngine.whoosh({ duration: 0.5 }))
  }

  timeline.players.forEach((player) => {
    player.flips.forEach((flipAt) => {
      at(flipAt, () => soundEngine.cardFlip({ pan: panOf(player.playerId) }))
    })
  })

  timeline.bigHands.forEach((bigHand) => {
    at(bigHand.at, () => soundEngine.sparkle({ pan: panOf(bigHand.playerId) }))
  })

  if (timeline.stampAt !== null) {
    const loser = timeline.players.find((player) => player.isLoser)
    at(timeline.stampAt, () => {
      soundEngine.stamp({ pan: panOf(loser?.playerId) })
      useTableUiStore.getState().shake(280)
      if (loser?.playerId === selfId) {
        tapFeedback([30, 40, 30])
      }
    })
  }

  timeline.transfers.forEach((transfer, index) => {
    const count = Math.min(12, Math.max(2, transfer.amount * 2))
    at(timeline.chipsAt + index * 180 + 380, () => soundEngine.chipCascade({
      count,
      fromPan: panOf(transfer.fromId),
      toPan: panOf(transfer.toId),
    }))
  })

  const self = timeline.players.find((player) => player.playerId === selfId)
  if (self) {
    at(timeline.outcomeAt, () => {
      if (self.isLoser) {
        soundEngine.loseTone()
      } else if (self.scoreDelta > 0 || timeline.isFinal) {
        soundEngine.winChime()
        tapFeedback(12)
      }
    })
  }

  return () => timers.forEach((timer) => window.clearTimeout(timer))
}

export function playSkippedShowdown(showdown, { selfId }) {
  const self = showdown.timeline.players.find((player) => player.playerId === selfId)
  soundEngine.chipCascade({ count: 4, spacing: 0.05 })
  if (self?.isLoser) {
    soundEngine.loseTone({ at: 0.15 })
  } else if (self && self.scoreDelta > 0) {
    soundEngine.winChime({ at: 0.15 })
  }
}
