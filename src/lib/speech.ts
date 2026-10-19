// 読み上げ（仕様書 10 章）。iPhone の読み上げ（speechSynthesis）を使う。言語は en-US だけを指定し、声は選ばない
// 動作確認の段で使うので、src/lib のうち config 以外は import しない
import { SPEAK_RESTART_DELAY_MS, SPEAK_START_TIMEOUT_MS } from './config.ts'

export type SpeechEvent = 'start' | 'end' | 'error'
// 動作確認の画面で onstart・onend・onerror を記録するため
export type SpeechLog = (event: SpeechEvent, detail: string) => void

// 読み上げ中の発話は関数の外の変数に持っておく（どこからも参照されないと消され、onend が来ない不具合への備え）
let current: SpeechSynthesisUtterance | undefined

export function speechSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance === 'function'
}

// 押した処理の中で呼ぶ。音量 0 の短い英語を読み、そのページを開いている間の制限を外す。
// 空の文字列は使わない（終わりの知らせが来ず、次の読み上げが詰まるおそれがあるため）
export function unlockSpeech(): void {
  if (!speechSupported()) return
  const u = new SpeechSynthesisUtterance('ok')
  u.lang = 'en-US'
  u.volume = 0
  current = u
  u.onend = () => {
    if (current === u) current = undefined
  }
  window.speechSynthesis.speak(u)
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

// 読み上げる。SPEAK_START_TIMEOUT_MS までに始まらなければ 'not-started'（呼ぶ側で再生ボタンを目立たせる）。
// 読み上げ中なら止めて SPEAK_RESTART_DELAY_MS 待ってから読む（止めた直後の読み上げまで消える iOS の不具合への備え）
export async function speak(text: string, rate: number, log?: SpeechLog): Promise<'started' | 'not-started'> {
  if (!speechSupported() || text.trim() === '') return 'not-started'
  const synth = window.speechSynthesis
  if (synth.speaking || synth.pending) {
    synth.cancel()
    await wait(SPEAK_RESTART_DELAY_MS)
  }
  const u = new SpeechSynthesisUtterance(text)
  u.lang = 'en-US'
  u.rate = rate
  current = u
  return new Promise((resolve) => {
    let settled = false
    const finish = (result: 'started' | 'not-started'): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }
    const timer = setTimeout(() => finish('not-started'), SPEAK_START_TIMEOUT_MS)
    u.onstart = () => {
      log?.('start', text)
      finish('started')
    }
    u.onend = () => {
      log?.('end', text)
      if (current === u) current = undefined
    }
    u.onerror = (e) => {
      log?.('error', e.error)
      if (current === u) current = undefined
      finish('not-started')
    }
    synth.speak(u)
  })
}

export function stopSpeech(): void {
  if (speechSupported()) window.speechSynthesis.cancel()
}
