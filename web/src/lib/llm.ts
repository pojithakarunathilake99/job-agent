import { getSetting } from './db'

export type Provider = 'gemini' | 'groq' | 'openrouter'
export type Task = 'scoring' | 'writing' | 'agent'

export interface LLMConfig { provider: Provider; scoringModel: string; writingModel: string }
export const DEFAULT_LLM: LLMConfig = {
  provider: 'gemini',
  scoringModel: 'gemini-3.5-flash-lite',
  writingModel: 'gemini-3.5-flash-lite',
}

// Settings: "llm" = LLMConfig overrides; API key in "secret:<provider>" (never exported)
export const PROVIDER_DEFAULTS: Record<Provider, { scoringModel: string; writingModel: string }> = {
  gemini: { scoringModel: 'gemini-3.5-flash-lite', writingModel: 'gemini-3.5-flash-lite' },
  groq: { scoringModel: 'openai/gpt-oss-20b', writingModel: 'openai/gpt-oss-120b' },
  openrouter: { scoringModel: 'nvidia/nemotron-3-super-120b-a12b:free', writingModel: 'nvidia/nemotron-3-super-120b-a12b:free' },
}
const belongs = (p: Provider, m?: string) =>
  !!m && (p === 'gemini' ? m.startsWith('gemini') : p === 'openrouter' ? m.endsWith(':free') : !m.startsWith('gemini') && !m.endsWith(':free'))

// Saved models are only used if they belong to the selected provider; otherwise provider defaults
export async function getLLMConfig(): Promise<LLMConfig> {
  const s = (await getSetting<Partial<LLMConfig>>('llm')) ?? {}
  const provider: Provider = s.provider === 'groq' || s.provider === 'openrouter' ? s.provider : 'gemini'
  const d = PROVIDER_DEFAULTS[provider]
  return {
    provider,
    scoringModel: belongs(provider, s.scoringModel) ? s.scoringModel! : d.scoringModel,
    writingModel: belongs(provider, s.writingModel) ? s.writingModel! : d.writingModel,
  }
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

// ---------- Groq (OpenAI-compatible) ----------
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'
const isReasoning = (model: string) => model.includes('gpt-oss')

async function groqChat(key: string, body: Record<string, unknown>, signal?: AbortSignal) {
  const res = await fetch(GROQ_URL, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(`Groq ${res.status} (${String(body.model)}): ${data?.error?.message ?? 'request failed'}`)
  return data
}

const groqGenerate: Adapter = async ({ model, key, prompt, system, json, signal }) => {
  const data = await groqChat(key, {
    model,
    messages: [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content: prompt }],
    ...(json ? { response_format: { type: 'json_object' } } : {}),
    ...(isReasoning(model) ? { reasoning_effort: 'low' } : {}),
    max_completion_tokens: 4096,
  }, signal)
  const text = data?.choices?.[0]?.message?.content ?? ''
  if (!text) throw new Error('Empty response: ' + (data?.choices?.[0]?.finish_reason ?? 'unknown'))
  return text
}

// ---------- OpenRouter (free models only) ----------
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'

async function openrouterChat(key: string, body: Record<string, unknown>, signal?: AbortSignal) {
  const model = String(body.model)
  if (!model.endsWith(':free')) throw new Error(`Only free OpenRouter models are allowed (got ${model}). Use a model ID ending in :free.`)
  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
      'HTTP-Referer': location.origin,
      'X-Title': 'RoleScout',
    },
    body: JSON.stringify(body),
  })
  const data = await res.json()
  if (!res.ok || data?.error) {
    const raw = data?.error?.metadata?.raw ? ` ${String(data.error.metadata.raw)}` : ''
    throw new Error(`OpenRouter ${res.status} (${model}): ${data?.error?.message ?? 'request failed'}${raw}`)
  }
  return data
}

