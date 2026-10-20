// 判定が決まったときに、FSRS に渡してカード・解答記録・予定を作る（仕様書 6-4・6-5・6-6）。
// 保存は呼ぶ側が db.ts の saveAnswer で 1 つのトランザクションにして行う
import { dayOf } from './day.ts'
import { toRating } from './rating.ts'
import { recordAnswer } from './session.ts'
import { reviewCard } from './srs.ts'
import type { CardRecord, JudgedBy, RatingValue, ReviewRecord, SessionState, Verdict } from './types.ts'

export interface SettleInput {
  record: CardRecord // 解く前のカード
  practice: boolean // △ の練習（FSRS に渡さない）
  sessionBefore: SessionState // 答える前の予定（判定を直すときも同じものから作り直す）
  at: Date // 解いた時刻（判定を直すときも元の時刻）
  answer: string // わからないのときは空文字
  verdict: Verdict
  judgedBy: JudgedBy
  thinkMs: number
  totalMs: number
  usedHint: boolean
  easy: boolean // 「簡単すぎ」
  appealed: boolean // 判定を直したか
  reviewId: string // 判定を直すときは同じ id で上書きする
  aiReason?: string
}

export interface Settled {
  card: CardRecord // 答えた後のカード（練習なら解く前のまま）
  review: ReviewRecord
  session: SessionState
  rating: RatingValue // 練習のときは、付けたはずの評価
}

// 解いた時刻が前回より前のアプリの日だと、reviewCard が時刻の誤りを投げる（srs.ts の isClockError で見分ける）
export function settleAnswer(input: SettleInput): Settled {
  const { record, practice, sessionBefore, at, verdict } = input
  const rating = toRating({ verdict, thinkMs: input.thinkMs, usedHint: input.usedHint, easy: input.easy })
  const after = practice ? record.card : reviewCard(record.card, at, rating).card
  const review: ReviewRecord = {
    id: input.reviewId,
    cardId: record.id,
    wordId: record.wordId,
    direction: record.direction,
    at,
    day: dayOf(at),
    answer: input.answer,
    verdict,
    judgedBy: input.judgedBy,
    rating,
    thinkMs: input.thinkMs,
    totalMs: input.totalMs,
    usedHint: input.usedHint,
    appealed: input.appealed,
    practice,
    before: record.card,
  }
  if (input.aiReason !== undefined && input.aiReason !== '') review.aiReason = input.aiReason
  const session = recordAnswer(sessionBefore, { cardId: record.id, practice, verdict, cardAfter: after })
  return { card: { ...record, card: after }, review, session, rating }
}
