import { describe, expect, it } from 'vitest'
import { GEMINI_ENDPOINT } from '../config.ts'
import {
  buildBody,
  callGemini,
  classifyHttpError,
  errorText,
  extractText,
  fillErrorText,
  GeminiError,
  thinkingLevelFor,
  type GeminiErrorKind,
  type GeminiRequest,
} from './client.ts'

const schema = {
  type: 'object',
  properties: { verdict: { type: 'string', enum: ['correct', 'close', 'wrong'] } },
  required: ['verdict'],
}

function req(over: Partial<GeminiRequest> = {}): GeminiRequest {
  return {
    apiKey: 'test-key-abc',
    model: 'gemini-3.5-flash-lite',
    system: '採点者です',
    user: '英語: give up',
    schema,
    timeoutMs: 1000,
    ...over,
  }
}

// Gemini の generateContent の返事の形
function reply(text: string, over: Record<string, unknown> = {}): unknown {
  return {
    candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason: 'STOP', ...over }],
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

interface Call {
  url: string
  init: RequestInit | undefined
}

// 呼ばれた URL と中身を記録する偽の fetch
function fakeFetch(respond: () => Response | Promise<Response>): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = []
  const f: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init })
    return respond()
  }
  return { fetch: f, calls }
}

// signal で中断されるまで返らない偽の fetch
const hangingFetch: typeof fetch = (_input, init) =>
  new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')))
  })

async function kindOf(p: Promise<unknown>): Promise<GeminiErrorKind> {
  try {
    await p
  } catch (e) {
    if (e instanceof GeminiError) return e.kind
    throw e
  }
  throw new Error('失敗しなかった')
}

function thrownKind(f: () => unknown): GeminiErrorKind {
  try {
    f()
  } catch (e) {
    if (e instanceof GeminiError) return e.kind
    throw e
  }
  throw new Error('失敗しなかった')
}

describe('thinkingLevelFor', () => {
  it('3.5 Flash-Lite は送らない、3.8 Flash は LOW', () => {
    expect(thinkingLevelFor('gemini-3.5-flash-lite')).toBeUndefined()
    expect(thinkingLevelFor('gemini-3.8-flash')).toBe('LOW')
    expect(thinkingLevelFor('gemini-9-unknown')).toBeUndefined()
  })
})

describe('buildBody（仕様書 7-3）', () => {
  it('指示（systemInstruction）と内容（contents）を分け、responseFormat.text に mimeType と schema を入れる', () => {
    expect(buildBody(req())).toEqual({
      systemInstruction: { parts: [{ text: '採点者です' }] },
      contents: [{ role: 'user', parts: [{ text: '英語: give up' }] }],
      generationConfig: {
        responseFormat: { text: { mimeType: 'APPLICATION_JSON', schema } },
      },
    })
  })

  it('もう 1 つの書き方: responseMimeType と responseJsonSchema', () => {
    expect(buildBody(req({ format: 'responseJsonSchema' })).generationConfig).toEqual({
      responseMimeType: 'application/json',
      responseJsonSchema: schema,
    })
  })

  it('温度（temperature）は送らない', () => {
    for (const format of ['responseFormat', 'responseJsonSchema'] as const) {
      for (const model of ['gemini-3.5-flash-lite', 'gemini-3.8-flash']) {
        expect(JSON.stringify(buildBody(req({ format, model })))).not.toContain('temperature')
      }
    }
  })

  it('thinkingLevel は 3.8 Flash だけに送る。既定は大文字、lower なら小文字', () => {
    expect(buildBody(req()).generationConfig).not.toHaveProperty('thinkingConfig')
    expect(buildBody(req({ model: 'gemini-3.8-flash' })).generationConfig).toMatchObject({
      thinkingConfig: { thinkingLevel: 'LOW' },
    })
    expect(
      buildBody(req({ model: 'gemini-3.8-flash', thinkingLevelCase: 'lower' })).generationConfig,
    ).toMatchObject({ thinkingConfig: { thinkingLevel: 'low' } })
    expect(
      buildBody(req({ model: 'gemini-3.8-flash', format: 'responseJsonSchema' })).generationConfig,
    ).toEqual({
      responseMimeType: 'application/json',
      responseJsonSchema: schema,
      thinkingConfig: { thinkingLevel: 'LOW' },
    })
  })
})

