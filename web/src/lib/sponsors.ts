// UK Home Office sponsor register lookup (data/sponsors.json, built by scripts/build-sponsors.mjs)

const SUFFIX = /\b(limited|ltd|plc|llp|lp|inc|incorporated|co|company|corp|corporation|the)\b/g
export const normalizeCompany = (s: string) =>
  s.toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(SUFFIX, ' ')
    .replace(/\s+/g, ' ')
    .trim()

export interface Sponsor { name: string; town: string; county: string; types: string[]; routes: string[] }
export type SponsorMatch =
  | { level: 'exact'; sponsors: Sponsor[] }
  | { level: 'possible'; sponsors: Sponsor[] }
  | { level: 'none' }

interface Raw {
  registerDate: string
  types: string[]
  routes: string[]
  sponsors: [string, string, string, number[], number[]][]
}

let loaded: Promise<{ date: string; byNorm: Map<string, Sponsor[]>; norms: string[] }> | null = null

export function loadSponsors() {
  return (loaded ??= (async () => {
    const res = await fetch(`${import.meta.env.BASE_URL}data/sponsors.json`)
    if (!res.ok) throw new Error(`Sponsor register not available (${res.status})`)
    const raw = (await res.json()) as Raw
    const byNorm = new Map<string, Sponsor[]>()
    for (const [name, town, county, t, r] of raw.sponsors) {
      const n = normalizeCompany(name)
      if (!n) continue
      const s: Sponsor = { name, town, county, types: t.map(i => raw.types[i]), routes: r.map(i => raw.routes[i]) }
      const list = byNorm.get(n)
      if (list) list.push(s)
      else byNorm.set(n, [s])
    }
    return { date: raw.registerDate, byNorm, norms: [...byNorm.keys()].sort() }
  })())
}

// exact = same normalised name; possible = register name starts with the company name (e.g. "Arm" -> "Arm Transport")
export async function matchSponsor(company: string): Promise<SponsorMatch> {
  const n = normalizeCompany(company)
  if (!n) return { level: 'none' }
  const { byNorm, norms } = await loadSponsors()
  const exact = byNorm.get(n)
  if (exact) return { level: 'exact', sponsors: exact }
  const prefix = n + ' '
  const out: Sponsor[] = []
  // binary search to the first name >= prefix, then walk while it matches
  let lo = 0, hi = norms.length
  while (lo < hi) { const mid = (lo + hi) >> 1; if (norms[mid] < prefix) lo = mid + 1; else hi = mid }
  for (let i = lo; i < norms.length && norms[i].startsWith(prefix) && out.length < 5; i++) out.push(...byNorm.get(norms[i])!)
  return out.length ? { level: 'possible', sponsors: out.slice(0, 5) } : { level: 'none' }
}
