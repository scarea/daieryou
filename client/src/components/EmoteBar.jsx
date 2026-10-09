import React, { useState } from 'react'
import { Button, Popover } from 'antd'
import { SmileOutlined } from '@ant-design/icons'
import { EMOTES } from './emotes'
import { gameService } from '../services/gameService'
import soundEngine from '../audio/soundEngine'

const COOLDOWN_MS = 1300

// 快捷表情：可以对某位对手“喊话”，互相嘴两句是逮二游心理战的一部分
const EmoteBar = ({ roomId, opponents = [] }) => {
  const [open, setOpen] = useState(false)
  const [targetId, setTargetId] = useState(null)
  const [coolingDown, setCoolingDown] = useState(false)

  const send = async (emoteId) => {
    if (coolingDown || !roomId) {
      return
    }
    setCoolingDown(true)
    setOpen(false)
    window.setTimeout(() => setCoolingDown(false), COOLDOWN_MS)
    try {
      await gameService.sendEmote(roomId, emoteId, targetId)
    } catch (error) {
      // 限流或断线时静默失败，表情不是关键操作
    }
  }

  const content = (
    <div className="emote-picker">
      {opponents.length > 0 && (
        <div className="emote-targets" role="radiogroup" aria-label="对谁说">
          <button type="button" className={!targetId ? 'is-active' : ''} onClick={() => setTargetId(null)}>所有人</button>
          {opponents.map((player) => (
            <button
              key={player.id}
              type="button"
              className={targetId === player.id ? 'is-active' : ''}
              onClick={() => setTargetId(player.id)}
            >
              {player.username}
            </button>
          ))}
        </div>
      )}
      <div className="emote-grid">
        {EMOTES.map((emote) => (
          <button
            key={emote.id}
            type="button"
            className="emote-option"
            onClick={() => send(emote.id)}
            onPointerEnter={() => soundEngine.cardHover()}
          >
            <span>{emote.icon}</span>
            <small>{emote.text}</small>
          </button>
        ))}
      </div>
    </div>
  )

  return (
    <Popover content={content} trigger="click" open={open} onOpenChange={setOpen} placement="topLeft">
      <Button
        className="hud-round-button"
        shape="circle"
        size="large"
        icon={<SmileOutlined />}
        disabled={coolingDown}
        aria-label="发送表情"
      />
    </Popover>
  )
}

export default EmoteBar
