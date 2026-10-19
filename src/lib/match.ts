// 許容訳との照合（仕様書 7-2）。合えば ○ で、AI は呼ばない
import { normalizeEn, normalizeJa } from './normalize.ts'
import type { Direction, Word } from './types.ts'

// 正規化して同じか（空は同じとみなさない）
export function sameJa(a: string, b: string): boolean {
  const x = normalizeJa(a)
  return x !== '' && x === normalizeJa(b)
}

export function sameEn(a: string, b: string): boolean {
  const x = normalizeEn(a)
  return x !== '' && x === normalizeEn(b)
}

// 英→日は accepted、日→英は term・acceptedEn・clozeAnswer のどれかと同じなら true
export function matchLocal(word: Word, direction: Direction, answer: string): boolean {
  if (direction === 'en-ja') return word.accepted.some((t) => sameJa(answer, t))
  const targets = [word.term, ...word.acceptedEn]
  if (word.clozeAnswer) targets.push(word.clozeAnswer)
  return targets.some((t) => sameEn(answer, t))
}
