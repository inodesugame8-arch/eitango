// 判定から FSRS の評価へ（仕様書 6-5）。1 Again / 2 Hard / 3 Good / 4 Easy
import { SLOW_THINK_MS } from './config.ts'
import type { RatingValue, Verdict } from './types.ts'

export function toRating(args: {
  verdict: Verdict
  thinkMs: number
  usedHint: boolean
  easy: boolean
}): RatingValue {
  const { verdict, thinkMs, usedHint, easy } = args
  if (verdict === 'wrong') return 1
  if (verdict === 'close') return 2
  // ○。「簡単すぎ」は Easy で付け直す（6-6）ので、遅さ・ヒントより先に見る
  if (easy) return 4
  // ○（遅い）: 答え始めるまで 10 秒以上か、並べ替えヒントを使った
  if (thinkMs >= SLOW_THINK_MS || usedHint) return 2
  return 3
}
