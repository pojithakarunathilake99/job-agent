import { getSetting } from './db'

export type Provider = 'gemini'
export type Task = 'scoring' | 'writing'

export interface LLMConfig { provider: Provider; scoringModel: string; writingModel: string }
export const DEFAULT_LLM: LLMConfig = {
  provider: 'gemini',
  scoringModel: 'gemini-3.5-flash-lite',
  writingModel: 'gemini-3.8-flash',
}

// Settings: "llm" = LLMConfig overrides; API key in "secret:<provider>" (never exported)
export async function getLLMConfig(): Promise<LLMConfig> {
  return { ...DEFAULT_LLM, ...(await getSetting<Partial<LLMConfig>>('llm')) }
}

interface GenOpts { task: Task; prompt: string; system?: string; json?: boolean; signal?: AbortSignal }
type Adapter = (o: GenOpts & { model: string; key: string }) => Promise<string>

const gemini: Adapter = async ({ model, key, prompt, system, json, signal }) => {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: json ? { responseMimeType: 'application/json' } : {},
      }),
    },
  )
  const data = await res.json()
  if (!res.ok) throw new Error(`Gemini ${res.status} (${model}): ${data?.error?.message ?? 'request failed'}`)
  const text = (data?.candidates?.[0]?.content?.parts ?? [])
    .map((p: { text?: string }) => p.text ?? '')
    .join('')
  if (!text) throw new Error('Empty response: ' + (data?.candidates?.[0]?.finishReason ?? 'unknown'))
  return text
}

const adapters: Record<Provider, Adapter> = { gemini }

export async function generate(o: GenOpts): Promise<string> {
  const cfg = await getLLMConfig()
  const key = await getSetting<string>(`secret:${cfg.provider}`)
  if (!key) throw new Error(`No API key set for ${cfg.provider}`)
  const model = o.task === 'scoring' ? cfg.scoringModel : cfg.writingModel
  return adapters[cfg.provider]({ ...o, model, key })
}

export async function generateJSON<T>(o: Omit<GenOpts, 'json'>): Promise<T> {
  const text = await generate({ ...o, json: true })
  try {
    return JSON.parse(text) as T
  } catch {
    const m = text.match(/\{[\s\S]*\}/)
    if (m) return JSON.parse(m[0]) as T
    throw new Error('Model did not return valid JSON')
  }
}
