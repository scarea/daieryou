import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'
import './styles/base.css'
import './styles/card.css'
import './styles/login.css'
import './styles/lobby.css'
import './styles/table.css'
import './styles/features.css'
import './styles/mahjong.css'
import './styles/platform.css'

createRoot(document.getElementById('root') as HTMLElement).render(<App />)
