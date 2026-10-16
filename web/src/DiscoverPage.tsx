import { useEffect, useMemo, useState } from 'react'
import { addJob, getSetting, setSetting } from './lib/db'
import { discover, planSearches, type Candidate } from './lib/discover'
import { scoreCandidates, type AIScore } from './lib/score'
import { COUNTRIES, countryInfo } from './lib/countries'
import { WelcomeBanner } from './Welcome'
import PreferencesPanel from './PreferencesPanel'
import NotInterested from './NotInterested'
import { getDismissed, jobKey } from './lib/memory'

type Row = Candidate & { ai?: AIScore }
interface ProfileLike { targetTitles: string; skills: string; locations: string; visaSponsorship: boolean; cvText: string }

const pill = 'inline-block rounded-full px-2 py-0.5 text-xs font-medium'
const cc = (r: Row) => r.country ?? 'gb'
const isAgencyRow = (r: Row) => r.sponsor === 'agency' || !!r.ai?.agency

function SponsorBadge({ r }: { r: Row }) {
  if (isAgencyRow(r)) return <span className={`${pill} bg-gray-200 text-gray-700`}>Agency · employer unknown</span>
  if (cc(r) !== 'gb') return null
  if (r.sponsor === 'exact') return <span className={`${pill} bg-green-100 text-green-800`}>Licensed UK sponsor ✓</span>
  if (r.sponsor === 'possible') return <span className={`${pill} bg-amber-100 text-amber-800`}>Possible UK sponsor · check</span>
  return <span className={`${pill} bg-gray-100 text-gray-600`}>Not on UK register</span>
}

