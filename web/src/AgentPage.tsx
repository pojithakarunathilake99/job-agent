import { useEffect, useRef, useState } from 'react'
import { getSetting, setSetting } from './lib/db'
import { runAgent, type AgentLog, type AgentResult } from './lib/agent'
import { COUNTRIES } from './lib/countries'
import type { Provider, Routes } from './lib/llm'

interface ProfileLike { targetTitles: string; skills: string; locations: string; visaSponsorship: boolean; cvText: string }

const ICON: Record<AgentLog['kind'], string> = { goal: '🎯', thought: '💭', call: '🔧', result: '✅', error: '⚠️', done: '🏁' }

function pretty(e: AgentLog) {
  if (e.kind !== 'call') return e.text
  const m = e.text.match(/^(\w+)\(([\s\S]*)\)$/)
  if (!m) return e.text
  let a: Record<string, unknown> = {}
  try { a = JSON.parse(m[2]) } catch { return e.text }
  switch (m[1]) {
    case 'search_jobs': return `Searching ${String(a.country ?? '').toUpperCase()}: "${a.query}"`
    case 'score_jobs': return `Scoring ${(a.ids as unknown[] | undefined)?.length ?? 0} jobs with AI`
    case 'save_job': return `Saving ${a.id}: ${a.reason ?? ''}`
    case 'finish': return 'Writing summary'
    default: return e.text
  }
}

