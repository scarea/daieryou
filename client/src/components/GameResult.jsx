import React, { useMemo } from 'react'
import { Button } from 'antd'
import { DownloadOutlined, LogoutOutlined, RedoOutlined } from '@ant-design/icons'
import { getCardName, getHandTypeName } from '../utils/cardUtils'
import AnimatedNumber from './AnimatedNumber'

const HAND_TYPE_WEIGHTS = { leopard: 6, straight_flush: 5, flush: 4, straight: 3, pair: 2, high_card: 1 }
const PLACE_LABELS = ['冠军', '亚军', '季军']

function getLoserIndexes(result) {
  return result.loserIndexes || (result.loserIndex >= 0 ? [result.loserIndex] : [])
}

// 从各轮结果里提炼本局高光
export function buildHighlights(roundResults = [], currentPlayerId = '') {
  let tableBest = null
  let selfBest = null
  let selfCaught = 0
  let selfBiggestGain = 0
  let selfBiggestLoss = 0

  roundResults.forEach((result) => {
    const loserIndexes = getLoserIndexes(result)
    ;(result.playerResults || []).forEach((playerResult) => {
      const weight = HAND_TYPE_WEIGHTS[playerResult.evaluation?.type] || 0
      const entry = { ...playerResult, round: result.round, weight }
      if (!tableBest || weight > tableBest.weight) {
        tableBest = entry
      }
      if (playerResult.playerId === currentPlayerId) {
        if (!selfBest || weight > selfBest.weight) {
          selfBest = entry
        }
        if (loserIndexes.includes(playerResult.playerIndex)) {
          selfCaught += 1
        }
        selfBiggestGain = Math.max(selfBiggestGain, Number(playerResult.scoreDelta || 0))
        selfBiggestLoss = Math.min(selfBiggestLoss, Number(playerResult.scoreDelta || 0))
      }
    })
  })

  const highlights = []
  if (tableBest) {
    highlights.push({
      key: 'table-best',
      label: '全场最大牌',
      value: `${tableBest.playerName} · 第${tableBest.round}轮 ${getHandTypeName(tableBest.evaluation?.type)}`,
      detail: (tableBest.hand || []).map(getCardName).join(' '),
    })
  }
  if (selfBest) {
    highlights.push({
      key: 'self-best',
      label: '你的最佳一手',
      value: `第${selfBest.round}轮 ${getHandTypeName(selfBest.evaluation?.type)}`,
      detail: (selfBest.hand || []).map(getCardName).join(' '),
    })
    highlights.push({
      key: 'caught',
      label: '被逮次数',
      value: selfCaught === 0 ? '一次都没被逮' : `${selfCaught} 次`,
    })
    if (selfBiggestGain > 0) {
      highlights.push({ key: 'gain', label: '单轮最大进账', value: `+${selfBiggestGain}` })
    }
    if (selfBiggestLoss < 0) {
      highlights.push({ key: 'loss', label: '单轮最痛', value: `${selfBiggestLoss}` })
    }
  }
  return highlights
}

// 生成一张战绩图（纯 canvas 绘制），由玩家点击按钮后下载
function downloadResultImage({ sortedScores, highlights, currentPlayerId }) {
  const width = 1080
  const height = 1350
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  const font = "'Space Grotesk', 'Noto Sans SC', 'PingFang SC', sans-serif"

  const background = ctx.createRadialGradient(width / 2, height * 0.35, 80, width / 2, height / 2, height)
  background.addColorStop(0, '#14513f')
  background.addColorStop(0.55, '#0b0a10')
  background.addColorStop(1, '#050407')
  ctx.fillStyle = background
  ctx.fillRect(0, 0, width, height)
  ctx.strokeStyle = 'rgba(217, 164, 65, 0.6)'
  ctx.lineWidth = 4
  ctx.strokeRect(36, 36, width - 72, height - 72)

  ctx.textAlign = 'center'
  ctx.fillStyle = '#d9a441'
  ctx.font = `700 30px ${font}`
  ctx.fillText('THREE PLAYER · WILD JOKERS', width / 2, 130)
  ctx.fillStyle = '#f5d48a'
  ctx.font = `800 120px ${font}`
  ctx.fillText('逮二游', width / 2, 260)
  ctx.fillStyle = '#f6efe0'
  ctx.font = `500 34px ${font}`
  ctx.fillText(new Date().toLocaleString(), width / 2, 320)

  sortedScores.forEach((score, index) => {
    const y = 430 + index * 130
    const isSelf = score.playerId === currentPlayerId
    ctx.fillStyle = isSelf ? 'rgba(217, 164, 65, 0.18)' : 'rgba(255, 255, 255, 0.05)'
    ctx.fillRect(110, y - 70, width - 220, 110)
    ctx.textAlign = 'left'
    ctx.fillStyle = index === 0 ? '#facc15' : '#c9bfa8'
    ctx.font = `800 52px ${font}`
    ctx.fillText(PLACE_LABELS[index] || `第${index + 1}`, 150, y)
    ctx.fillStyle = '#f6efe0'
    ctx.font = `600 46px ${font}`
    ctx.fillText(`${score.username}${isSelf ? '（我）' : ''}`, 360, y)
    ctx.textAlign = 'right'
    ctx.fillStyle = score.totalScore >= 0 ? '#4ade80' : '#f87171'
    ctx.font = `800 56px ${font}`
    ctx.fillText(`${score.totalScore > 0 ? '+' : ''}${score.totalScore}`, width - 150, y)
  })

  ctx.textAlign = 'left'
  highlights.slice(0, 4).forEach((item, index) => {
    const y = 900 + index * 92
    ctx.fillStyle = '#d9a441'
    ctx.font = `600 30px ${font}`
    ctx.fillText(item.label, 150, y)
    ctx.fillStyle = '#f6efe0'
    ctx.font = `600 38px ${font}`
    ctx.fillText(item.value, 420, y)
  })

  const link = document.createElement('a')
  link.download = `逮二游战绩-${Date.now()}.png`
  link.href = canvas.toDataURL('image/png')
  link.click()
}

