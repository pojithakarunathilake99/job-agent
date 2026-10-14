import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

if (import.meta.env.DEV) {
  import('./lib/db').then(m => { (window as unknown as { jobdb: typeof m }).jobdb = m })
  import('./lib/llm').then(m => { (window as unknown as { llm: typeof m }).llm = m })
}

if (import.meta.env.DEV) {
  import('./lib/sponsors').then(m => { (window as unknown as { sponsors: typeof m }).sponsors = m })
}

if (import.meta.env.DEV) {
  import('./lib/discover').then(m => { (window as unknown as { discover: typeof m }).discover = m })
}

if (import.meta.env.DEV) {
  import('./lib/score').then(m => { (window as unknown as { score: typeof m }).score = m })
}

if (import.meta.env.DEV) {
  import('./lib/score').then(m => { (window as unknown as { score: typeof m }).score = m })
}

if (import.meta.env.DEV) {
  import('./lib/agent').then(m => { (window as unknown as { agent: typeof m }).agent = m })
}

// After a new deploy, an open tab may request old chunk files that no longer exist.
// Reload once to pick up the latest build (guarded to avoid reload loops).
window.addEventListener('vite:preloadError', event => {
  try {
    if (sessionStorage.getItem('rs:reloaded')) return
    sessionStorage.setItem('rs:reloaded', '1')
    event.preventDefault()
    window.location.reload()
  } catch { /* storage blocked: let the error surface */ }
})
setTimeout(() => { try { sessionStorage.removeItem('rs:reloaded') } catch { /* ignore */ } }, 15000)