export default function AgentPage({ profile, notify }: { profile: ProfileLike; notify: (m: string) => void }) {
  const [countries, setCountries] = useState<string[]>(['gb'])
  const [minScore, setMinScore] = useState(70)
  const [maxSaves, setMaxSaves] = useState(5)
  const [maxSearches, setMaxSearches] = useState(8)
  const [timeLimit, setTimeLimit] = useState(5)
  const [routes, setRoutes] = useState<Routes>({})
  const [agentProvider, setAgentProvider] = useState<Provider>('gemini')
  const [scoringProvider, setScoringProvider] = useState<Provider>('gemini')
  const [keys, setKeys] = useState({ gemini: false, groq: false, openrouter: false, adzuna: false })
  const [running, setRunning] = useState(false)
  const [log, setLog] = useState<AgentLog[]>([])
  const [result, setResult] = useState<AgentResult | null>(null)
  const [lastAt, setLastAt] = useState('')
  const [error, setError] = useState('')
  const abortRef = useRef<AbortController | null>(null)
  const logEnd = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    void (async () => {
      const [cs, r, last, g, q, ai, ak] = await Promise.all([
        getSetting<string[]>('discover:countries'),
        getSetting<Routes>('llm:routes'),
        getSetting<{ at: string; result: AgentResult }>('agent:lastRun'),
        getSetting<string>('secret:gemini'), getSetting<string>('secret:groq'),
        getSetting<string>('secret:adzunaId'), getSetting<string>('secret:adzuna'),
      ])
      if (cs?.length) setCountries(cs)
      const k = { gemini: !!g, groq: !!q, openrouter: false, adzuna: !!(ai && ak) }
      setKeys(k)
      setRoutes(r ?? {})
      setAgentProvider(r?.agent?.provider ?? (k.gemini ? 'gemini' : 'groq'))
      setScoringProvider(r?.scoring?.provider ?? (k.groq ? 'groq' : 'gemini'))
      if (last) { setResult(last.result); setLog(last.result.log ?? []); setLastAt(last.at) }
    })().catch(() => {})
  }, [])

  useEffect(() => { logEnd.current?.scrollIntoView({ block: 'nearest' }) }, [log.length])

  function toggleCountry(code: string) {
    const next = countries.includes(code) ? countries.filter(c => c !== code) : [...countries, code]
    setCountries(next)
    void setSetting('discover:countries', next)
  }

  function setProviders(agent: Provider, scoring: Provider) {
    setAgentProvider(agent)
    setScoringProvider(scoring)
    const next: Routes = { ...routes, agent: { provider: agent }, scoring: { provider: scoring } }
    setRoutes(next)
    void setSetting('llm:routes', next)
  }

  async function run() {
    await setSetting('llm:routes', { ...routes, agent: { provider: agentProvider }, scoring: { provider: scoringProvider } })
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setRunning(true)
    setLog([])
    setResult(null)
    setError('')
    try {
      const r = await runAgent(profile, {
        countries, minScore, maxSaves, maxSearches,
        maxSteps: maxSearches + 10,
        timeLimitMs: timeLimit * 60000,
        signal: ctrl.signal,
        onLog: e => setLog(l => [...l, e]),
      })
      setResult(r)
      setLastAt(new Date().toISOString())
      notify(`${r.stopped === 'time' ? 'Time limit reached' : r.stopped === 'user' ? 'Stopped' : 'Agent finished'}: saved ${r.saved.length} job${r.saved.length === 1 ? '' : 's'}.`)
    } catch (e) {
      setError(ctrl.signal.aborted ? 'Stopped by you.' : e instanceof Error ? e.message : String(e))
    } finally {
      setRunning(false)
      abortRef.current = null
    }
  }

  const hasAI = keys.gemini || keys.groq
  const ready = hasAI && keys.adzuna && countries.some(c => COUNTRIES.find(x => x.code === c)?.adzuna)
  const groups = [...new Set(COUNTRIES.map(c => c.group))]
  const providerOption = (p: Provider, label: string) => (
    <option value={p} disabled={!keys[p]}>{label}{keys[p] ? '' : ' (no key)'}</option>
  )

  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">Autonomous search</div>
          <h1>Agent</h1>
          <p className="subtitle">Give it a goal. It plans searches, scores jobs, refines, and saves the best picks for you to review. It never applies for you.</p>
        </div>
        {running
          ? <button className="button" onClick={() => abortRef.current?.abort()}>Stop</button>
          : <button className="button primary" onClick={() => void run()} disabled={!ready}>Run agent</button>}
      </div>

      {!ready && (
        <section className="panel" style={{ padding: '12px 16px', marginBottom: 16, borderLeft: '4px solid var(--gold)' }}>
          <span className="text-sm">
            {!hasAI ? 'Add a Gemini or Groq key. ' : ''}{!keys.adzuna ? 'Add your Adzuna app ID and key. ' : ''}
            {hasAI && keys.adzuna ? 'Pick at least one country. ' : ''}
          </span>
          {(!hasAI || !keys.adzuna) && <a className="button small primary" style={{ marginLeft: 8 }} href="#/help">How to get keys</a>}
        </section>
      )}

      <section className="panel" style={{ padding: 16, marginBottom: 16 }}>
        <div className="flex flex-col gap-3 text-sm">
          {groups.map(g => (
            <div key={g} className="flex flex-wrap items-center gap-2">
              <span className="opacity-60" style={{ minWidth: 110 }}>{g}</span>
              {COUNTRIES.filter(c => c.group === g).map(c => (
                <button key={c.code} type="button" disabled={!c.adzuna || running} onClick={() => toggleCountry(c.code)}
                  className={`button small ${countries.includes(c.code) && c.adzuna ? 'primary' : ''}`}
                  style={!c.adzuna ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}>
                  {c.name}{!c.adzuna ? ' (soon)' : ''}
                </button>
              ))}
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-4" style={{ marginTop: 6 }}>
            <label className="flex items-center gap-2">Min score
              <select value={minScore} disabled={running} onChange={e => setMinScore(Number(e.target.value))}>
                {[60, 65, 70, 75, 80].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-2">Max saves
              <select value={maxSaves} disabled={running} onChange={e => setMaxSaves(Number(e.target.value))}>
                {[3, 5, 10].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-2">Search budget
              <select value={maxSearches} disabled={running} onChange={e => setMaxSearches(Number(e.target.value))}>
                {[4, 8, 12, 20].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-2">Time limit
              <select value={timeLimit} disabled={running} onChange={e => setTimeLimit(Number(e.target.value))}>
                {[3, 5, 10].map(n => <option key={n} value={n}>{n} min</option>)}
              </select>
            </label>
            <label className="flex items-center gap-2">Agent AI
              <select value={agentProvider} disabled={running} onChange={e => setProviders(e.target.value as Provider, scoringProvider)}>
                {providerOption('gemini', 'Gemini')}{providerOption('groq', 'Groq')}
              </select>
            </label>
            <label className="flex items-center gap-2">Scoring AI
              <select value={scoringProvider} disabled={running} onChange={e => setProviders(agentProvider, e.target.value as Provider)}>
                {providerOption('gemini', 'Gemini')}{providerOption('groq', 'Groq')}
              </select>
            </label>
          </div>
          <div className="opacity-60 text-xs">
            Tip: Gemini for the agent and Groq for scoring works best on free tiers. A run takes 1–4 minutes and uses up to {maxSearches} Adzuna searches.
          </div>
        </div>
      </section>

      {log.length > 0 && (
        <section className="panel" style={{ padding: 16, marginBottom: 16 }}>
          <div className="flex items-center gap-2" style={{ marginBottom: 8 }}>
            <h2 className="font-semibold" style={{ fontSize: 16 }}>{running ? 'Working…' : 'Run log'}</h2>
            {!running && lastAt && <span className="text-xs opacity-60">{new Date(lastAt).toLocaleString('en-GB')}</span>}
          </div>
          <div style={{ maxHeight: 360, overflowY: 'auto', fontSize: 13, lineHeight: 1.6 }}>
            {log.map((e, i) => (
              <div key={i} className="flex gap-2" style={{ padding: '3px 0', color: e.kind === 'error' ? 'var(--gold)' : undefined, opacity: e.kind === 'thought' ? 0.7 : 1 }}>
                <span>{ICON[e.kind]}</span>
                <span style={{ whiteSpace: 'pre-wrap' }}>{pretty(e)}</span>
              </div>
            ))}
            <div ref={logEnd} />
          </div>
        </section>
      )}

      {error && (
        <section className="panel" style={{ padding: '12px 16px', marginBottom: 16, borderLeft: '4px solid var(--accent)' }}>
          <span className="text-sm">{error}</span>
        </section>
      )}

      {result && !running && (
        <section className="panel" style={{ padding: 18 }}>
          <h2 className="font-semibold" style={{ fontSize: 17 }}>Summary</h2>
          <p className="text-sm" style={{ marginTop: 6, lineHeight: 1.7 }}>{result.summary || 'Finished.'}</p>
          {result.saved.length > 0 && (
            <ul className="text-sm" style={{ marginTop: 10, paddingLeft: 18, listStyle: 'disc', lineHeight: 1.8 }}>
              {result.saved.map((s, i) => <li key={i}><strong>{s.score}</strong> · {s.title} · {s.company}</li>)}
            </ul>
          )}
          <p className="text-xs opacity-60" style={{ marginTop: 8 }}>
            {result.searches} searches · {result.scored} jobs scored · {result.saved.length} saved · {result.steps} steps
          </p>
          <a className="button primary" style={{ marginTop: 12 }} href="#/dashboard">Review picks in Workspace</a>
        </section>
      )}
    </>
  )
}
