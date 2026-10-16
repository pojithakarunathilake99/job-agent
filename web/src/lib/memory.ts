import { getSetting, listJobs, setSetting } from './db'
import { normalizeCompany } from './sponsors'

export type WorkMode = 'remote' | 'hybrid' | 'onsite'
export interface Prefs {
  minSalary?: number
  workModes: WorkMode[]
  excludeCompanies: string[]
  noAgencies: boolean
  noClearance: boolean
  notes: string
}
export const DEFAULT_PREFS: Prefs = { workModes: ['remote', 'hybrid', 'onsite'], excludeCompanies: [], noAgencies: false, noClearance: false, notes: '' }

export async function getPrefs(): Promise<Prefs> {
  return { ...DEFAULT_PREFS, ...((await getSetting<Partial<Prefs>>('prefs')) ?? {}) }
}
export async function setPrefs(p: Prefs) {
  await setSetting('prefs', p)
}

export function isExcludedCompany(company: string, prefs: Prefs) {
  const n = normalizeCompany(company)
  return prefs.excludeCompanies.some(x => {
    const e = normalizeCompany(x)
    return !!e && (n === e || n.startsWith(e + ' '))
  })
}

export function prefsText(p: Prefs): string {
  const lines: string[] = []
  if (p.minSalary) lines.push(`Minimum salary: ${p.minSalary.toLocaleString('en-GB')} per year (local currency); penalise jobs clearly below it.`)
  if (p.workModes.length && p.workModes.length < 3) lines.push(`Accepts only ${p.workModes.join(' / ')} work.`)
  if (p.noAgencies) lines.push('Wants direct employers only, not recruitment agencies.')
  if (p.noClearance) lines.push('Cannot obtain security clearance (SC/DV/NV etc.); roles requiring it are a poor fit.')
  if (p.excludeCompanies.length) lines.push(`Not interested in: ${p.excludeCompanies.join(', ')}.`)
  if (p.notes.trim()) lines.push(`Other preferences: ${p.notes.trim()}`)
  return lines.join('\n')
}

// ---- Dismissed jobs ("Not interested") ----
export interface Dismissed { key: string; title: string; company: string; reason: string; at: string }
export const jobKey = (title: string, company: string) => `${title.toLowerCase().trim()}|${normalizeCompany(company)}`

export async function getDismissed(): Promise<Dismissed[]> {
  return (await getSetting<Dismissed[]>('memory:dismissed')) ?? []
}
export async function dismissJob(d: { title: string; company: string; reason: string }) {
  const all = await getDismissed()
  const key = jobKey(d.title, d.company)
  if (all.some(x => x.key === key)) return
  all.unshift({ ...d, key, at: new Date().toISOString() })
  await setSetting('memory:dismissed', all.slice(0, 500))
}
export async function undismissJob(key: string) {
  await setSetting('memory:dismissed', (await getDismissed()).filter(d => d.key !== key))
}

// Text the agent and scorer read before working: preferences + what the user liked and rejected
export async function memorySummary(): Promise<string> {
  const [p, dis, jobs] = await Promise.all([getPrefs(), getDismissed(), listJobs()])
  const parts: string[] = []
  const pt = prefsText(p)
  if (pt) parts.push(`PREFERENCES\n${pt}`)
  const progressed = jobs.filter(j => j.status === 'applied' || j.status === 'interview' || j.status === 'offer')
  if (progressed.length)
    parts.push(`JOBS THEY APPLIED TO OR PROGRESSED WITH (good examples): ${progressed.slice(0, 10).map(j => `${j.title} @ ${j.company} [${j.status}]`).join('; ')}`)
  if (dis.length) {
    const counts = new Map<string, number>()
    for (const d of dis) counts.set(d.reason, (counts.get(d.reason) ?? 0) + 1)
    const reasons = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([r, n]) => `${r} (${n})`).join(', ')
    parts.push(`JOBS THEY REJECTED (avoid similar). Reasons: ${reasons}. Examples: ${dis.slice(0, 10).map(d => `${d.title} @ ${d.company} (${d.reason})`).join('; ')}`)
  }
  return parts.join('\n\n')
}
