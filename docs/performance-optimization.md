# 性能优化建议

## 1. 首屏加载优化

### 1.1 字体优化
**当前问题：**
- 使用 Google Fonts 加载 Space Grotesk 和 Noto Sans SC
- 可能导致首屏渲染阻塞

**优化方案：**
```css
/* 在 index.css 中添加 */
@font-face {
  font-family: 'Space Grotesk';
  font-display: swap; /* 使用系统字体先渲染，字体加载后替换 */
  src: url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&display=swap');
}

@font-face {
  font-family: 'Noto Sans SC';
  font-display: swap;
  src: url('https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;700&display=swap');
}
```

**进一步优化：**
- 使用字体子集（仅包含常用汉字）
- 考虑使用系统字体栈作为备选：
  ```css
  font-family: 'Space Grotesk', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  ```

### 1.2 BGM 音频优化
**当前问题：**
- `game-bgm.wav` 文件大小 793KB
- WAV 格式未压缩

**优化方案：**
```bash
# 使用 ffmpeg 压缩为 MP3
ffmpeg -i client/public/audio/game-bgm.wav -codec:a libmp3lame -b:a 128k client/public/audio/game-bgm.mp3

# 或压缩为 OGG（更好的压缩率）
ffmpeg -i client/public/audio/game-bgm.wav -codec:a libvorbis -q:a 4 client/public/audio/game-bgm.ogg
```

**预期效果：**
- MP3 (128kbps): ~80KB (减少 90%)
- OGG (quality 4): ~60KB (减少 92%)

**代码修改：**
```javascript
// 在 GameScene.jsx 中
const bgmAudio = useMemo(() => {
  const audio = new Audio()
  // 提供多种格式，浏览器自动选择支持的格式
  if (audio.canPlayType('audio/ogg')) {
    audio.src = '/audio/game-bgm.ogg'
  } else if (audio.canPlayType('audio/mpeg')) {
    audio.src = '/audio/game-bgm.mp3'
  } else {
    audio.src = '/audio/game-bgm.wav'
  }
  return audio
}, [])
```

### 1.3 Ant Design 按需引入
**当前问题：**
- 引入完整的 Ant Design 包
- 打包后 antd.js 约 836KB (gzip 后 262KB)

**优化方案：**

方案 A：使用 Vite 的自动 Tree Shaking（已启用）
```javascript
// vite.config.js 中确保配置
export default {
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'antd': ['antd'],
          'react-vendor': ['react', 'react-dom'],
        }
      }
    }
  }
}
```

方案 B：使用 babel-plugin-import（需要额外配置）
```bash
npm install -D babel-plugin-import
```

```javascript
// vite.config.js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [
    react({
      babel: {
        plugins: [
          ['import', { libraryName: 'antd', style: true }]
        ]
      }
    })
  ]
})
```

### 1.4 代码分割优化
**当前状态：**
- 已使用 React.lazy 懒加载场景组件 ✓
- 已使用 Suspense 包裹懒加载组件 ✓

**进一步优化：**
```javascript
// 在 App.jsx 中添加骨架屏
const LoadingFallback = () => (
  <div className="scene-loader">
    <Spin size="large" />
    <p style={{ marginTop: 16, color: 'var(--text-subtle)' }}>加载中...</p>
  </div>
)

<Suspense fallback={<LoadingFallback />}>
  <GameScene />
</Suspense>
```

## 2. 运行时性能优化

### 2.1 减少不必要的重渲染
**优化建议：**
```javascript
// 在 GameScene.jsx 中使用 React.memo
const PlayerCard = React.memo(({ player, seat }) => {
  // ...
}, (prevProps, nextProps) => {
  // 仅在关键属性变化时重渲染
  return prevProps.player.id === nextProps.player.id &&
         prevProps.player.totalScore === nextProps.player.totalScore &&
         prevProps.player.online === nextProps.player.online
})
```

### 2.2 优化 backdrop-filter
**当前问题：**
- 所有 `.scene-card` 使用 `backdrop-filter: blur(10px)`
- 在低端设备上性能较差

**优化方案：**
```css
/* 在 App.css 中添加 */
@supports (backdrop-filter: blur(10px)) {
  .scene-card {
    backdrop-filter: blur(10px);
  }
}

/* 不支持时使用纯色背景 */
@supports not (backdrop-filter: blur(10px)) {
  .scene-card {
    background: rgba(255, 255, 255, 0.95) !important;
  }
}

/* 或使用 CSS 变量控制 */
:root {
  --enable-blur: blur(10px);
}

@media (max-width: 768px) {
  :root {
    --enable-blur: none; /* 移动端禁用模糊 */
  }
}

.scene-card {
  backdrop-filter: var(--enable-blur);
}
```

### 2.3 优化动画性能
**当前问题：**
- 部分动画使用 `transform` 和 `opacity` 以外的属性
- 可能触发重排（reflow）

