import * as THREE from 'three'

// 所有贴图都用 canvas 程序化生成，不依赖外部图片资源，首屏无额外网络请求
const CARD_TEXTURE_WIDTH = 320
const CARD_TEXTURE_HEIGHT = 448
const SUIT_GLYPHS = {
  spades: '♠',
  hearts: '♥',
  diamonds: '♦',
  clubs: '♣',
}
const RANK_LABELS = { 1: 'A', 11: 'J', 12: 'Q', 13: 'K' }
const RED = '#c0182b'
const INK = '#14161c'
const GOLD = '#d9a441'
const FONT_STACK = "'Space Grotesk', 'Noto Sans SC', 'PingFang SC', 'Helvetica Neue', sans-serif"

const textureCache = new Map()

function createCanvas(width, height) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

function roundedRectPath(ctx, x, y, width, height, radius) {
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + width, y, x + width, y + height, radius)
  ctx.arcTo(x + width, y + height, x, y + height, radius)
  ctx.arcTo(x, y + height, x, y, radius)
  ctx.arcTo(x, y, x + width, y, radius)
  ctx.closePath()
}

function finalizeTexture(canvas, { anisotropy = 8 } = {}) {
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = anisotropy
  texture.needsUpdate = true
  return texture
}

function cached(key, factory) {
  if (!textureCache.has(key)) {
    textureCache.set(key, factory())
  }
  return textureCache.get(key)
}

export function getCardKey(card) {
  if (!card) {
    return 'back'
  }
  return `${card.suit || 'joker'}-${card.rank}`
}

export function getRankLabel(rank) {
  return RANK_LABELS[rank] || String(rank)
}

function paintCardBase(ctx, width, height) {
  const paper = ctx.createLinearGradient(0, 0, width, height)
  paper.addColorStop(0, '#fffdf7')
  paper.addColorStop(1, '#f1ebdc')
  ctx.fillStyle = paper
  roundedRectPath(ctx, 0, 0, width, height, 26)
  ctx.fill()
  ctx.strokeStyle = 'rgba(20, 22, 28, 0.12)'
  ctx.lineWidth = 3
  roundedRectPath(ctx, 10, 10, width - 20, height - 20, 18)
  ctx.stroke()
}

function paintCorner(ctx, rankLabel, suitGlyph, color) {
  ctx.fillStyle = color
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `700 ${rankLabel.length > 1 ? 50 : 58}px ${FONT_STACK}`
  ctx.fillText(rankLabel, 46, 52)
  ctx.font = `400 44px ${FONT_STACK}`
  ctx.fillText(suitGlyph, 46, 104)
}

function paintJoker(ctx, width, height, isBig) {
  const color = isBig ? RED : INK
  ctx.fillStyle = color
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `800 34px ${FONT_STACK}`
  'JOKER'.split('').forEach((letter, index) => {
    ctx.fillText(letter, 34, 48 + index * 36)
  })

  const halo = ctx.createRadialGradient(width / 2, height / 2, 10, width / 2, height / 2, 150)
  halo.addColorStop(0, isBig ? 'rgba(217, 164, 65, 0.55)' : 'rgba(80, 110, 160, 0.4)')
  halo.addColorStop(1, 'rgba(255, 255, 255, 0)')
  ctx.fillStyle = halo
  ctx.fillRect(0, 0, width, height)

  ctx.fillStyle = color
  ctx.font = `400 150px ${FONT_STACK}`
  ctx.fillText('★', width / 2 + 14, height / 2 - 10)
  ctx.font = `800 54px ${FONT_STACK}`
  ctx.fillText(isBig ? '大王' : '小王', width / 2 + 14, height - 92)
  ctx.font = `600 22px ${FONT_STACK}`
  ctx.fillStyle = GOLD
  ctx.fillText('赖子 · WILD', width / 2 + 14, height - 46)
}

