import { generateJSON } from './llm'

// Extract plain text from a CV file (PDF, DOCX, TXT) entirely in the browser
export async function extractCvText(file: File): Promise<string> {
  const name = file.name.toLowerCase()
  if (file.type === 'text/plain' || name.endsWith('.txt')) return (await file.text()).trim()

  const buf = await file.arrayBuffer()

  if (file.type === 'application/pdf' || name.endsWith('.pdf')) {
    const pdfjs = await import('pdfjs-dist')
    const { default: workerUrl } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
    const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise
    let out = ''
    for (let i = 1; i <= doc.numPages; i++) {
      const content = await (await doc.getPage(i)).getTextContent()
      for (const it of content.items) {
        if ('str' in it) out += it.str + (it.hasEOL ? '\n' : ' ')
      }
      out += '\n\n'
    }
    return out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  }

  if (name.endsWith('.docx')) {
    const mammoth = (await import('mammoth')).default
    const { value } = await mammoth.extractRawText({ arrayBuffer: buf })
    return value.trim()
  }

  throw new Error('Unsupported file. Use PDF, DOCX or TXT (old .doc: paste the text instead).')
}

export interface ExtractedProfile {
  name: string
  targetTitles: string[]
  skills: string[]
  locations: string[]
  summary: string
}

// Turn CV text into structured profile fields using the writing model
export async function extractProfile(cvText: string): Promise<ExtractedProfile> {
  const r = await generateJSON<Partial<ExtractedProfile>>({
    task: 'writing',
    system:
      'You extract structured data from CVs for a UK job search tool. Use only information in the CV; never invent experience.',
    prompt: `From the CV below, return JSON with:
- "name": candidate's full name
- "targetTitles": 3-6 realistic UK job titles this person should search for, based on their actual experience and seniority
- "skills": up to 30 concrete technical skills, tools, languages and platforms (short terms, most relevant first)
- "locations": current location(s) stated in the CV
- "summary": 2-3 sentence professional summary

CV:
"""
${cvText.slice(0, 30000)}
"""`,
  })
  return {
    name: r.name ?? '',
    targetTitles: r.targetTitles ?? [],
    skills: r.skills ?? [],
    locations: r.locations ?? [],
    summary: r.summary ?? '',
  }
}