describe('extractText', () => {
  it('parts の text をつなぎ、考えた内容の部分（thought: true）は除く', () => {
    const data = {
      candidates: [
        {
          content: { parts: [{ text: '考え中…', thought: true }, { text: '{"verdict":' }, { text: '"correct"}' }] },
          finishReason: 'STOP',
        },
      ],
    }
    expect(extractText(data)).toBe('{"verdict":"correct"}')
  })

  it('途中で切れた返事（MAX_TOKENS）は失敗', () => {
    expect(thrownKind(() => extractText(reply('{"verdict":', { finishReason: 'MAX_TOKENS' })))).toBe('bad-response')
  })

  it('止められた返事（promptFeedback.blockReason）は失敗', () => {
    expect(thrownKind(() => extractText({ promptFeedback: { blockReason: 'SAFETY' } }))).toBe('bad-response')
    expect(
      thrownKind(() => extractText({ ...(reply('{}') as object), promptFeedback: { blockReason: 'OTHER' } })),
    ).toBe('bad-response')
  })

  it('text が無い返事は失敗', () => {
    expect(thrownKind(() => extractText({ candidates: [] }))).toBe('bad-response')
    expect(thrownKind(() => extractText({ candidates: [{ content: { parts: [] } }] }))).toBe('bad-response')
    expect(
      thrownKind(() => extractText({ candidates: [{ content: { parts: [{ text: '…', thought: true }] } }] })),
    ).toBe('bad-response')
    expect(thrownKind(() => extractText(null))).toBe('bad-response')
  })
})

describe('classifyHttpError（仕様書 12 章）', () => {
  const keyInvalid = JSON.stringify({
    error: {
      code: 400,
      message: 'API key not valid. Please pass a valid API key.',
      status: 'INVALID_ARGUMENT',
      details: [
        { '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'API_KEY_INVALID', domain: 'googleapis.com' },
      ],
    },
  })
  const otherBad = JSON.stringify({
    error: { code: 400, message: 'Invalid JSON payload received.', status: 'INVALID_ARGUMENT' },
  })

  it('400 で reason が API_KEY_INVALID ならキーの誤り（auth）', () => {
    const e = classifyHttpError(400, keyInvalid)
    expect(e.kind).toBe('auth')
    expect(e.status).toBe(400)
  })

  it('ほかの 400 は頼み方の誤り（bad-request）。本文が JSON でなくても', () => {
    expect(classifyHttpError(400, otherBad).kind).toBe('bad-request')
    expect(classifyHttpError(400, 'Bad Request').kind).toBe('bad-request')
  })

  it('401・403 は auth、404 は model、429 は quota、500・503 は server', () => {
    expect(classifyHttpError(401, '').kind).toBe('auth')
    expect(classifyHttpError(403, '').kind).toBe('auth')
    expect(classifyHttpError(404, '').kind).toBe('model')
    expect(classifyHttpError(429, '').kind).toBe('quota')
    expect(classifyHttpError(500, '').kind).toBe('server')
    expect(classifyHttpError(503, '').kind).toBe('server')
    expect(classifyHttpError(503, '').status).toBe(503)
  })

  it('動作確認の画面に出せるよう、状態と本文の先頭を message に入れる', () => {
    const e = classifyHttpError(400, otherBad)
    expect(e.message).toContain('400')
    expect(e.message).toContain('Invalid JSON payload')
  })
})

describe('callGemini', () => {
  it('成功したら、返事の text を JSON として読んだものを返す', async () => {
    const { fetch, calls } = fakeFetch(() => jsonResponse(reply('{"verdict":"correct","reason":"合う"}')))
    expect(await callGemini(req(), fetch)).toEqual({ verdict: 'correct', reason: '合う' })
    expect(calls).toHaveLength(1)
  })

  it('キーはヘッダー x-goog-api-key で送り、URL には入れない', async () => {
    const { fetch, calls } = fakeFetch(() => jsonResponse(reply('{}')))
    await callGemini(req(), fetch)
    const { url, init } = calls[0]
    expect(url).toBe(`${GEMINI_ENDPOINT}/gemini-3.5-flash-lite:generateContent`)
    expect(url).not.toContain('key=')
    expect(url).not.toContain('test-key-abc')
    expect(init?.method).toBe('POST')
    const headers = new Headers(init?.headers)
    expect(headers.get('x-goog-api-key')).toBe('test-key-abc')
    expect(headers.get('content-type')).toBe('application/json')
    expect(JSON.parse(String(init?.body))).toEqual(buildBody(req()))
  })

  it('キーが無ければ呼ばずに no-key', async () => {
    const { fetch, calls } = fakeFetch(() => jsonResponse(reply('{}')))
    expect(await kindOf(callGemini(req({ apiKey: undefined }), fetch))).toBe('no-key')
    expect(await kindOf(callGemini(req({ apiKey: '  ' }), fetch))).toBe('no-key')
    expect(calls).toHaveLength(0)
  })

  it('待ち時間を過ぎたら timeout', async () => {
    expect(await kindOf(callGemini(req({ timeoutMs: 20 }), hangingFetch))).toBe('timeout')
  })

  it('fetch の TypeError（電波が無いなど）は network', async () => {
    const failing: typeof fetch = async () => {
      throw new TypeError('Failed to fetch')
    }
    expect(await kindOf(callGemini(req(), failing))).toBe('network')
  })

  it('signal で中断したら aborted（「やめる」）', async () => {
    const controller = new AbortController()
    const p = callGemini(req({ signal: controller.signal }), hangingFetch)
    controller.abort()
    expect(await kindOf(p)).toBe('aborted')
  })

  it('始める前に中断されていたら、呼ばずに aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const { fetch, calls } = fakeFetch(() => jsonResponse(reply('{}')))
    expect(await kindOf(callGemini(req({ signal: controller.signal }), fetch))).toBe('aborted')
    expect(calls).toHaveLength(0)
  })

  it('状態の読める失敗は classifyHttpError で分ける', async () => {
    const { fetch } = fakeFetch(() => jsonResponse({ error: { code: 429, status: 'RESOURCE_EXHAUSTED' } }, 429))
    expect(await kindOf(callGemini(req(), fetch))).toBe('quota')
    const notFound = fakeFetch(() => jsonResponse({ error: { code: 404 } }, 404))
    expect(await kindOf(callGemini(req(), notFound.fetch))).toBe('model')
  })

  it('返事の構造が違う・text が JSON でなければ bad-response', async () => {
    expect(await kindOf(callGemini(req(), fakeFetch(() => jsonResponse(reply('はい'))).fetch))).toBe('bad-response')
    expect(await kindOf(callGemini(req(), fakeFetch(() => new Response('<html>', { status: 200 })).fetch))).toBe(
      'bad-response',
    )
    expect(await kindOf(callGemini(req(), fakeFetch(() => jsonResponse({ candidates: [] })).fetch))).toBe(
      'bad-response',
    )
  })
})