function paintPips(ctx, width, height, card, suitGlyph, color) {
  ctx.fillStyle = color
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  if (card.rank >= 11) {
    // 人头牌：用框 + 大字母代替插画，保持干净
    ctx.strokeStyle = color
    ctx.globalAlpha = 0.2
    ctx.lineWidth = 4
    roundedRectPath(ctx, 74, 74, width - 148, height - 148, 14)
    ctx.stroke()
    ctx.globalAlpha = 1
    ctx.font = `700 150px ${FONT_STACK}`
    ctx.fillText(getRankLabel(card.rank), width / 2, height / 2 - 18)
    ctx.font = `400 74px ${FONT_STACK}`
    ctx.fillText(suitGlyph, width / 2, height / 2 + 92)
    return
  }

  if (card.rank === 1) {
    ctx.font = `400 190px ${FONT_STACK}`
    ctx.fillText(suitGlyph, width / 2, height / 2 + 6)
    return
  }

  ctx.font = `700 132px ${FONT_STACK}`
  ctx.globalAlpha = 0.1
  ctx.fillText(getRankLabel(card.rank), width / 2, height / 2)
  ctx.globalAlpha = 1
  ctx.font = `400 120px ${FONT_STACK}`
  ctx.fillText(suitGlyph, width / 2, height / 2 + 6)
}

export function getCardFaceTexture(card) {
  const key = getCardKey(card)
  return cached(`face:${key}`, () => {
    const canvas = createCanvas(CARD_TEXTURE_WIDTH, CARD_TEXTURE_HEIGHT)
    const ctx = canvas.getContext('2d')
    const { width, height } = canvas
    paintCardBase(ctx, width, height)

    if (card.rank >= 14) {
      paintJoker(ctx, width, height, card.rank === 15)
      return finalizeTexture(canvas)
    }

    const suitGlyph = SUIT_GLYPHS[card.suit] || '?'
    const color = card.suit === 'hearts' || card.suit === 'diamonds' ? RED : INK
    const rankLabel = getRankLabel(card.rank)
    paintCorner(ctx, rankLabel, suitGlyph, color)
    ctx.save()
    ctx.translate(width, height)
    ctx.rotate(Math.PI)
    paintCorner(ctx, rankLabel, suitGlyph, color)
    ctx.restore()
    paintPips(ctx, width, height, card, suitGlyph, color)
    return finalizeTexture(canvas)
  })
}

