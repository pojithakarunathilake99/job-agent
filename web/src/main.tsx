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
