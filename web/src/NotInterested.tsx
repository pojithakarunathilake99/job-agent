import { useState } from 'react'
import { dismissJob, getPrefs, jobKey, setPrefs } from './lib/memory'

const REASONS = ['Wrong location', 'Too senior', 'Too junior', 'Salary too low', 'Wrong skills/field', 'Agency', 'Not this company', 'Other']

export default function NotInterested({ title, company, onDone, notify }: {
  title: string
  company: string
  onDone: (key: string) => void
  notify?: (m: string) => void
}) {
  const [open, setOpen] = useState(false)

  async function pick(reason: string) {
    await dismissJob({ title, company, reason })
    if (reason === 'Not this company') {
      const p = await getPrefs()
      if (!p.excludeCompanies.some(c => c.toLowerCase() === company.toLowerCase()))
        await setPrefs({ ...p, excludeCompanies: [...p.excludeCompanies, company] })
    }
    notify?.(reason === 'Not this company'
      ? `Hidden. ${company} added to companies to avoid.`
      : `Hidden. The agent will learn from this (${reason.toLowerCase()}).`)
    setOpen(false)
    onDone(jobKey(title, company))
  }

  if (!open) return <button type="button" className="button small" onClick={() => setOpen(true)}>Not interested</button>
  return (
    <div className="flex flex-wrap gap-1" style={{ maxWidth: 380 }}>
      <span className="text-xs opacity-70" style={{ width: '100%' }}>Why? (helps the agent learn)</span>
      {REASONS.map(r => <button key={r} type="button" className="button small" onClick={() => void pick(r)}>{r}</button>)}
      <button type="button" className="text-link text-xs" onClick={() => setOpen(false)}>Cancel</button>
    </div>
  )
}
