import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import AgentCommandCenter from './AgentCommandCenter.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AgentCommandCenter />
  </StrictMode>,
)
