// 読み上げ（仕様書 10 章）。iPhone の読み上げ（speechSynthesis）を使う。言語は en-US だけを指定し、声は選ばない
// 動作確認の段で使うので、src/lib のうち config 以外は import しない
import { SPEAK_RESTART_DELAY_MS, SPEAK_START_TIMEOUT_MS } from './config.ts'

export type SpeechEvent = 'start' | 'end' | 'error'
// 動作確認の画面で onstart・onend・onerror を記録するため
export type SpeechLog = (event: SpeechEvent, detail: string) => void

// 読み上げ中の発話は関数の外の変数に持っておく（どこからも参照されないと消され、onend が来ない不具合への備え）
let current: SpeechSynthesisUtterance | undefined
// 読み上げの世代。speak と stopSpeech で 1 増やす。止めて待つ間に次の読み上げか「止める」が来たら、待ち終わった
// 古い英語は読まない（待ちは止められないので、やめた後や次の問題で前の英語が鳴るのを防ぐ）。unlockSpeech は読み上げを
// 頼むものではないので増やさない（準備で、待っている読み上げを止める理由は無い）
let generation = 0
// 読んでいた（か積んであった）読み上げを最後に止めた時刻（performance.now()）。止めてから SPEAK_RESTART_DELAY_MS の
// 間は、どの読み上げも読まずに待つ（前の呼び出しが止めて待っている間に来た読み上げは、合成が空いて見えるため）
let cancelledAt = Number.NEGATIVE_INFINITY

function cancelNow(synth: SpeechSynthesis): void {
  if (synth.speaking || synth.pending) cancelledAt = performance.now()
  synth.cancel()
}

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
// 読み上げ中なら止める。止めてから SPEAK_RESTART_DELAY_MS たつまでは待ってから読む（止めた直後の読み上げまで消える
// iOS の不具合への備え。ほかの呼び出しが止めた直後に来たときも待つ）。待つ間に次の speak か stopSpeech が来たら、
// 読まずに 'not-started'
export async function speak(text: string, rate: number, log?: SpeechLog): Promise<'started' | 'not-started'> {
  if (!speechSupported() || text.trim() === '') return 'not-started'
  generation += 1
  const mine = generation
  const synth = window.speechSynthesis
  if (synth.speaking || synth.pending) cancelNow(synth)
  const left = cancelledAt + SPEAK_RESTART_DELAY_MS - performance.now()
  if (left > 0) {
    await wait(left)
    if (generation !== mine) return 'not-started'
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
  generation += 1
  if (speechSupported()) cancelNow(window.speechSynthesis)
}
