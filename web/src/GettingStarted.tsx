import { useCallback, useEffect, useState } from 'react'
import { getSetting, listJobs, setSetting } from './lib/db'

interface Step { id: string; title: string; how: string; page?: string; links?: { label: string; href: string }[]; optional?: boolean; manual?: boolean }

const STEPS: Step[] = [
  { id: 'ai', title: 'Add an AI key', how: 'Settings → choose Gemini or Groq → paste your key → Save settings → Test AI.', page: 'settings',
    links: [{ label: 'Get Gemini key', href: 'https://aistudio.google.com/apikey' }, { label: 'Get Groq key', href: 'https://console.groq.com/keys' }] },
  { id: 'adzuna', title: 'Add Adzuna keys (job search)', how: 'Settings → Adzuna app ID and app key → Save settings. Free tier: 1,000 searches a month.', page: 'settings',
    links: [{ label: 'Get Adzuna keys', href: 'https://developer.adzuna.com/signup' }] },
  { id: 'profile', title: 'Build your profile from your CV', how: 'Profile → upload your CV → Fill from CV with AI → check titles, skills and visa need → Save profile.', page: 'profile' },
  { id: 'search', title: 'Find jobs', how: 'Discover → pick countries → Find jobs. AI scores each job and checks the UK sponsor register.', page: 'discover' },
  { id: 'saved', title: 'Save the jobs you like', how: 'Click Save on a result. Saved jobs appear in Workspace with their score and sponsor badge.', page: 'discover' },
  { id: 'track', title: 'Track your applications', how: 'Workspace → open a job → change its status as you go (Applied, Interview, Offer…).', page: 'dashboard' },
  { id: 'extension', title: 'Install the Chrome extension', how: 'See the Chrome extension section below. Tick this when done.', optional: true, manual: true },
]

const pageLabel = (p: string) => (p === 'dashboard' ? 'Workspace' : p[0].toUpperCase() + p.slice(1))

export default function GettingStarted() {
  const [auto, setAuto] = useState<Record<string, boolean>>({})
  const [manual, setManual] = useState<Record<string, boolean>>({})

  const refresh = useCallback(async () => {
    const [gem, groq, azId, azKey, profile, last, agentRun, jobs, man] = await Promise.all([
      getSetting<string>('secret:gemini'), getSetting<string>('secret:groq'),
      getSetting<string>('secret:adzunaId'), getSetting<string>('secret:adzuna'),
      getSetting<{ targetTitles?: string; skills?: string }>('profile'),
      getSetting('discover:last'), getSetting('agent:lastRun'), listJobs(),
      getSetting<Record<string, boolean>>('guide:manual'),
    ])
    setAuto({
      ai: !!(gem || groq),
      adzuna: !!(azId && azKey),
      profile: !!(profile?.targetTitles?.trim() && profile?.skills?.trim()),
      search: !!(last || agentRun),
      saved: jobs.length > 0,
      track: jobs.some(j => j.status !== 'saved'),
    })
    setManual(man ?? {})
  }, [])

  useEffect(() => {
    void refresh()
    const f = () => void refresh()
    window.addEventListener('focus', f)
    return () => window.removeEventListener('focus', f)
  }, [refresh])

  const isDone = (s: Step) => (s.manual ? !!manual[s.id] : !!auto[s.id])
  const required = STEPS.filter(s => !s.optional)
  const doneCount = required.filter(isDone).length
  const nextStep = STEPS.find(s => !isDone(s) && !s.optional)

  function toggleManual(id: string) {
    const next = { ...manual, [id]: !manual[id] }
    setManual(next)
    void setSetting('guide:manual', next)
  }

  return (
    <section className="panel" style={{ padding: 18, marginBottom: 16 }}>
      <h2 className="font-semibold" style={{ fontSize: 17 }}>Getting started</h2>
      <p className="text-sm opacity-70">{doneCount === required.length ? 'All set — you know your way around.' : `${doneCount} of ${required.length} steps done`}</p>
      <div style={{ height: 6, borderRadius: 99, background: 'var(--surface-2)', margin: '12px 0 14px', overflow: 'hidden' }}>
        <div style={{ width: `${(doneCount / required.length) * 100}%`, height: '100%', background: 'var(--accent)', transition: 'width .3s' }} />
      </div>
      <ol className="flex flex-col gap-2">
        {STEPS.map((s, i) => {
          const done = isDone(s)
          const isNext = nextStep?.id === s.id
          return (
            <li key={s.id} className="flex items-start gap-3" style={{ padding: '10px 12px', borderRadius: 10, background: isNext ? 'var(--accent-soft)' : 'transparent', opacity: done && !isNext ? 0.75 : 1 }}>
              <button type="button" aria-label={done ? 'Done' : 'Not done'} onClick={s.manual ? () => toggleManual(s.id) : undefined}
                style={{ flex: '0 0 24px', height: 24, borderRadius: 99, border: done ? 'none' : '2px solid var(--line)', background: done ? 'var(--green)' : 'transparent', color: '#fff', fontWeight: 700, fontSize: 14, lineHeight: '24px', cursor: s.manual ? 'pointer' : 'default' }}>
                {done ? '✓' : ''}
              </button>
              <div className="flex-1">
                <div className="font-medium" style={{ textDecoration: done ? 'line-through' : 'none' }}>
                  {i + 1}. {s.title}{s.optional && <span className="text-xs opacity-60"> (optional)</span>}
                </div>
                <div className="text-sm opacity-75">{s.how}</div>
                {(s.page || s.links) && !done && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {s.page && <a className="button small primary" href={`#/${s.page}`}>Go to {pageLabel(s.page)}</a>}
                    {s.links?.map(l => <a key={l.href} className="button small" href={l.href} target="_blank" rel="noreferrer">{l.label}</a>)}
                  </div>
                )}
              </div>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