**优化建议：**
```css
/* 仅使用 transform 和 opacity 进行动画 */
@keyframes cardReveal {
  from {
    transform: rotateY(90deg) scale(0.8);
    opacity: 0;
  }
  to {
    transform: rotateY(0deg) scale(1);
    opacity: 1;
  }
}

/* 添加 will-change 提示浏览器优化 */
.playing-card {
  will-change: transform, opacity;
}

/* 动画结束后移除 will-change */
.playing-card.animated {
  will-change: auto;
}
```

## 3. 网络优化

### 3.1 启用 HTTP/2
**建议：**
- 确保服务器支持 HTTP/2
- 可以并行加载多个资源

### 3.2 添加资源预加载
```html
<!-- 在 index.html 中添加 -->
<head>
  <!-- 预加载关键字体 -->
  <link rel="preload" href="/fonts/space-grotesk.woff2" as="font" type="font/woff2" crossorigin>

  <!-- 预连接到 API 服务器 -->
  <link rel="preconnect" href="https://api.example.com">

  <!-- DNS 预解析 -->
  <link rel="dns-prefetch" href="https://fonts.googleapis.com">
</head>
```

### 3.3 Service Worker 缓存
**建议：**
```javascript
// 在 src/serviceWorker.js 中
const CACHE_NAME = 'daieryou-v1'
const urlsToCache = [
  '/',
  '/index.html',
  '/audio/game-bgm.mp3',
  '/assets/index.css',
  '/assets/index.js',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(urlsToCache))
  )
})

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request)
      .then((response) => response || fetch(event.request))
  )
})
```

## 4. 构建优化

### 4.1 生产环境构建配置
```javascript
// vite.config.js
export default defineConfig({
  build: {
    // 启用压缩
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true, // 移除 console.log
        drop_debugger: true,
      }
    },

    // 代码分割
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
          'antd': ['antd'],
          'game-logic': [
            './src/utils/cardUtils.js',
            './src/services/gameService.js',
          ]
        }
      }
    },

    // 启用 gzip 压缩
    reportCompressedSize: true,

    // chunk 大小警告阈值
    chunkSizeWarningLimit: 500,
  }
})
```

### 4.2 图片优化（如果添加图片）
```bash
# 使用 imagemin 压缩图片
npm install -D vite-plugin-imagemin

# vite.config.js
import viteImagemin from 'vite-plugin-imagemin'

export default {
  plugins: [
    viteImagemin({
      gifsicle: { optimizationLevel: 7 },
      optipng: { optimizationLevel: 7 },
      mozjpeg: { quality: 80 },
      pngquant: { quality: [0.8, 0.9] },
      svgo: {
        plugins: [
          { name: 'removeViewBox' },
          { name: 'removeEmptyAttrs', active: false }
        ]
      }
    })
  ]
}
```

## 5. 监控和分析

### 5.1 添加性能监控
```javascript
// 在 src/utils/performance.js
export function measurePerformance() {
  if (typeof window === 'undefined' || !window.performance) {
    return
  }

  window.addEventListener('load', () => {
    const perfData = window.performance.timing
    const pageLoadTime = perfData.loadEventEnd - perfData.navigationStart
    const connectTime = perfData.responseEnd - perfData.requestStart
    const renderTime = perfData.domComplete - perfData.domLoading

    console.log('Performance Metrics:', {
      pageLoadTime: `${pageLoadTime}ms`,
      connectTime: `${connectTime}ms`,
      renderTime: `${renderTime}ms`,
    })

    // 可以发送到分析服务
    // sendToAnalytics({ pageLoadTime, connectTime, renderTime })
  })
}
```

### 5.2 使用 Lighthouse 分析
```bash
# 安装 Lighthouse CLI
npm install -g lighthouse

# 运行分析
lighthouse http://localhost:5173 --view

# 或使用 Chrome DevTools 的 Lighthouse 面板
```

## 6. 优先级总结

### 高优先级（立即实施）
1. ✅ 字体 font-display: swap
2. ✅ BGM 压缩为 MP3/OGG
3. ✅ 移动端禁用 backdrop-filter

### 中优先级（近期实施）
4. Ant Design 按需引入优化
5. 添加骨架屏 Loading
6. 优化动画性能（will-change）

### 低优先级（长期优化）
7. Service Worker 缓存
8. 性能监控系统
9. 图片资源优化（如果添加）

## 7. 预期效果

实施以上优化后，预期可以达到：
- **首屏加载时间**：从 ~2s 降低到 ~1s
- **包体积**：从 ~1.2MB 降低到 ~800KB
- **Lighthouse 分数**：
  - Performance: 85+ → 95+
  - Accessibility: 90+ → 95+
  - Best Practices: 90+ → 95+
  - SEO: 85+ → 90+
