import { State } from 'ts-fsrs'
import { describe, expect, it } from 'vitest'
import { settleAnswer, type SettleInput } from './answer.ts'
import { addStepEntries, newSession } from './session.ts'
import { isClockError, newCard, reviewCard } from './srs.ts'
import type { CardRecord } from './types.ts'

const MIN = 60_000

// 端末の時計（テストでは Asia/Tokyo）での日時。月は 1 から数える
function at(y: number, mo: number, d: number, h = 0, mi = 0): Date {
  return new Date(y, mo - 1, d, h, mi)
}

const created = at(2026, 10, 18, 12)
const t = at(2026, 10, 20, 21, 0)

function fresh(): CardRecord {
  return { id: 'w1:en-ja', wordId: 'w1', direction: 'en-ja', card: newCard(created) }
}

// Review の状態のカード（10/18 に Good を 2 回）
function reviewed(): CardRecord {
  const first = reviewCard(newCard(created), created, 3).card
  const second = reviewCard(first, new Date(created.getTime() + 10 * MIN), 3).card
  return { ...fresh(), card: second }
}

function input(over: Partial<SettleInput> = {}): SettleInput {
  return {
    record: fresh(),
    practice: false,
    sessionBefore: newSession('2026-10-20'),
    at: t,
    answer: 'あきらめる',
    verdict: 'correct',
    judgedBy: 'local',
    thinkMs: 3000,
    totalMs: 5000,
    usedHint: false,
    easy: false,
    appealed: false,
    reviewId: 'r1',
    ...over,
  }
}

describe('settleAnswer（判定が決まったら FSRS に渡し、カード・解答記録・予定を作る。仕様書 6-4・6-5）', () => {
  it('新しいカードを ○（ふつうの速さ）: Good で 10 分後、解答記録と学習ステップの予定ができる', () => {
    const before = fresh()
    const out = settleAnswer(input({ record: before }))
    expect(out.rating).toBe(3)
    expect(out.card.id).toBe('w1:en-ja')
    expect(out.card.card.state).toBe(State.Learning)
    expect(out.card.card.due).toEqual(new Date(t.getTime() + 10 * MIN))
    expect(out.review).toEqual({
      id: 'r1',
      cardId: 'w1:en-ja',
      wordId: 'w1',
      direction: 'en-ja',
      at: t,
      day: '2026-10-20',
      answer: 'あきらめる',
      verdict: 'correct',
      judgedBy: 'local',
      rating: 3,
      thinkMs: 3000,
      totalMs: 5000,
      usedHint: false,
      appealed: false,
      practice: false,
      before: before.card,
    })
    expect(out.session.answers).toBe(1)
    expect(out.session.pending).toEqual([{ cardId: 'w1:en-ja', reason: 'step', seq: 0, dueAt: out.card.card.due }])
  })

  it('○ でも答え始めるまで 10 秒以上なら Hard、ヒントを使っても Hard、簡単すぎなら Easy', () => {
    expect(settleAnswer(input({ thinkMs: 10_000 })).rating).toBe(2)
    expect(settleAnswer(input({ usedHint: true })).rating).toBe(2)
    expect(settleAnswer(input({ easy: true })).rating).toBe(4)
  })

  it('× は Again で、3 問後にもう一度出す予定ができる', () => {
    const out = settleAnswer(input({ verdict: 'wrong', answer: '負ける', judgedBy: 'ai', aiReason: '別の意味' }))
    expect(out.rating).toBe(1)
    expect(out.review.aiReason).toBe('別の意味')
    expect(out.session.pending).toEqual([{ cardId: 'w1:en-ja', reason: 'again', seq: 0, afterAnswers: 4 }])
  })

  it('練習（△ の練習）は FSRS に渡さない: カードは解く前のまま、評価は付けたはずの値、予定は消すだけ', () => {
    const before = reviewed()
    const s = { ...newSession('2026-10-20'), answers: 6, seq: 1, pending: [{ cardId: before.id, reason: 'practice' as const, seq: 0, afterAnswers: 6 }], practiced: [before.id] }
    const out = settleAnswer(input({ record: before, practice: true, sessionBefore: s, verdict: 'wrong' }))
    expect(out.card).toEqual(before)
    expect(out.review.practice).toBe(true)
    expect(out.review.rating).toBe(1)
    expect(out.session.answers).toBe(7)
    expect(out.session.pending).toEqual([])
  })

  it('判定を直す: 解く前のカードと元の時刻・答える前の予定からやり直すと、最初からその判定だったのと同じになる', () => {
    const before = reviewed()
    const s0 = addStepEntries(newSession('2026-10-20'), [{ cardId: 'w2:en-ja', dueAt: at(2026, 10, 20, 21, 30) }])
    const first = settleAnswer(input({ record: before, sessionBefore: s0, verdict: 'wrong', judgedBy: 'ai' }))
    expect(first.session.pending.map((p) => p.reason)).toEqual(['step', 'again'])
    const appealed = settleAnswer(
      input({ record: before, sessionBefore: s0, verdict: 'correct', judgedBy: 'ai', appealed: true }),
    )
    const direct = settleAnswer(input({ record: before, sessionBefore: s0, verdict: 'correct', judgedBy: 'ai' }))
    expect(appealed.card).toEqual(direct.card)
    expect(appealed.session).toEqual(direct.session)
    expect(appealed.review).toEqual({ ...direct.review, appealed: true })
    expect(appealed.review.id).toBe(first.review.id)
  })

  it('朝 4 時をまたいで答えると、解答記録の日は解いた時刻のアプリの日。予定は答える前の日のままで、次の日に出るカードは入れない', () => {
    const out = settleAnswer(input({ sessionBefore: newSession('2026-10-20'), at: at(2026, 10, 21, 4, 1) }))
    expect(out.review.day).toBe('2026-10-21')
    expect(out.session.day).toBe('2026-10-20')
    expect(out.session.pending).toEqual([])
  })

  it('解いた時刻が前回より前のアプリの日なら、時刻の誤りを投げる（カードを変えずに飛ばすのは画面の仕事）', () => {
    const before = reviewed()
    let thrown: unknown
    try {
      settleAnswer(input({ record: before, at: at(2026, 10, 17, 12) }))
    } catch (e) {
      thrown = e
    }
    expect(isClockError(thrown)).toBe(true)
  })
})
