import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SPEAK_RESTART_DELAY_MS, SPEAK_START_TIMEOUT_MS } from './config.ts'
import type * as Speech from './speech.ts'

// speech.ts は世代と止めた時刻をモジュールに持つので、テストごとに読み直して前のテストの状態を持ち越さない
let speak: typeof Speech.speak
let stopSpeech: typeof Speech.stopSpeech
let unlockSpeech: typeof Speech.unlockSpeech

// speechSynthesis の偽物。speak は積んだ発話を覚えるだけで、始まり（onstart）はテストから起こす
class FakeUtterance {
  text: string
  lang = ''
  rate = 1
  volume = 1
  onstart: (() => void) | null = null
  onend: (() => void) | null = null
  onerror: ((e: { error: string }) => void) | null = null
  constructor(text: string) {
    this.text = text
  }
}

interface FakeSynth {
  speaking: boolean
  pending: boolean
  cancelCount: number
  queued: FakeUtterance[] // これまでに積んだ発話（止めた分も残す）
  live: FakeUtterance[] // 止めていない発話
  speak: (u: FakeUtterance) => void
  cancel: () => void
}

let synth: FakeSynth

function makeSynth(): FakeSynth {
  const s: FakeSynth = {
    speaking: false,
    pending: false,
    cancelCount: 0,
    queued: [],
    live: [],
    speak(u) {
      s.queued.push(u)
      s.live.push(u)
      s.speaking = true
    },
    // WebKit と同じく、止めた発話には error（canceled）を送る
    cancel() {
      s.cancelCount += 1
      s.speaking = false
      s.pending = false
      const stopped = s.live
      s.live = []
      for (const u of stopped) u.onerror?.({ error: 'canceled' })
    },
  }
  return s
}

// 読み上げを頼んだ英語（音量 0 の準備の 'ok' を除く）
const spokenTexts = (): string[] => synth.queued.filter((u) => u.volume !== 0).map((u) => u.text)

