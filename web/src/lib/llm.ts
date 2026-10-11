import { getSetting } from './db'

export interface LLMConfig {
  scoringModel: string
  writingModel: string
}

const DEFAULT_CONFIG: LLMConfig = {
  scoringModel: 'gemini-3.5-flash-lite',
  writingModel: 'gemini-3.8-flash',
}

export async function getLLMConfig(): Promise<LLMConfig> {
  const saved = await getSetting<Partial<LLMConfig>>('llmConfig')
  return {
    scoringModel: saved?.scoringModel || DEFAULT_CONFIG.scoringModel,
    writingModel: saved?.writingModel || DEFAULT_CONFIG.writingModel,
  }
}

export async function generateJSON<T>(
  prompt: string,
  options: { model?: string } = {},
): Promise<T> {
  const apiKey = await getSetting<string>('secret:gemini')
  if (!apiKey?.trim()) {
    throw new Error('Add your Gemini API key in Settings before testing Gemini.')
  }

  const config = await getLLMConfig()
  const model = options.model || config.scoringModel
  let response: Response
  try {
    response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json' },
        }),
      },
    )
  } catch {
    throw new Error('Gemini could not be reached. Check your connection and try again.')
  }

  if (!response.ok) {
    throw new Error(`Gemini returned an error (${response.status}). Check your key and model name.`)
  }

  const result = (await response.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[]
  }
  const text = result.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('').trim()
  if (!text) throw new Error('Gemini returned an empty response.')

  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error('Gemini returned a response that was not valid JSON.')
  }
}
