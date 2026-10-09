const DEFAULT_WS_URL = 'ws://localhost:3014'

const wsUrl = import.meta.env.VITE_WS_URL || DEFAULT_WS_URL

// ws://host → http://host/healthz，wss://host → https://host/healthz
function deriveHealthUrl(url) {
  try {
    const parsed = new URL(url)
    parsed.protocol = parsed.protocol === 'wss:' ? 'https:' : 'http:'
    parsed.pathname = '/healthz'
    parsed.search = ''
    return parsed.toString()
  } catch (error) {
    return null
  }
}

export const env = {
  wsUrl,
  healthUrl: import.meta.env.VITE_HEALTH_URL || deriveHealthUrl(wsUrl),
}
