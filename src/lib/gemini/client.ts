// Gemini の呼び出し（仕様書 7-3・12 章）。generateContent を fetch で直接呼ぶ（SDK は入れない）。
// 後で別の API に差し替えられるよう、呼び出しはこのファイルに閉じ込める
import { GEMINI_ENDPOINT, MODELS } from '../config.ts'

export type GeminiErrorKind =
  | 'no-key'
  | 'timeout'
  | 'aborted'
  | 'network'
  | 'quota'
  | 'auth'
  | 'bad-request'
  | 'model'
  | 'server'
  | 'bad-response'

export class GeminiError extends Error {
  readonly kind: GeminiErrorKind
  readonly status?: number

  constructor(kind: GeminiErrorKind, message?: string, status?: number) {
    super(message ?? kind)
    this.name = 'GeminiError'
    this.kind = kind
    this.status = status
  }
}

export type FormatStyle = 'responseFormat' | 'responseJsonSchema'

export interface GeminiRequest {
  apiKey?: string
  model: string
  system: string
  user: string
  schema: Record<string, unknown>
  timeoutMs: number
  format?: FormatStyle // 既定 'responseFormat'
  thinkingLevelCase?: 'upper' | 'lower' // 既定 'upper'（動作確認で決める）
  signal?: AbortSignal // 「やめる」で止める
}

export function thinkingLevelFor(model: string): string | undefined {
  return MODELS.find((m) => m.id === model)?.thinkingLevel
}

// 温度（temperature）は送らない。3.5 Flash-Lite 以降は無視され、将来はエラーになるため
export function buildBody(req: GeminiRequest): Record<string, unknown> {
  const generationConfig: Record<string, unknown> =
    (req.format ?? 'responseFormat') === 'responseFormat'
      ? { responseFormat: { text: { mimeType: 'APPLICATION_JSON', schema: req.schema } } }
      : { responseMimeType: 'application/json', responseJsonSchema: req.schema }
  const level = thinkingLevelFor(req.model)
  if (level !== undefined) {
    generationConfig.thinkingConfig = {
      thinkingLevel: req.thinkingLevelCase === 'lower' ? level.toLowerCase() : level.toUpperCase(),
    }
  }
  return {
    systemInstruction: { parts: [{ text: req.system }] },
    contents: [{ role: 'user', parts: [{ text: req.user }] }],
    generationConfig,
  }
}

type Obj = Record<string, unknown>

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

// candidates[0].content.parts の text をつなぐ（考えた内容の部分 thought: true は除く）
export function extractText(data: unknown): string {
  if (!isObj(data)) throw new GeminiError('bad-response', '返事の形が違います')
  const feedback = data.promptFeedback
  if (isObj(feedback) && feedback.blockReason) {
    throw new GeminiError('bad-response', `止められた返事です（${String(feedback.blockReason)}）`)
  }
  const candidates = data.candidates
  const first = Array.isArray(candidates) ? candidates[0] : undefined
  if (!isObj(first)) throw new GeminiError('bad-response', '返事に候補がありません')
  if (first.finishReason === 'MAX_TOKENS') throw new GeminiError('bad-response', '返事が途中で切れました（MAX_TOKENS）')
  const content = first.content
  const parts = isObj(content) && Array.isArray(content.parts) ? content.parts : []
  const text = parts
    .filter((p): p is Obj => isObj(p) && p.thought !== true && typeof p.text === 'string')
    .map((p) => p.text as string)
    .join('')
  if (text === '') {
    throw new GeminiError('bad-response', `返事に text がありません（${String(first.finishReason ?? '')}）`)
  }
  return text
}

// 400 で error.details[].reason が API_KEY_INVALID か
function isKeyInvalid(bodyText: string): boolean {
  try {
    const body: unknown = JSON.parse(bodyText)
    const error = isObj(body) ? body.error : undefined
    const details = isObj(error) && Array.isArray(error.details) ? error.details : []
    return details.some((d) => isObj(d) && d.reason === 'API_KEY_INVALID')
  } catch {
    return false
  }
}

// 状態の読める失敗を分ける。message には状態と本文の先頭 300 字を入れる（動作確認の画面に出すため）
export function classifyHttpError(status: number, bodyText: string): GeminiError {
  let kind: GeminiErrorKind
  if (status === 400) kind = isKeyInvalid(bodyText) ? 'auth' : 'bad-request'
  else if (status === 401 || status === 403) kind = 'auth'
  else if (status === 404) kind = 'model'
  else if (status === 429) kind = 'quota'
  else if (status >= 500) kind = 'server'
  else kind = 'bad-request'
  return new GeminiError(kind, `HTTP ${status}: ${bodyText.slice(0, 300)}`, status)
}