const openrouterGenerate: Adapter = async ({ model, key, prompt, system, json, signal }) => {
  const data = await openrouterChat(key, {
    model,
    messages: [
      ...(system ? [{ role: 'system', content: system }] : []),
      { role: 'user', content: json ? `${prompt}\n\nReply with valid JSON only, no other text.` : prompt },
    ],
    max_tokens: 4096,
  }, signal)
  const text = data?.choices?.[0]?.message?.content ?? ''
  if (!text) throw new Error('Empty response: ' + (data?.choices?.[0]?.finish_reason ?? 'unknown'))
  return text
}

const adapters: Record<Provider, Adapter> = { gemini, groq: groqGenerate, openrouter: openrouterGenerate }

// Per-task routing: setting "llm:routes" = { scoring?: {provider, model?}, writing?: ..., agent?: ... }
export type Routes = Partial<Record<Task, { provider: Provider; model?: string }>>

export async function resolveTask(task: Task): Promise<{ provider: Provider; model: string; key: string }> {
  const routes = (await getSetting<Routes>('llm:routes')) ?? {}
  const route = routes[task]
  let provider: Provider
  let model: string
  if (route) {
    provider = route.provider
    const d = PROVIDER_DEFAULTS[provider]
    model = route.model ?? (task === 'scoring' ? d.scoringModel : d.writingModel)
  } else {
    const cfg = await getLLMConfig()
    provider = cfg.provider
    model = task === 'scoring' ? cfg.scoringModel : cfg.writingModel
  }
  const key = await getSetting<string>(`secret:${provider}`)
  if (!key) throw new Error(`No API key set for ${provider}`)
  return { provider, model, key }
}

export async function generate(o: GenOpts): Promise<string> {
  const { provider, model, key } = await resolveTask(o.task)
  return adapters[provider]({ ...o, model, key })
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

// ---------- Tool calling (agent) ----------
export interface ToolDef { name: string; description: string; parameters: Record<string, unknown> }
export interface ToolCall { id?: string; name: string; args: Record<string, unknown> }
export interface ToolReply { text: string; calls: ToolCall[]; usage: { input: number; output: number } }
export interface ToolSession {
  send(input: { text?: string; results?: { call: ToolCall; result: unknown }[] }, signal?: AbortSignal): Promise<ToolReply>
}

type ToolSessionFactory = (o: { model: string; key: string; system: string; tools: ToolDef[] }) => ToolSession

interface GeminiPart {
  text?: string
  thought?: boolean
  functionCall?: { id?: string; name: string; args?: Record<string, unknown> }
  [k: string]: unknown
}
interface GeminiContent { role: 'user' | 'model'; parts: GeminiPart[] }

const geminiTools: ToolSessionFactory = ({ model, key, system, tools }) => {
  const contents: GeminiContent[] = []
  return {
    async send(input, signal) {
      const parts: GeminiPart[] = []
      for (const r of input.results ?? [])
        parts.push({ functionResponse: { name: r.call.name, ...(r.call.id ? { id: r.call.id } : {}), response: { result: r.result } } })
      if (input.text) parts.push({ text: input.text })
      if (!parts.length) throw new Error('Nothing to send')
      contents.push({ role: 'user', parts })

      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        {
          method: 'POST',
          signal,
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: system }] },
            contents,
            tools: [{ functionDeclarations: tools }],
          }),
        },
      )
      const data = await res.json()
      if (!res.ok) throw new Error(`Gemini ${res.status} (${model}): ${data?.error?.message ?? 'request failed'}`)
      const content = data?.candidates?.[0]?.content as GeminiContent | undefined
      if (!content?.parts?.length) throw new Error('Empty response: ' + (data?.candidates?.[0]?.finishReason ?? 'unknown'))
      // Keep the model turn exactly as returned (preserves thought signatures for multi-step tool use)
      contents.push({ role: 'model', parts: content.parts })

      return {
        text: content.parts.filter(p => !p.thought).map(p => p.text ?? '').join('').trim(),
        calls: content.parts
          .filter(p => p.functionCall)
          .map(p => ({ id: p.functionCall!.id, name: p.functionCall!.name, args: p.functionCall!.args ?? {} })),
        usage: {
          input: data?.usageMetadata?.promptTokenCount ?? 0,
          output: (data?.usageMetadata?.candidatesTokenCount ?? 0) + (data?.usageMetadata?.thoughtsTokenCount ?? 0),
        },
      }
    },
  }
}

