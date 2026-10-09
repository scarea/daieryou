import React, { useState } from 'react'
import { Button } from 'antd'
import soundEngine from '../audio/soundEngine'

const STORAGE_KEY = 'daieryou_coach_done_v1'

const TIPS = [
  { title: '只有第二名输', body: '每轮比牌，第二名（二游）要向另外两家付分。打得最小、排第三也算赢。' },
  { title: '两张手牌 + 本轮公牌', body: '点选或向上拖动 2 张手牌，和桌上发光的公牌组成三张。大小王是赖子，会自动变成最大牌型。' },
  { title: '留好最后三张', body: '第 4 轮公牌是暗牌，第 5 轮直接用剩下的 3 张手牌比大小，分值最高。前面出什么、留什么都很关键。' },
]

function isDone() {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1'
  } catch (error) {
    return true
  }
}

// 新手引导：第一次进入对局时依次弹出三条提示，不阻塞操作
const CoachMarks = () => {
  const [step, setStep] = useState(() => (isDone() ? -1 : 0))

  if (step < 0 || step >= TIPS.length) {
    return null
  }

  const finish = () => {
    try {
      window.localStorage.setItem(STORAGE_KEY, '1')
    } catch (error) {
      // 无法持久化时下次仍会显示
    }
    setStep(-1)
  }

  const next = () => {
    soundEngine.uiClick()
    if (step + 1 >= TIPS.length) {
      finish()
      return
    }
    setStep(step + 1)
  }

  const tip = TIPS[step]
  return (
    <aside className="coach-mark" role="dialog" aria-label="新手提示">
      <span className="coach-mark-step">{step + 1}/{TIPS.length}</span>
      <strong>{tip.title}</strong>
      <p>{tip.body}</p>
      <div className="coach-mark-actions">
        <Button size="small" type="text" onClick={finish}>跳过</Button>
        <Button size="small" type="primary" className="hud-cta" onClick={next}>
          {step + 1 >= TIPS.length ? '开始吧' : '下一条'}
        </Button>
      </div>
    </aside>
  )
}

export default CoachMarks
