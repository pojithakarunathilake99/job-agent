import { addJob, getSetting, updateJob, type Job, type JobSource } from './db'
import { matchSponsor } from './sponsors'
import { isAgency } from './discover'
import { announce, generateJSON } from './llm'

interface Incoming { source?: string; url?: string; title?: string; company?: string; location?: string; description?: string; postedAt?: string }
interface ProfileLike { targetTitles?: string; skills?: string; locations?: string; visaSponsorship?: boolean; cvText?: string }

const SOURCES: JobSource[] = ['linkedin', 'indeed', 'cvlibrary', 'adzuna', 'reed', 'manual']
const handled = new Set<string>() // guard against double-import

// Import a job sent by the extension via "#/import/<json>".
// Saves immediately and returns the id; sponsor check + AI score continue in the background.
export async function importFromHash(payload: string): Promise<string | null> {
  if (handled.has(payload)) return null
  handled.add(payload)

  let j: Incoming
  try {
    j = JSON.parse(decodeURIComponent(payload))
  } catch {
    announce('Could not read the job sent by the extension.')
    return null
  }
  if (!j?.url || !j?.title) {
    announce('The extension sent an incomplete job (missing title or link).')
    return null
  }

  const source = (SOURCES.includes(j.source as JobSource) ? j.source : 'manual') as JobSource
  const { job, created } = await addJob({
    source,
    url: j.url,
    title: j.title.slice(0, 200),
    company: (j.company || 'Unknown company').slice(0, 200),
    location: j.location || undefined,
    description: j.description?.slice(0, 20000),
    postedAt: j.postedAt,
  })
  if (!created) {
    announce(`Already in your Workspace: ${job.title}`)
    return job.id
  }

  announce(`Saved: ${job.title} at ${job.company}. Checking sponsor and scoring…`)
  void enrich(job)
  return job.id
}

async function enrich(job: Job) {
  // UK sponsor register (agencies hide the real employer)
  let sponsor: Job['sponsor']
  if (isAgency(job.company)) sponsor = { level: 'agency' }
  else {
    try {
      const m = await matchSponsor(job.company)
      sponsor = { level: m.level, name: m.level !== 'none' ? m.sponsors[0].name : undefined }
    } catch {
      sponsor = undefined
    }
  }
  if (sponsor) await updateJob(job.id, { sponsor })
  const sponsorText =
    sponsor?.level === 'exact' ? ' · Licensed UK sponsor' : sponsor?.level === 'possible' ? ' · Possible UK sponsor' : sponsor?.level === 'agency' ? ' · Agency' : ''

  // AI fit score using the full job description
  const profile = await getSetting<ProfileLike>('profile')
  if (!profile?.targetTitles?.trim()) {
    announce(`${job.title}${sponsorText}. Add your profile to get a fit score.`)
    return
  }
  try {
    const r = await generateJSON<{ score: number; reason: string; sponsorship: 'offered' | 'not offered' | 'not mentioned' }>({
      task: 'scoring',
      system: 'You assess job fit for a job seeker. Be strict and realistic about seniority and core skill gaps. Judge only from the text given.',
      prompt: `CANDIDATE
Target titles: ${profile.targetTitles}
Skills: ${profile.skills ?? ''}
Preferred locations: ${profile.locations ?? ''} (open to relocating)
Needs visa sponsorship: ${profile.visaSponsorship ? 'yes' : 'no'}
CV excerpt: ${(profile.cvText ?? '').slice(0, 1500)}

JOB
${job.title} | ${job.company} | ${job.location ?? ''}
${(job.description ?? '').slice(0, 6000)}

Return JSON {"score":0-100,"reason":"<max 25 words>","sponsorship":"offered"|"not offered"|"not mentioned"} ("sponsorship" = what the ad says about work visa sponsorship).`,
    })
    const score = Math.max(0, Math.min(100, Math.round(Number(r.score) || 0)))
    await updateJob(job.id, { match: { score, reason: r.reason ?? '', sponsorship: r.sponsorship ?? 'not mentioned' } })
    const visa = r.sponsorship === 'not offered' ? ' · Ad says no sponsorship' : ''
    announce(`Scored: ${job.title}. Fit ${score}${sponsorText}${visa}`)
  } catch (e) {
    announce(`${job.title}${sponsorText}. Couldn't score it: ${e instanceof Error ? e.message.slice(0, 120) : 'AI error'}`)
  }
}
