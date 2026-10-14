import { addJob, setSetting } from './db'
import { startToolSession, type ToolCall, type ToolDef, type ToolReply } from './llm'
import { searchAdzuna, toCandidate, isAgency, list, type Candidate } from './discover'
import { matchSponsor, normalizeCompany } from './sponsors'
import { scoreCandidates, type AIScore, type ScoreProfile } from './score'
import { countryInfo } from './countries'

export interface AgentLog { at: string; kind: 'goal' | 'thought' | 'call' | 'result' | 'error' | 'done'; text: string }
export interface AgentOptions {
  countries: string[]
  minScore?: number
  maxSaves?: number
  maxSearches?: number
  maxSteps?: number
  signal?: AbortSignal
  onLog?: (e: AgentLog) => void
}
export interface AgentResult {
  summary: string
  saved: { title: string; company: string; score: number }[]
  searches: number
  scored: number
  steps: number
  log: AgentLog[]
}

type PoolItem = Candidate & { ai?: AIScore }

const SYSTEM = `You are a job-search agent working for one candidate. You act only through tools.
Method:
1. Plan which titles/keywords to search in which allowed countries. Start with the candidate's target titles and spread searches across the allowed countries.
2. After each search, look at titles and kw (keyword score). Score the most relevant ones with score_jobs (up to 10 ids per call).
3. If results are weak (few relevant titles or AI scores below the minimum), refine: try related titles, synonyms or skill-based queries. Never repeat an identical query in the same country.
4. Save jobs that meet the minimum score. If the candidate needs visa sponsorship: for UK jobs prefer employers on the register (uk_register exact/possible); agencies are acceptable but mention it; never save ads that say sponsorship is not offered; avoid roles needing security clearance.
5. Stop when you have saved enough good jobs or the budget is nearly used, then call finish with a concise summary: what you searched, what you saved and why, and advice (titles to add, skill gaps).
Never invent jobs or ids. Keep your own text brief.`

const TOOLS: ToolDef[] = [
  {
    name: 'search_jobs',
    description: 'Search live job ads in one allowed country for one query. Returns up to 12 new results (not seen before) with id, title, company, location, kw (keyword score 0-100) and sponsor (UK register status). Uses 1 search from the budget.',
    parameters: {
      type: 'object',
      properties: {
        country: { type: 'string', description: 'Country code from the allowed list' },
        query: { type: 'string', description: 'Job title or keywords' },
        max_days_old: { type: 'integer', description: 'Only ads newer than this many days (1-30, default 14)' },
      },
      required: ['country', 'query'],
    },
  },
  {
    name: 'score_jobs',
    description: 'AI fit score (0-100) for up to 10 job ids against the candidate CV, plus what the ad says about visa sponsorship and whether the advertiser looks like a recruitment agency.',
    parameters: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' } } }, required: ['ids'] },
  },
  {
    name: 'save_job',
    description: "Save a scored job to the candidate's workspace as an agent pick for them to review.",
    parameters: {
      type: 'object',
      properties: { id: { type: 'string' }, reason: { type: 'string', description: 'Why this is a good pick, max 25 words' } },
      required: ['id', 'reason'],
    },
  },
  {
    name: 'finish',
    description: 'End the run with a short summary for the candidate.',
    parameters: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'] },
  },
]

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// Retry on rate limits (429), waiting as long as the provider asks (max 3 tries)
async function withRetry<T>(fn: () => Promise<T>, emit: (k: AgentLog['kind'], t: string) => void): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (attempt >= 5 || !/\b(429|503)\b|rate limit|try again|overloaded|unavailable/i.test(msg)) throw e
      const m = msg.match(/in (?:(\d+)m)?([\d.]+)s/)
      const wait = /tokens per minute|TPM/i.test(msg) ? 60000 : m ? (Number(m[1] ?? 0) * 60 + Number(m[2])) * 1000 + 500 : 10000
      emit('error', `AI provider busy or rate-limited, retrying in ${Math.round(wait / 1000)}s…`)
      await sleep(Math.min(wait, 70000))
    }
  }
}