// 返事の text を JSON として読んだものを返す。失敗はすべて GeminiError（再試行はしない）
export async function callGemini(req: GeminiRequest, fetchImpl: typeof fetch = fetch): Promise<unknown> {
  const apiKey = req.apiKey?.trim()
  if (!apiKey) throw new GeminiError('no-key', 'キーがありません')
  if (req.signal?.aborted) throw new GeminiError('aborted', '止めました')

  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, req.timeoutMs)
  const onAbort = (): void => controller.abort()
  req.signal?.addEventListener('abort', onAbort)
  // 時間切れか「やめる」で止めたのか、通信の失敗か
  const stopped = (e: unknown): GeminiError | undefined => {
    if (timedOut) return new GeminiError('timeout', `${req.timeoutMs} ミリ秒で返事がありませんでした`)
    if (req.signal?.aborted) return new GeminiError('aborted', '止めました')
    return e instanceof GeminiError ? e : undefined
  }

  try {
    let res: Response
    try {
      res = await fetchImpl(`${GEMINI_ENDPOINT}/${encodeURIComponent(req.model)}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify(buildBody(req)),
        signal: controller.signal,
      })
    } catch (e) {
      // fetch の TypeError（電波が無い・CORS・状態の読めない失敗）は network
      throw stopped(e) ?? new GeminiError('network', e instanceof Error ? e.message : String(e))
    }
    if (!res.ok) {
      let bodyText = ''
      try {
        bodyText = await res.text()
      } catch (e) {
        const s = stopped(e)
        if (s) throw s
      }
      throw classifyHttpError(res.status, bodyText)
    }
    let data: unknown
    try {
      data = await res.json()
    } catch (e) {
      throw stopped(e) ?? new GeminiError('bad-response', '返事が JSON ではありません')
    }
    const text = extractText(data)
    try {
      return JSON.parse(text)
    } catch {
      throw new GeminiError('bad-response', `返事の text が JSON ではありません: ${text.slice(0, 100)}`)
    }
  } finally {
    clearTimeout(timer)
    req.signal?.removeEventListener('abort', onAbort)
  }
}

// 画面に出す文（仕様書 12 章）
const ERROR_TEXT: Record<GeminiErrorKind, string> = {
  'no-key': '設定で Gemini のキーを入れると AI で判定します',
  timeout: 'AI の返事が遅いので、自分で ○△× を選んでください',
  // 「やめる」で止めたときは画面に出さない（仕様書 12 章に無いので、念のための文）
  aborted: 'AI の呼び出しを止めました',
  network: 'AI につながりません。自分で ○△× を選んでください',
  quota:
    'AI の回数の上限です。1 分ほどおいてください。続くときは今日の上限で、日本時間の 16 時（冬は 17 時）に戻ります',
  auth: '設定で Gemini のキーを確認してください。使えなくなっていたら AI Studio で作り直します',
  'bad-request': 'AI への頼み方が通りませんでした（アプリの不具合の可能性があります）',
  model: 'このモデルは使えなくなりました。設定で別のモデルを選んでください',
  server: 'AI が混み合っています。自分で ○△× を選んでください',
  'bad-response': 'AI の返事を読めませんでした。自分で ○△× を選んでください',
}

export function errorText(kind: GeminiErrorKind): string {
  return ERROR_TEXT[kind]
}

// 登録と「AI で補う」で出す文（仕様書 12 章）。判定の文から「自分で ○△× を選んでください」を除き、待ち時間切れと
// キーが未設定は登録用の文にする。登録の画面は、この後に「意味を自分で入れて保存し、あとで AI で補えます」を足す
const FILL_ERROR_TEXT: Record<GeminiErrorKind, string> = {
  ...ERROR_TEXT,
  'no-key': '設定で Gemini のキーを入れると、AI が残りを埋めます',
  timeout: 'AI の返事が遅いので、作れませんでした',
  network: 'AI につながりません',
  server: 'AI が混み合っています',
  'bad-response': 'AI の返事を読めませんでした',
}

export function fillErrorText(kind: GeminiErrorKind): string {
  return FILL_ERROR_TEXT[kind]
}
