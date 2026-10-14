import { getSetting } from './db'
import { matchSponsor, normalizeCompany, type SponsorMatch } from './sponsors'
import { countryInfo } from './countries'

export interface Candidate {
  key: string
  source: 'adzuna'
  country: string
  url: string
  title: string
  company: string
  location: string
  salary?: string
  snippet: string
  postedAt?: string
  keywordScore: number
  sponsor: SponsorMatch['level'] | 'agency' | 'n/a'
  sponsorName?: string
}

export interface DiscoverInput { targetTitles: string; skills: string; countries?: string[]; maxDaysOld?: number }

interface AdzunaJob {
  id: string
  title: string
  description: string
  redirect_url: string
  created: string
  company?: { display_name?: string }
  location?: { display_name?: string }
  salary_min?: number
  salary_max?: number
  salary_is_predicted?: string
}

export const MAX_SEARCHES = 20

const strip = (s = '') =>
  s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim()

// Recruitment agencies: the real employer is hidden, so sponsor status is unknown
export const isAgency = (company: string) =>
  /\b(recruit\w*|resourcing|staffing|talent|personnel|selection|headhunt\w*|employment|search)\b/i.test(company)

export const list = (s = '') => s.split(/[,\n]/).map(x => x.trim()).filter(Boolean)
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// How many titles to search per country, keeping total searches <= MAX_SEARCHES
export function planSearches(targetTitles: string, countries: string[]) {
  const titles = list(targetTitles).slice(0, 5)
  const cs = countries.filter(c => countryInfo(c)?.adzuna)
  const perCountry = cs.length ? Math.max(1, Math.min(titles.length, Math.floor(MAX_SEARCHES / cs.length))) : 0
  return { titles: titles.slice(0, perCountry), countries: cs, total: perCountry * cs.length }
}

export async function searchAdzuna(
  what: string,
  opts: { country?: string; maxDaysOld?: number; perPage?: number } = {},
): Promise<AdzunaJob[]> {
  const [id, key] = await Promise.all([getSetting<string>('secret:adzunaId'), getSetting<string>('secret:adzuna')])
  if (!id || !key) throw new Error('Add your Adzuna app ID and key in Settings')
  const p = new URLSearchParams({
    app_id: id,
    app_key: key,
    what,
    results_per_page: String(opts.perPage ?? 50),
    max_days_old: String(opts.maxDaysOld ?? 14),
  })
  const res = await fetch(`https://api.adzuna.com/v1/api/jobs/${opts.country ?? 'gb'}/search/1?${p}`)
  if (!res.ok) throw new Error(`Adzuna ${res.status}: check app ID/key`)
  return ((await res.json()).results ?? []) as AdzunaJob[]
}

function salaryText(j: AdzunaJob, symbol: string) {
  if (!j.salary_min && !j.salary_max) return undefined
  const f = (n?: number) => (n ? symbol + Math.round(n).toLocaleString('en-GB') : '')
  const range = !j.salary_max || j.salary_min === j.salary_max ? f(j.salary_min || j.salary_max) : `${f(j.salary_min)}–${f(j.salary_max)}`
  return j.salary_is_predicted === '1' ? `${range} (estimated)` : range
}

// 0-100: up to 70 for skill hits (capped at 10 skills), 30 if all words of a target title appear in the job title
export function keywordScore(text: string, title: string, skills: string[], titles: string[]) {
  const t = text.toLowerCase()
  const ti = title.toLowerCase()
  const has = (k: string) => new RegExp(`(^|[^a-z0-9])${escapeRe(k.toLowerCase())}([^a-z0-9]|$)`).test(t)
  const skillPart = skills.length ? Math.min(1, skills.filter(has).length / Math.min(skills.length, 10)) : 0
  const titleHit = titles.some(x => {
    const words = x.toLowerCase().split(/\s+/).filter(w => w.length > 2)
    return words.length > 0 && words.every(w => ti.includes(w))
  })
  return Math.round(skillPart * 70 + (titleHit ? 30 : 0))
}

export async function discover(input: DiscoverInput, onProgress?: (msg: string) => void): Promise<Candidate[]> {
  const plan = planSearches(input.targetTitles, input.countries?.length ? input.countries : ['gb'])
  const allTitles = list(input.targetTitles)
  const skills = list(input.skills)
  if (!plan.titles.length) throw new Error('Add target titles to your profile first')
  if (!plan.countries.length) throw new Error('Pick at least one supported country')

  const seen = new Map<string, Candidate>()
  for (const cc of plan.countries) {
    const info = countryInfo(cc)!
    for (const q of plan.titles) {
      onProgress?.(`Searching ${info.name}: ${q}`)
      for (const j of await searchAdzuna(q, { country: cc, maxDaysOld: input.maxDaysOld })) {
        const title = strip(j.title)
        const company = strip(j.company?.display_name ?? '')
        const snippet = strip(j.description)
        const k = `${cc}|${title.toLowerCase()}|${normalizeCompany(company)}`
        if (seen.has(k)) continue
        seen.set(k, {
          key: `adzuna:${cc}:${j.id}`,
          source: 'adzuna',
          country: cc,
          url: j.redirect_url,
          title,
          company,
          location: strip(j.location?.display_name ?? ''),
          salary: salaryText(j, info.symbol),
          snippet,
          postedAt: j.created,
          keywordScore: keywordScore(`${title} ${snippet}`, title, skills, allTitles),
          sponsor: 'n/a',
        })
      }
    }
  }

  onProgress?.('Checking UK sponsor register')
  const out = [...seen.values()]
  await Promise.all(
    out.filter(c => c.country === 'gb').map(async c => {
      if (isAgency(c.company)) { c.sponsor = 'agency'; return }
      const m = await matchSponsor(c.company)
      c.sponsor = m.level
      if (m.level !== 'none') c.sponsorName = m.sponsors[0].name
    }),
  )
  return out.sort((a, b) => b.keywordScore - a.keywordScore)
}

export function toCandidate(j: AdzunaJob, cc: string, skills: string[], titles: string[]): Candidate {
  const info = countryInfo(cc)
  const title = strip(j.title)
  const company = strip(j.company?.display_name ?? '')
  const snippet = strip(j.description)
  return {
    key: `adzuna:${cc}:${j.id}`,
    source: 'adzuna',
    country: cc,
    url: j.redirect_url,
    title,
    company,
    location: strip(j.location?.display_name ?? ''),
    salary: salaryText(j, info?.symbol ?? ''),
    snippet,
    postedAt: j.created,
    keywordScore: keywordScore(`${title} ${snippet}`, title, skills, titles),
    sponsor: 'n/a',
  }
}