export async function runAgent(profile: ScoreProfile, opts: AgentOptions): Promise<AgentResult> {
  const minScore = opts.minScore ?? 70
  const maxSaves = opts.maxSaves ?? 10
  const maxSearches = opts.maxSearches ?? 12
  const maxSteps = opts.maxSteps ?? 20
  const countries = opts.countries.filter(c => countryInfo(c)?.adzuna)
  if (!countries.length) throw new Error('Pick at least one supported country')
  if (!list(profile.targetTitles).length) throw new Error('Add target titles to your profile first')

  const log: AgentLog[] = []
  const emit = (kind: AgentLog['kind'], text: string) => {
    const e = { at: new Date().toISOString(), kind, text }
    log.push(e)
    opts.onLog?.(e)
  }
  const pool = new Map<string, PoolItem>()
  const seen = new Set<string>()
  const saved: AgentResult['saved'] = []
  const skills = list(profile.skills)
  const titles = list(profile.targetTitles)
  let searches = 0
  let scored = 0
  let summary = ''

  const brief = (c: PoolItem) => ({ id: c.key, title: c.title, company: c.company, location: c.location.slice(0, 40), kw: c.keywordScore, sponsor: c.sponsor })

  async function exec(call: ToolCall): Promise<Record<string, unknown>> {
    const a = call.args
    switch (call.name) {
      case 'search_jobs': {
        if (searches >= maxSearches) return { error: 'Search budget used up. Score, save or finish.' }
        const country = String(a.country ?? '').toLowerCase()
        if (!countries.includes(country)) return { error: `Country not allowed. Use one of: ${countries.join(', ')}` }
        const query = String(a.query ?? '').trim()
        if (!query) return { error: 'Empty query' }
        searches++
        const days = Math.min(30, Math.max(1, Number(a.max_days_old) || 14))
        const jobs = await searchAdzuna(query, { country, maxDaysOld: days })
        const fresh: PoolItem[] = []
        for (const j of jobs) {
          const c: PoolItem = toCandidate(j, country, skills, titles)
          const k = `${c.country}|${c.title.toLowerCase()}|${normalizeCompany(c.company)}`
          if (seen.has(k)) continue
          seen.add(k)
          if (country === 'gb') {
            if (isAgency(c.company)) c.sponsor = 'agency'
            else {
              const m = await matchSponsor(c.company)
              c.sponsor = m.level
              if (m.level !== 'none') c.sponsorName = m.sponsors[0].name
            }
          }
          c.key = `j${pool.size + 1}`
          pool.set(c.key, c)
          fresh.push(c)
        }
        fresh.sort((x, y) => y.keywordScore - x.keywordScore)
        return { found: jobs.length, new: fresh.length, results: fresh.slice(0, 12).map(brief), searches_left: maxSearches - searches }
      }
      case 'score_jobs': {
        const ids = [...new Set((Array.isArray(a.ids) ? a.ids : []).map(String))].filter(id => pool.has(id)).slice(0, 10)
        if (!ids.length) return { error: 'No valid ids. Use ids from search_jobs results.' }
        const scores = await scoreCandidates(profile, ids.map(id => pool.get(id)!), { max: 10, batch: 10 })
        scored += ids.length
        return {
          scores: ids.map(id => {
            const c = pool.get(id)!
            const s = scores.get(id)
            if (s) c.ai = s
            return { id, title: c.title, score: s?.score ?? null, reason: s?.reason, ad_sponsorship: s?.sponsorship, agency: !!s?.agency || c.sponsor === 'agency', uk_register: c.country === 'gb' ? c.sponsor : 'n/a' }
          }),
        }
      }
      case 'save_job': {
        if (saved.length >= maxSaves) return { error: 'Save limit reached. Call finish.' }
        const c = pool.get(String(a.id))
        if (!c) return { error: 'Unknown id' }
        if (!c.ai) return { error: 'Score this job with score_jobs before saving.' }
        if (c.ai.score < minScore) return { error: `Score ${c.ai.score} is below the minimum ${minScore}.` }
        if (profile.visaSponsorship && c.ai.sponsorship === 'not offered') return { error: 'Ad says no sponsorship and the candidate needs sponsorship.' }
        const reason = String(a.reason ?? '').slice(0, 300)
        const { created } = await addJob({
          source: 'adzuna',
          url: c.url,
          title: c.title,
          company: c.company,
          location: c.country === 'gb' ? c.location : `${c.location}, ${countryInfo(c.country)?.name ?? c.country}`,
          salary: c.salary,
          description: c.snippet,
          postedAt: c.postedAt,
          notes: `Agent pick: ${reason}`,
          match: { score: c.ai.score, reason: c.ai.reason, sponsorship: c.ai.sponsorship },
          sponsor: c.country === 'gb'
            ? { level: c.sponsor === 'agency' || c.ai.agency ? 'agency' : c.sponsor === 'n/a' ? 'none' : c.sponsor, name: c.sponsorName }
            : undefined,
        })
        if (created) saved.push({ title: c.title, company: c.company, score: c.ai.score })
        return { saved: created, note: created ? 'Saved' : 'Already in workspace', saves_left: maxSaves - saved.length }
      }
      case 'finish':
        summary = String(a.summary ?? '')
        return { ok: true }
      default:
        return { error: `Unknown tool ${call.name}` }
    }
  }

  const describe = (name: string, r: Record<string, unknown>) => {
    if (r.error) return String(r.error)
    if (name === 'search_jobs') return `found ${r.found}, ${r.new} new (${r.searches_left} searches left)`
    if (name === 'score_jobs')
      return (r.scores as { title: string; score: number | null }[]).map(s => `${s.score ?? '?'} ${s.title}`).join(' | ')
    if (name === 'save_job') return `${r.note} (${r.saves_left} saves left)`
    return 'ok'
  }

  const allowed = countries.map(c => `${c} (${countryInfo(c)!.name})`).join(', ')
  const goal = `CANDIDATE
Target titles: ${profile.targetTitles}
Skills: ${profile.skills}
Preferred locations: ${profile.locations} (open to relocating)
Needs visa sponsorship: ${profile.visaSponsorship ? 'yes' : 'no'}

GOAL: Find and save up to ${maxSaves} of the best-fitting live jobs with AI score >= ${minScore}.
Allowed countries: ${allowed}
BUDGET: ${maxSearches} searches, ${maxSteps} steps.`

  emit('goal', `Countries: ${allowed} · min score ${minScore} · up to ${maxSaves} saves · ${maxSearches} searches`)
  const session = await startToolSession({ task: 'agent', system: SYSTEM, tools: TOOLS })
  let r: ToolReply = await withRetry(() => session.send({ text: goal }, opts.signal), emit)
  let steps = 0
  let nudged = false

  for (;;) {
    steps++
    if (r.text) emit('thought', r.text)
    if (!r.calls.length) {
      if (!summary) summary = r.text
      break
    }
    const results: { call: ToolCall; result: unknown }[] = []
    for (const call of r.calls) {
      emit('call', `${call.name}(${JSON.stringify(call.args)})`)
      let result: Record<string, unknown>
      try {
        result = await withRetry(() => exec(call), emit)
      } catch (e) {
        result = { error: e instanceof Error ? e.message : String(e) }
      }
      emit(result.error ? 'error' : 'result', describe(call.name, result))
      results.push({ call, result })
    }
    if (summary) break
    if (steps >= maxSteps) {
      if (nudged) break
      nudged = true
      r = await withRetry(() => session.send({ results, text: 'Step limit reached. Call finish now with your summary.' }, opts.signal), emit)
      continue
    }
    r = await withRetry(() => session.send({ results }, opts.signal), emit)
  }

  emit('done', summary || 'Finished without a summary.')
  const result: AgentResult = { summary, saved, searches, scored, steps, log }
  await setSetting('agent:lastRun', { at: new Date().toISOString(), result })
  return result
}