describe('errorText（仕様書 12 章の表示する文）', () => {
  it('原因ごとの文', () => {
    expect(errorText('timeout')).toBe('AI の返事が遅いので、自分で ○△× を選んでください')
    expect(errorText('network')).toBe('AI につながりません。自分で ○△× を選んでください')
    expect(errorText('quota')).toBe(
      'AI の回数の上限です。1 分ほどおいてください。続くときは今日の上限で、日本時間の 16 時（冬は 17 時）に戻ります',
    )
    expect(errorText('auth')).toBe('設定で Gemini のキーを確認してください。使えなくなっていたら AI Studio で作り直します')
    expect(errorText('bad-request')).toBe('AI への頼み方が通りませんでした（アプリの不具合の可能性があります）')
    expect(errorText('model')).toBe('このモデルは使えなくなりました。設定で別のモデルを選んでください')
    expect(errorText('server')).toBe('AI が混み合っています。自分で ○△× を選んでください')
    expect(errorText('no-key')).toBe('設定で Gemini のキーを入れると AI で判定します')
    expect(errorText('bad-response')).toBe('AI の返事を読めませんでした。自分で ○△× を選んでください')
    expect(errorText('aborted')).not.toBe('')
  })
})

describe('fillErrorText（登録と「AI で補う」で出す文。仕様書 12 章）', () => {
  const kinds: GeminiErrorKind[] = [
    'no-key',
    'timeout',
    'aborted',
    'network',
    'quota',
    'auth',
    'bad-request',
    'model',
    'server',
    'bad-response',
  ]

  it('判定の文から「自分で ○△× を選んでください」を除き、キーが無いときは登録の文にする', () => {
    expect(fillErrorText('timeout')).toBe('AI の返事が遅いので、作れませんでした')
    expect(fillErrorText('network')).toBe('AI につながりません')
    expect(fillErrorText('server')).toBe('AI が混み合っています')
    expect(fillErrorText('bad-response')).toBe('AI の返事を読めませんでした')
    expect(fillErrorText('no-key')).toBe('設定で Gemini のキーを入れると、AI が残りを埋めます')
    for (const kind of ['quota', 'auth', 'bad-request', 'model'] as const) {
      expect(fillErrorText(kind)).toBe(errorText(kind))
    }
  })

  it('どの原因の文にも、判定の場面の言葉（○△×・判定）が入らない', () => {
    for (const kind of kinds) {
      expect(fillErrorText(kind)).not.toContain('○△×')
      expect(fillErrorText(kind)).not.toContain('判定')
    }
  })
})
