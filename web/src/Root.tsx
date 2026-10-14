import { useEffect, useState } from 'react'
import App from './App'
import Landing from './Landing'
import { getSetting } from './lib/db'

export default function Root() {
  const [hash, setHash] = useState(window.location.hash)
  const [setUp, setSetUp] = useState<boolean | null>(null)

  useEffect(() => {
    const f = () => setHash(window.location.hash)
    window.addEventListener('hashchange', f)
    return () => window.removeEventListener('hashchange', f)
  }, [])

  useEffect(() => {
    Promise.all([getSetting('secret:gemini'), getSetting('secret:groq'), getSetting('secret:openrouter')])
      .then(([g, q, o]) => setSetUp(!!(g || q || o)))
      .catch(() => setSetUp(false))
  }, [])

  const h = hash.replace(/^#\/?/, '')
  if (h === 'home') return <Landing />
  if (h === '') {
    if (setUp === null) return null
    if (!setUp) return <Landing />
  }
  return <App />
}