export function getCardBackTexture() {
  return cached('back', () => {
    const canvas = createCanvas(CARD_TEXTURE_WIDTH, CARD_TEXTURE_HEIGHT)
    const ctx = canvas.getContext('2d')
    const { width, height } = canvas

    ctx.fillStyle = '#f5efe1'
    roundedRectPath(ctx, 0, 0, width, height, 26)
    ctx.fill()

    const inner = ctx.createLinearGradient(0, 0, width, height)
    inner.addColorStop(0, '#7a1020')
    inner.addColorStop(1, '#3d0710')
    ctx.fillStyle = inner
    roundedRectPath(ctx, 16, 16, width - 32, height - 32, 16)
    ctx.fill()

    ctx.save()
    roundedRectPath(ctx, 16, 16, width - 32, height - 32, 16)
    ctx.clip()
    ctx.strokeStyle = 'rgba(217, 164, 65, 0.28)'
    ctx.lineWidth = 2
    for (let offset = -height; offset < width + height; offset += 22) {
      ctx.beginPath()
      ctx.moveTo(offset, 0)
      ctx.lineTo(offset + height, height)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(offset, height)
      ctx.lineTo(offset + height, 0)
      ctx.stroke()
    }
    ctx.restore()

    ctx.strokeStyle = GOLD
    ctx.lineWidth = 4
    roundedRectPath(ctx, 30, 30, width - 60, height - 60, 12)
    ctx.stroke()

    ctx.fillStyle = '#3d0710'
    ctx.beginPath()
    ctx.arc(width / 2, height / 2, 70, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = GOLD
    ctx.lineWidth = 5
    ctx.stroke()
    ctx.fillStyle = GOLD
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = `800 64px ${FONT_STACK}`
    ctx.fillText('逮', width / 2, height / 2 + 2)
    return finalizeTexture(canvas)
  })
}

function makeNoiseCanvas(width, height, baseColor, spread, seedAlpha = 0.07) {
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = baseColor
  ctx.fillRect(0, 0, width, height)
  const image = ctx.getImageData(0, 0, width, height)
  for (let index = 0; index < image.data.length; index += 4) {
    const noise = (Math.random() - 0.5) * spread
    image.data[index] = Math.max(0, Math.min(255, image.data[index] + noise))
    image.data[index + 1] = Math.max(0, Math.min(255, image.data[index + 1] + noise))
    image.data[index + 2] = Math.max(0, Math.min(255, image.data[index + 2] + noise))
  }
  ctx.putImageData(image, 0, 0)
  ctx.globalAlpha = seedAlpha
  return { canvas, ctx }
}

export function getFeltTexture() {
  return cached('felt', () => {
    const { canvas, ctx } = makeNoiseCanvas(1024, 1024, '#0f5a45', 22)
    const vignette = ctx.createRadialGradient(512, 512, 120, 512, 512, 560)
    vignette.addColorStop(0, 'rgba(60, 170, 120, 1)')
    vignette.addColorStop(1, 'rgba(0, 0, 0, 1)')
    ctx.globalAlpha = 0.35
    ctx.fillStyle = vignette
    ctx.fillRect(0, 0, 1024, 1024)

    ctx.globalAlpha = 0.5
    ctx.strokeStyle = 'rgba(217, 164, 65, 0.9)'
    ctx.lineWidth = 4
    ctx.beginPath()
    ctx.ellipse(512, 512, 400, 400, 0, 0, Math.PI * 2)
    ctx.stroke()
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.ellipse(512, 512, 384, 384, 0, 0, Math.PI * 2)
    ctx.stroke()

    ctx.globalAlpha = 0.16
    ctx.fillStyle = '#f5d48a'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = `800 120px ${FONT_STACK}`
    ctx.fillText('逮 二 游', 512, 700)
    ctx.globalAlpha = 1
    return finalizeTexture(canvas, { anisotropy: 4 })
  })
}

export function getWoodTexture() {
  return cached('wood', () => {
    const canvas = createCanvas(512, 128)
    const ctx = canvas.getContext('2d')
    const base = ctx.createLinearGradient(0, 0, 0, 128)
    base.addColorStop(0, '#5a2d17')
    base.addColorStop(0.5, '#3b1a0c')
    base.addColorStop(1, '#24100a')
    ctx.fillStyle = base
    ctx.fillRect(0, 0, 512, 128)
    for (let line = 0; line < 60; line += 1) {
      ctx.strokeStyle = `rgba(${120 + Math.random() * 60}, ${60 + Math.random() * 30}, 30, ${0.08 + Math.random() * 0.12})`
      ctx.lineWidth = 1 + Math.random() * 2
      ctx.beginPath()
      const y = Math.random() * 128
      ctx.moveTo(0, y)
      for (let x = 0; x <= 512; x += 32) {
        ctx.lineTo(x, y + Math.sin(x / 40 + line) * 3)
      }
      ctx.stroke()
    }
    const texture = finalizeTexture(canvas, { anisotropy: 4 })
    texture.wrapS = THREE.RepeatWrapping
    texture.wrapT = THREE.RepeatWrapping
    texture.repeat.set(6, 1)
    return texture
  })
}

export function getFloorTexture() {
  return cached('floor', () => {
    const canvas = createCanvas(512, 512)
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#1b0f14'
    ctx.fillRect(0, 0, 512, 512)
    // 地毯花纹
    ctx.strokeStyle = 'rgba(217, 164, 65, 0.12)'
    ctx.lineWidth = 3
    for (let x = 0; x <= 512; x += 64) {
      for (let y = 0; y <= 512; y += 64) {
        ctx.beginPath()
        ctx.moveTo(x, y - 20)
        ctx.lineTo(x + 20, y)
        ctx.lineTo(x, y + 20)
        ctx.lineTo(x - 20, y)
        ctx.closePath()
        ctx.stroke()
      }
    }
    ctx.fillStyle = 'rgba(120, 20, 40, 0.18)'
    for (let x = 32; x <= 512; x += 64) {
      for (let y = 32; y <= 512; y += 64) {
        ctx.beginPath()
        ctx.arc(x, y, 6, 0, Math.PI * 2)
        ctx.fill()
      }
    }
    const texture = finalizeTexture(canvas, { anisotropy: 4 })
    texture.wrapS = THREE.RepeatWrapping
    texture.wrapT = THREE.RepeatWrapping
    texture.repeat.set(10, 10)
    return texture
  })
}