const GameResult = ({
  finalScores,
  roundResults = [],
  currentPlayerId = '',
  readyIds = [],
  onBackToRoom,
  onPlayAgain,
  playAgainDisabled = false,
  playAgainText = '再来一局',
}) => {
  const sortedScores = useMemo(
    () => [...finalScores].sort((left, right) => right.totalScore - left.totalScore),
    [finalScores],
  )
  const highlights = useMemo(() => buildHighlights(roundResults, currentPlayerId), [roundResults, currentPlayerId])
  const selfPlace = sortedScores.findIndex((score) => score.playerId === currentPlayerId)

  return (
    <section className="game-result-panel hud-panel" aria-label="对局结算">
      <header className="game-result-head">
        <span className="hud-kicker">FINAL</span>
        <h2>游戏结束</h2>
        {selfPlace >= 0 && (
          <p className={selfPlace === 0 ? 'is-champion' : ''}>
            {selfPlace === 0 ? '恭喜夺冠！' : `你获得了${PLACE_LABELS[selfPlace] || `第${selfPlace + 1}名`}`}
          </p>
        )}
      </header>

      <ol className="game-result-ranking">
        {sortedScores.map((score, index) => (
          <li key={score.playerId} className={`place-${index + 1} ${score.playerId === currentPlayerId ? 'is-self' : ''}`}>
            <span className="game-result-place">{index + 1}</span>
            <span className="game-result-name">
              {score.username}
              {readyIds.includes(score.playerId) && <span className="game-result-ready">已准备</span>}
            </span>
            <span className="game-result-rounds" aria-label="各轮积分">
              {(score.roundScores || []).map((delta, roundIndex) => (
                <i key={roundIndex} className={delta > 0 ? 'gain' : delta < 0 ? 'loss' : ''} title={`第${roundIndex + 1}轮 ${delta > 0 ? '+' : ''}${delta}`} />
              ))}
            </span>
            <AnimatedNumber value={score.totalScore} signed className={score.totalScore >= 0 ? 'gain' : 'loss'} />
          </li>
        ))}
      </ol>

      {highlights.length > 0 && (
        <ul className="game-result-highlights">
          {highlights.map((item) => (
            <li key={item.key}>
              <span>{item.label}</span>
              <strong>{item.value}</strong>
              {item.detail && <em>{item.detail}</em>}
            </li>
          ))}
        </ul>
      )}

      <div className="game-result-actions">
        <Button
          type="primary"
          size="large"
          className="hud-cta"
          icon={<RedoOutlined />}
          data-testid="play-again-button"
          disabled={playAgainDisabled}
          onClick={onPlayAgain}
        >
          {playAgainText}
        </Button>
        <Button
          size="large"
          icon={<DownloadOutlined />}
          onClick={() => downloadResultImage({ sortedScores, highlights, currentPlayerId })}
        >
          保存战绩图
        </Button>
        <Button size="large" type="text" icon={<LogoutOutlined />} data-testid="leave-room-button" onClick={onBackToRoom}>
          离开
        </Button>
      </div>
    </section>
  )
}

export default GameResult