export default function DiscoverPage({ profile, notify }: { profile: ProfileLike; notify: (m: string) => void }) {
  const [rows, setRows] = useState<Row[]>([])
  const [lastRun, setLastRun] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [countries, setCountries] = useState<string[]>(['gb'])
  const [sponsorsOnly, setSponsorsOnly] = useState(false)
  const [hideNoVisa, setHideNoVisa] = useState(true)
  const [hideAgencies, setHideAgencies] = useState(false)
  const [minScore, setMinScore] = useState(0)
  const [saved, setSaved] = useState<Set<string>>(new Set())
  const [needsSetup, setNeedsSetup] = useState(false)
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())

  useEffect(() => {
    getDismissed().then(list => setDismissed(new Set(list.map(x => x.key)))).catch(() => {})
    getSetting<{ at: string; rows: Row[] }>('discover:last')
      .then(c => { if (c) { setRows(c.rows); setLastRun(c.at) } })
      .catch(() => {})
    Promise.all([getSetting('secret:gemini'), getSetting('secret:groq'), getSetting('secret:adzunaId'), getSetting('secret:adzuna')])
      .then(([g, q, i, k]) => setNeedsSetup(!(g || q) || !(i && k)))
      .catch(() => {})
    getSetting<string[]>('discover:countries')
      .then(c => { if (c?.length) setCountries(c) })
      .catch(() => {})
  }, [])

  function toggleCountry(code: string) {
    const next = countries.includes(code) ? countries.filter(c => c !== code) : [...countries, code]
    setCountries(next)
    void setSetting('discover:countries', next)
  }

  const plan = planSearches(profile.targetTitles, countries)

  async function run() {
    setBusy(true)
    try {
      const cands = await discover({ ...profile, countries }, setProgress)
      const scores = await scoreCandidates(profile, cands, {
        max: 40,
        onProgress: (d, t) => setProgress(`Scoring with AI ${d}/${t}`),
      })
      const next = cands
        .map(c => ({ ...c, ai: scores.get(c.key) }))
        .sort((a, b) => (b.ai?.score ?? -1) - (a.ai?.score ?? -1) || b.keywordScore - a.keywordScore)
      const at = new Date().toISOString()
      setRows(next)
      setLastRun(at)
      await setSetting('discover:last', { at, rows: next })
      notify(`Found ${next.length} jobs, scored the top ${scores.size}.`)
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Search failed')
    } finally {
      setBusy(false)
      setProgress('')
    }
  }

  async function save(r: Row) {
    try {
      const country = cc(r)
      const { created } = await addJob({
        source: 'adzuna',
        url: r.url,
        title: r.title,
        company: r.company,
        location: country === 'gb' ? r.location : `${r.location}, ${countryInfo(country)?.name ?? country.toUpperCase()}`,
        salary: r.salary,
        description: r.snippet,
        postedAt: r.postedAt,
        match: r.ai ? { score: r.ai.score, reason: r.ai.reason, sponsorship: r.ai.sponsorship } : undefined,
        sponsor:
          country === 'gb'
            ? { level: isAgencyRow(r) ? 'agency' : r.sponsor === 'n/a' ? 'none' : r.sponsor, name: r.sponsorName }
            : undefined,
      })
      setSaved(s => new Set(s).add(r.key))
      notify(created ? `Saved: ${r.title}` : 'Already in your jobs')
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Could not save job')
    }
  }

  const shown = useMemo(
    () =>
      rows.filter(r => {
        if (dismissed.has(jobKey(r.title, r.company))) return false
        if (sponsorsOnly && !(cc(r) === 'gb' && (r.sponsor === 'exact' || r.sponsor === 'possible') && !r.ai?.agency)) return false
        if (hideAgencies && isAgencyRow(r)) return false
        if (hideNoVisa && r.ai?.sponsorship === 'not offered') return false
        if ((r.ai?.score ?? r.keywordScore) < minScore) return false
        return true
      }),
    [rows, sponsorsOnly, hideAgencies, hideNoVisa, minScore, dismissed],
  )

  const groups = [...new Set(COUNTRIES.map(c => c.group))]

  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">Jobs via Adzuna</div>
          <h1>Discover</h1>
          <p className="subtitle">Searches your target titles in the countries you pick, scores fit with AI and checks the UK sponsor register.</p>
        </div>
        <button className="button primary" onClick={() => void run()} disabled={busy || plan.total === 0}>
          {busy ? progress || 'Working…' : 'Find jobs'}
        </button>
      </div>

      {needsSetup && <WelcomeBanner />}

      <PreferencesPanel disabled={busy} />


      <section className="panel" style={{ padding: 16, marginBottom: 16 }}>
        <div className="flex flex-col gap-3 text-sm">
          {groups.map(g => (
            <div key={g} className="flex flex-wrap items-center gap-2">
              <span className="opacity-60" style={{ minWidth: 110 }}>{g}</span>
              {COUNTRIES.filter(c => c.group === g).map(c => (
                <button
                  key={c.code}
                  type="button"
                  disabled={!c.adzuna}
                  title={c.adzuna ? '' : 'Coming soon (Jooble)'}
                  onClick={() => toggleCountry(c.code)}
                  className={`button small ${countries.includes(c.code) && c.adzuna ? 'primary' : ''}`}
                  style={!c.adzuna ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
                >
                  {c.name}{!c.adzuna ? ' (soon)' : ''}
                </button>
              ))}
            </div>
          ))}
          <div className="opacity-70">
            {plan.total} Adzuna searches per run ({plan.titles.length} title{plan.titles.length === 1 ? '' : 's'} × {plan.countries.length} countr{plan.countries.length === 1 ? 'y' : 'ies'}, max 20). Free tier: 1,000/month.
          </div>
        </div>
      </section>

      <section className="panel" style={{ padding: 16, marginBottom: 16 }}>
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" checked={sponsorsOnly} onChange={e => setSponsorsOnly(e.target.checked)} />UK sponsors only</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={hideNoVisa} onChange={e => setHideNoVisa(e.target.checked)} />Hide "no sponsorship" ads</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={hideAgencies} onChange={e => setHideAgencies(e.target.checked)} />Hide agencies</label>
          <label className="flex items-center gap-2">Min score
            <select value={minScore} onChange={e => setMinScore(Number(e.target.value))}>
              {[0, 50, 60, 70, 80].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <span className="ml-auto opacity-70">
            {shown.length} of {rows.length}{lastRun ? ` · last run ${new Date(lastRun).toLocaleString('en-GB')}` : ''}
          </span>
        </div>
      </section>

      {rows.length === 0 && !busy && (
        <section className="panel" style={{ padding: 24 }}>
          <p>Pick your countries, then click <strong>Find jobs</strong> to search using the target titles and skills in your profile.</p>
        </section>
      )}

      <div className="flex flex-col gap-3">
        {shown.map(r => (
          <article key={r.key} className="panel" style={{ padding: 16 }}>
            <div className="flex flex-wrap items-start gap-4">
              <div className="text-center" style={{ minWidth: 52 }}>
                <div className="text-2xl font-semibold">{r.ai?.score ?? '–'}</div>
                <div className="text-xs opacity-60">kw {r.keywordScore}</div>
              </div>
              <div className="flex-1" style={{ minWidth: 220 }}>
                <h3 className="font-semibold">{r.title}</h3>
                <div className="text-sm opacity-80">
                  {r.company} · {r.location} · {countryInfo(cc(r))?.name ?? cc(r).toUpperCase()}{r.salary ? ` · ${r.salary}` : ''}
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <SponsorBadge r={r} />
                  {r.ai?.sponsorship === 'not offered' && <span className={`${pill} bg-red-100 text-red-800`}>Ad: no sponsorship</span>}
                  {r.ai?.sponsorship === 'offered' && <span className={`${pill} bg-green-100 text-green-800`}>Ad: sponsorship offered</span>}
                </div>
                {cc(r) === 'gb' && r.sponsorName && !isAgencyRow(r) && <div className="mt-1 text-xs opacity-60">Register: {r.sponsorName}</div>}
                {r.ai?.reason && <p className="mt-2 text-sm">{r.ai.reason}</p>}
              </div>
              <div className="flex gap-2">
                <NotInterested title={r.title} company={r.company} notify={notify} onDone={k => setDismissed(s => new Set(s).add(k))} />
                <a className="button small" href={r.url} target="_blank" rel="noreferrer">Open</a>
                <button className="button small primary" onClick={() => void save(r)} disabled={saved.has(r.key)}>
                  {saved.has(r.key) ? 'Saved' : 'Save'}
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>
    </>
  )
}
