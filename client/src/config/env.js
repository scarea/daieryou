const DEFAULT_WS_URL = 'ws://localhost:3014'

export const env = {
  wsUrl: import.meta.env.VITE_WS_URL || DEFAULT_WS_URL,
}
