import { getSetting } from './db'
import { matchSponsor, normalizeCompany, type SponsorMatch } from './sponsors'

export interface Candidate {
  key: string
  source: 'adzuna'
  url: string
  title: string
  company: string
  location: string
  salary?: string
  snippet: string
  postedAt?: string
  keywordScore: number
  sponsor: SponsorMatch['level'] | 'agency'
  sponsorName?: string
}

export interface DiscoverInput { targetTitles: string; skills: string; where?: string; maxDaysOld?: number }

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

const strip = (s = '') =>
  s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim()
// Recruitment agencies: the real employer is hidden, so sponsor status is unknown
export const isAgency = (company: string) =>
  /\b(recruit\w*|resourcing|staffing|talent|personnel|selection|headhunt\w*|employment|search)\b/i.test(company)

const list = (s = '') => s.split(/[,\n]/).map(x => x.trim()).filter(Boolean)
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export async function searchAdzuna(
  what: string,
  opts: { where?: string; maxDaysOld?: number; perPage?: number } = {},
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
  if (opts.where) p.set('where', opts.where)
  const res = await fetch(`https://api.adzuna.com/v1/api/jobs/gb/search/1?${p}`)
  if (!res.ok) throw new Error(`Adzuna ${res.status}: check app ID/key`)
  return ((await res.json()).results ?? []) as AdzunaJob[]
}

function salaryText(j: AdzunaJob) {
  if (!j.salary_min && !j.salary_max) return undefined
  const f = (n?: number) => (n ? '£' + Math.round(n).toLocaleString('en-GB') : '')
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
  const titles = list(input.targetTitles).slice(0, 5)
  const skills = list(input.skills)
  if (!titles.length) throw new Error('Add target titles to your profile first')
  const seen = new Map<string, Candidate>()
  for (const q of titles) {
    onProgress?.(`Searching Adzuna: ${q}`)
    for (const j of await searchAdzuna(q, { where: input.where, maxDaysOld: input.maxDaysOld })) {
      const title = strip(j.title)
      const company = strip(j.company?.display_name ?? '')
      const snippet = strip(j.description)
      const k = `${title.toLowerCase()}|${normalizeCompany(company)}`
      if (seen.has(k)) continue
      seen.set(k, {
        key: `adzuna:${j.id}`,
        source: 'adzuna',
        url: j.redirect_url,
        title,
        company,
        location: strip(j.location?.display_name ?? ''),
        salary: salaryText(j),
        snippet,
        postedAt: j.created,
        keywordScore: keywordScore(`${title} ${snippet}`, title, skills, titles),
        sponsor: 'none',
      })
    }
  }
  onProgress?.('Checking sponsor register')
  const out = [...seen.values()]
  await Promise.all(
    out.map(async c => {
      if (isAgency(c.company)) { c.sponsor = 'agency'; return }
      const m = await matchSponsor(c.company)
      c.sponsor = m.level
      if (m.level !== 'none') c.sponsorName = m.sponsors[0].name
    }),
  )
  return out.sort((a, b) => b.keywordScore - a.keywordScore)
}
