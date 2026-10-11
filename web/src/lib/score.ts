import { generateJSON } from './llm'
import type { Candidate } from './discover'

export interface AIScore {
  score: number
  reason: string
  sponsorship: 'offered' | 'not offered' | 'not mentioned'
  agency: boolean
}
export interface ScoreProfile { targetTitles: string; skills: string; locations: string; visaSponsorship: boolean; cvText?: string }

// Score candidates in batches with the cheap scoring model; returns a map keyed by Candidate.key
export async function scoreCandidates(
  profile: ScoreProfile,
  candidates: Candidate[],
  opts: { max?: number; batch?: number; onProgress?: (done: number, total: number) => void } = {},
): Promise<Map<string, AIScore>> {
  const list = candidates.slice(0, opts.max ?? 40)
  const size = opts.batch ?? 10
  const out = new Map<string, AIScore>()
  const who = `Target titles: ${profile.targetTitles}
Skills: ${profile.skills}
Preferred locations: ${profile.locations} (open to relocating within the UK)
Needs visa sponsorship: ${profile.visaSponsorship ? 'yes' : 'no'}
CV excerpt: ${(profile.cvText ?? '').slice(0, 4000)}`

  for (let i = 0; i < list.length; i += size) {
    const chunk = list.slice(i, i + size)
    const jobs = chunk
      .map((c, n) => `#${n} ${c.title} | ${c.company} | ${c.location}${c.salary ? ' | ' + c.salary : ''}\n${c.snippet}`)
      .join('\n\n')
    const r = await generateJSON<{ results: ({ i: number } & AIScore)[] }>({
      task: 'scoring',
      system:
        'You assess job fit for a UK job seeker. Be strict and realistic about seniority and core skill gaps. Judge only from the text given.',
      prompt: `CANDIDATE
${who}

JOBS (short ad snippets)
${jobs}

For EVERY job return JSON {"results":[{"i":<job number>,"score":0-100,"reason":"<max 20 words>","sponsorship":"offered"|"not offered"|"not mentioned","agency":true|false}]}.
"agency" is true if the advertiser appears to be a recruitment agency rather than the employer.
"sponsorship" reflects only what the ad text says about UK visa sponsorship.`,
    })
    for (const x of r.results ?? []) {
      const c = chunk[x.i]
      if (c) out.set(c.key, { score: Math.max(0, Math.min(100, Math.round(x.score))), reason: x.reason ?? '', sponsorship: x.sponsorship ?? 'not mentioned', agency: !!x.agency })
    }
    opts.onProgress?.(Math.min(i + size, list.length), list.length)
  }
  return out
}