beforeEach(async () => {
  vi.useFakeTimers()
  synth = makeSynth()
  vi.stubGlobal('window', { speechSynthesis: synth })
  vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance)
  vi.resetModules()
  ;({ speak, stopSpeech, unlockSpeech } = await import('./speech.ts'))
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('speak', () => {
  it('ふつうに読める: en-US と速さを付けて読み、始まったら started', async () => {
    const p = speak('give up', 1.2)
    expect(synth.queued).toHaveLength(1)
    const u = synth.queued[0]
    expect(u.text).toBe('give up')
    expect(u.lang).toBe('en-US')
    expect(u.rate).toBe(1.2)
    u.onstart?.()
    await expect(p).resolves.toBe('started')
  })

  it('SPEAK_START_TIMEOUT_MS までに始まらなければ not-started', async () => {
    const p = speak('give up', 1)
    await vi.advanceTimersByTimeAsync(SPEAK_START_TIMEOUT_MS - 1)
    let result: string | undefined
    void p.then((r) => (result = r))
    await Promise.resolve()
    expect(result).toBeUndefined()
    await vi.advanceTimersByTimeAsync(1)
    await expect(p).resolves.toBe('not-started')
  })

  it('読み上げの誤り（onerror）は not-started', async () => {
    const p = speak('give up', 1)
    synth.queued[0].onerror?.({ error: 'synthesis-failed' })
    await expect(p).resolves.toBe('not-started')
  })

  it('空の文字列は読まずに not-started', async () => {
    await expect(speak('  ', 1)).resolves.toBe('not-started')
    expect(synth.queued).toHaveLength(0)
  })

  it('読み上げ中なら止めて SPEAK_RESTART_DELAY_MS 待ってから読む', async () => {
    synth.speaking = true
    const p = speak('give up', 1)
    expect(synth.cancelCount).toBe(1)
    expect(spokenTexts()).toEqual([])
    await vi.advanceTimersByTimeAsync(SPEAK_RESTART_DELAY_MS)
    expect(spokenTexts()).toEqual(['give up'])
    synth.queued[0].onstart?.()
    await expect(p).resolves.toBe('started')
  })

  it('待ちの間に stopSpeech すると、待ち終わった古い英語は読まない', async () => {
    synth.speaking = true
    const p = speak('give up', 1)
    await vi.advanceTimersByTimeAsync(100)
    stopSpeech()
    await vi.advanceTimersByTimeAsync(SPEAK_RESTART_DELAY_MS + SPEAK_START_TIMEOUT_MS)
    expect(spokenTexts()).toEqual([])
    await expect(p).resolves.toBe('not-started')
  })

  it('待ちの間に別の speak が来ると、止めてから 250 ms たってから後の英語だけを読み、前の呼び出しは not-started', async () => {
    synth.speaking = true
    const first = speak('give up', 1)
    await vi.advanceTimersByTimeAsync(100)
    // 前の呼び出しが止めたので合成は空いて見えるが、止めてからまだ 100 ms。残りの 150 ms を待つ
    const second = speak('hang out', 1)
    expect(spokenTexts()).toEqual([])
    await vi.advanceTimersByTimeAsync(SPEAK_RESTART_DELAY_MS - 100 - 1)
    expect(spokenTexts()).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(spokenTexts()).toEqual(['hang out'])
    synth.queued[0].onstart?.()
    await expect(first).resolves.toBe('not-started')
    await expect(second).resolves.toBe('started')
  })

  it('止めてから SPEAK_RESTART_DELAY_MS たつまでは読まない（1 ms 前はまだ）', async () => {
    synth.speaking = true
    const p = speak('give up', 1)
    await vi.advanceTimersByTimeAsync(SPEAK_RESTART_DELAY_MS - 1)
    expect(spokenTexts()).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(spokenTexts()).toEqual(['give up'])
    synth.queued[0].onstart?.()
    await expect(p).resolves.toBe('started')
  })

  it('何も読んでいないときの stopSpeech の後は、待たずにその場で読む（押した操作の中で読むため）', async () => {
    stopSpeech()
    const p = speak('give up', 1)
    expect(spokenTexts()).toEqual(['give up'])
    synth.queued[0].onstart?.()
    await expect(p).resolves.toBe('started')
  })

  it('後の speak も待つときは、先に待ち終わった前の英語を読まず、後の英語を読む', async () => {
    synth.speaking = true
    const first = speak('give up', 1)
    await vi.advanceTimersByTimeAsync(100)
    synth.speaking = true // 別の読み上げがまだ続いている
    const second = speak('hang out', 1)
    await vi.advanceTimersByTimeAsync(SPEAK_RESTART_DELAY_MS)
    expect(spokenTexts()).toEqual(['hang out'])
    await expect(first).resolves.toBe('not-started')
    synth.queued[synth.queued.length - 1].onstart?.()
    await expect(second).resolves.toBe('started')
  })

  it('「始める」の順（準備 → 読み上げ）では、準備の ok を止めて SPEAK_RESTART_DELAY_MS 後に 1 問目を読む', async () => {
    unlockSpeech()
    expect(synth.queued).toHaveLength(1)
    expect(synth.queued[0].volume).toBe(0)
    const p = speak('give up', 1)
    expect(synth.cancelCount).toBe(1)
    await vi.advanceTimersByTimeAsync(SPEAK_RESTART_DELAY_MS - 1)
    expect(spokenTexts()).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(spokenTexts()).toEqual(['give up'])
    synth.queued[synth.queued.length - 1].onstart?.()
    await expect(p).resolves.toBe('started')
  })

  it('準備（unlockSpeech）は、待っている読み上げを止めない', async () => {
    synth.speaking = true
    const p = speak('give up', 1)
    await vi.advanceTimersByTimeAsync(100)
    unlockSpeech()
    await vi.advanceTimersByTimeAsync(SPEAK_RESTART_DELAY_MS - 100)
    expect(spokenTexts()).toEqual(['give up'])
    synth.queued[synth.queued.length - 1].onstart?.()
    await expect(p).resolves.toBe('started')
  })

  it('読み上げ中の英語を次の読み上げで止めると、止めた方は not-started（canceled の error）', async () => {
    const first = speak('give up', 1)
    const second = speak('hang out', 1)
    await expect(first).resolves.toBe('not-started')
    await vi.advanceTimersByTimeAsync(SPEAK_RESTART_DELAY_MS)
    expect(spokenTexts()).toEqual(['give up', 'hang out'])
    synth.queued[synth.queued.length - 1].onstart?.()
    await expect(second).resolves.toBe('started')
  })

  it('stopSpeech の後の speak はふつうに読める', async () => {
    synth.speaking = true
    const old = speak('give up', 1)
    stopSpeech()
    const p = speak('hang out', 1)
    await vi.advanceTimersByTimeAsync(SPEAK_RESTART_DELAY_MS)
    expect(spokenTexts()).toEqual(['hang out'])
    synth.queued[0].onstart?.()
    await expect(p).resolves.toBe('started')
    await expect(old).resolves.toBe('not-started')
  })
})

describe('stopSpeech', () => {
  it('読み上げを止める（cancel を呼ぶ）', () => {
    stopSpeech()
    expect(synth.cancelCount).toBe(1)
  })

  it('読み上げが使えない環境では何もしない', () => {
    vi.stubGlobal('window', {})
    expect(() => stopSpeech()).not.toThrow()
    expect(synth.cancelCount).toBe(0)
  })
})