interface OAIToolCall { id: string; type: 'function'; function: { name: string; arguments: string } }
interface OAIMessage { role: 'system' | 'user' | 'assistant' | 'tool'; content: string | null; tool_calls?: OAIToolCall[]; tool_call_id?: string }
const safeParse = (s: string) => { try { return JSON.parse(s || '{}') as Record<string, unknown> } catch { return {} } }

const groqTools: ToolSessionFactory = ({ model, key, system, tools }) => {
  const messages: OAIMessage[] = [{ role: 'system', content: system }]
  const toolSpec = tools.map(t => ({ type: 'function', function: t }))
  return {
    async send(input, signal) {
      for (const r of input.results ?? [])
        messages.push({ role: 'tool', tool_call_id: r.call.id ?? '', content: JSON.stringify(r.result) })
      if (input.text) messages.push({ role: 'user', content: input.text })
      const data = await groqChat(key, {
        model,
        messages,
        tools: toolSpec,
        ...(isReasoning(model) ? { reasoning_effort: 'medium' } : {}),
        max_completion_tokens: 4096,
      }, signal)
      const msg = data?.choices?.[0]?.message
      if (!msg) throw new Error('Empty response: ' + (data?.choices?.[0]?.finish_reason ?? 'unknown'))
      messages.push({ role: 'assistant', content: msg.content ?? null, ...(msg.tool_calls ? { tool_calls: msg.tool_calls } : {}) })
      return {
        text: (msg.content ?? '').trim(),
        calls: ((msg.tool_calls ?? []) as OAIToolCall[]).map(c => ({ id: c.id, name: c.function.name, args: safeParse(c.function.arguments) })),
        usage: { input: data?.usage?.prompt_tokens ?? 0, output: data?.usage?.completion_tokens ?? 0 },
      }
    },
  }
}

const openrouterTools: ToolSessionFactory = ({ model, key, system, tools }) => {
  const messages: OAIMessage[] = [{ role: 'system', content: system }]
  const toolSpec = tools.map(t => ({ type: 'function', function: t }))
  return {
    async send(input, signal) {
      for (const r of input.results ?? [])
        messages.push({ role: 'tool', tool_call_id: r.call.id ?? '', content: JSON.stringify(r.result) })
      if (input.text) messages.push({ role: 'user', content: input.text })
      const data = await openrouterChat(key, { model, messages, tools: toolSpec, max_tokens: 4096 }, signal)
      const msg = data?.choices?.[0]?.message
      if (!msg) throw new Error('Empty response: ' + (data?.choices?.[0]?.finish_reason ?? 'unknown'))
      messages.push({ role: 'assistant', content: msg.content ?? null, ...(msg.tool_calls ? { tool_calls: msg.tool_calls } : {}) })
      return {
        text: (msg.content ?? '').trim(),
        calls: ((msg.tool_calls ?? []) as OAIToolCall[]).map(c => ({ id: c.id, name: c.function.name, args: safeParse(c.function.arguments) })),
        usage: { input: data?.usage?.prompt_tokens ?? 0, output: data?.usage?.completion_tokens ?? 0 },
      }
    },
  }
}

const toolFactories: Record<Provider, ToolSessionFactory> = { gemini: geminiTools, groq: groqTools, openrouter: openrouterTools }

export async function startToolSession(o: { task: Task; system: string; tools: ToolDef[] }): Promise<ToolSession> {
  const { provider, model, key } = await resolveTask(o.task)
  return toolFactories[provider]({ model, key, system: o.system, tools: o.tools })
}
