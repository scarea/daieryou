import { create } from 'zustand'

// 3D 牌桌与 HTML HUD 共享的本地交互/演出状态
const useTableUiStore = create((set, get) => ({
  selectedCards: [],
  playingCardIndices: [],
  hoveredCardIndex: null,
  busy: false,
  // 当前需要在牌桌上翻开展示的回合结果（由 GameScene 根据结算流程决定）
  revealResult: null,
  // 结算演出：{ key, timeline, startedAt(performance.now 毫秒) }
  showdown: null,
  // 镜头效果
  shakeUntil: 0,
  introUntil: 0,
  // 倒计时最后几秒：手牌轻颤
  urgent: false,
  // 表情气泡：[{ id, fromId, targetId, emoteId, at }]
  emotes: [],
  // 终局领奖台：[{ playerId, username, totalScore, isBot, seat }]，按名次排序
  podium: null,

  toggleCard: (cardIndex) => {
    const { selectedCards } = get()
    if (selectedCards.includes(cardIndex)) {
      set({ selectedCards: selectedCards.filter((index) => index !== cardIndex) })
      return false
    }
    if (selectedCards.length < 2) {
      set({ selectedCards: [...selectedCards, cardIndex] })
      return true
    }
    set({ selectedCards: [selectedCards[0], cardIndex] })
    return true
  },
  clearSelection: () => set({ selectedCards: [] }),
  setPlayingCardIndices: (playingCardIndices) => set({ playingCardIndices }),
  setHoveredCardIndex: (hoveredCardIndex) => set({ hoveredCardIndex }),
  setBusy: (busy) => set({ busy }),
  setRevealResult: (revealResult) => set({ revealResult }),
  startShowdown: (showdown) => set({ showdown }),
  // 跳过：把开始时间往前拨到演出结尾
  skipShowdown: () => {
    const { showdown } = get()
    if (!showdown) {
      return
    }
    set({ showdown: { ...showdown, startedAt: performance.now() - showdown.timeline.endAt, skipped: true } })
  },
  clearShowdown: () => set({ showdown: null }),
  shake: (durationMs = 260) => set({ shakeUntil: performance.now() + durationMs }),
  playIntro: (durationMs = 1100) => set({ introUntil: performance.now() + durationMs }),
  setUrgent: (urgent) => {
    if (get().urgent !== urgent) {
      set({ urgent })
    }
  },
  setPodium: (podium) => set({ podium }),
  pruneEmotes: () => {
    const now = performance.now()
    const emotes = get().emotes.filter((item) => now - item.at < 3200)
    if (emotes.length !== get().emotes.length) {
      set({ emotes })
    }
  },
  pushEmote: (emote) => {
    const now = performance.now()
    set({
      emotes: [...get().emotes.filter((item) => now - item.at < 3200), { ...emote, at: now, id: `${emote.fromId}-${now}` }],
    })
  },
  reset: () => set({
    selectedCards: [],
    playingCardIndices: [],
    hoveredCardIndex: null,
    busy: false,
    revealResult: null,
    showdown: null,
    urgent: false,
    emotes: [],
    podium: null,
  }),
}))

// 演出已进行的毫秒数
export function getShowdownElapsed(showdown) {
  if (!showdown) {
    return Infinity
  }
  return performance.now() - showdown.startedAt
}

export default useTableUiStore
