import { useEffect, useState, type CSSProperties } from 'react'
import { DEFAULT_PREFS, getPrefs, setPrefs, type Prefs, type WorkMode } from './lib/memory'

const inputStyle: CSSProperties = { padding: '6px 10px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)' }
const MODES: WorkMode[] = ['remote', 'hybrid', 'onsite']

export default function PreferencesPanel({ disabled }: { disabled?: boolean }) {
  const [p, setP] = useState<Prefs>(DEFAULT_PREFS)
  const [companies, setCompanies] = useState('')

  useEffect(() => {
    getPrefs().then(x => { setP(x); setCompanies(x.excludeCompanies.join(', ')) }).catch(() => {})
  }, [])

  const save = (next: Prefs) => { setP(next); void setPrefs(next) }
  const active = [p.minSalary, p.workModes.length < 3, p.noAgencies, p.noClearance, p.excludeCompanies.length, p.notes.trim()].filter(Boolean).length

  return (
    <details className="panel" style={{ padding: '12px 16px', marginBottom: 16 }}>
      <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
        🧠 Preferences &amp; memory <span className="text-xs opacity-60" style={{ fontWeight: 400 }}>· {active ? `${active} active` : 'none set'}</span>
      </summary>
      <p className="text-xs opacity-70" style={{ margin: '8px 0 12px' }}>
        The agent and AI scoring follow these on every run, together with the jobs you apply to or dismiss. Saved on this device.
      </p>
      <div className="flex flex-col gap-3 text-sm">
        <label className="flex flex-wrap items-center gap-2">Minimum salary (per year)
          <input type="number" min={0} step={1000} disabled={disabled} value={p.minSalary ?? ''} placeholder="e.g. 40000" style={{ ...inputStyle, width: 140 }}
            onChange={e => save({ ...p, minSalary: e.target.value ? Number(e.target.value) : undefined })} />
        </label>
        <div className="flex flex-wrap items-center gap-3">Work type
          {MODES.map(m => (
            <label key={m} className="flex items-center gap-1">
              <input type="checkbox" disabled={disabled} checked={p.workModes.includes(m)}
                onChange={e => save({ ...p, workModes: e.target.checked ? [...p.workModes, m] : p.workModes.filter(x => x !== m) })} />
              {m === 'onsite' ? 'On-site' : m[0].toUpperCase() + m.slice(1)}
            </label>
          ))}
        </div>
        <label className="flex items-center gap-2">
          <input type="checkbox" disabled={disabled} checked={p.noAgencies} onChange={e => save({ ...p, noAgencies: e.target.checked })} />
          Skip recruitment agencies (direct employers only)
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" disabled={disabled} checked={p.noClearance} onChange={e => save({ ...p, noClearance: e.target.checked })} />
          I can’t get security clearance (SC/DV): avoid roles that need it
        </label>
        <label className="flex flex-col gap-1">Companies to avoid (comma-separated)
          <input disabled={disabled} value={companies} placeholder="e.g. Acme Ltd, Example Recruitment" style={inputStyle}
            onChange={e => setCompanies(e.target.value)}
            onBlur={() => save({ ...p, excludeCompanies: companies.split(',').map(s => s.trim()).filter(Boolean) })} />
        </label>
        <label className="flex flex-col gap-1">Anything else the agent should know
          <textarea disabled={disabled} rows={2} value={p.notes} placeholder="e.g. Prefer product companies; no shift work; Midlands or remote" style={inputStyle}
            onChange={e => setP({ ...p, notes: e.target.value })}
            onBlur={() => void setPrefs(p)} />
        </label>
      </div>
    </details>
  )
}
