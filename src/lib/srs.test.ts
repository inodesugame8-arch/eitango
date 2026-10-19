import { createEmptyCard, fsrs, Rating, State, type Card } from 'ts-fsrs'
import { describe, expect, it } from 'vitest'
import { dayDiff, dayOf } from './day.ts'
import { dueDay, fsrsShiftMs, isClockError, isNew, isReviewState, newCard, reviewCard, reviveCard } from './srs.ts'

const MIN = 60_000
const DAY = 86_400_000

// 端末の時計（テストでは Asia/Tokyo）での日時。月は 1 から数える
function at(y: number, mo: number, d: number, h = 0, mi = 0): Date {
  return new Date(y, mo - 1, d, h, mi)
}

// 新しいカードを t1 に Good、t1 + 10 分に Good で、Review の状態にしたカード
function reviewStateCard(t1: Date): { card: Card; lastAt: Date } {
  const first = reviewCard(newCard(t1), t1, 3)
  const t2 = new Date(t1.getTime() + 10 * MIN)
  const second = reviewCard(first.card, t2, 3)
  return { card: second.card, lastAt: t2 }
}

describe('fsrsShiftMs', () => {
  it('日本では 9 − 4 = 5 時間', () => {
    expect(fsrsShiftMs(at(2026, 10, 20, 12))).toBe(5 * 3_600_000)
  })
})

describe('newCard', () => {
  it('New の状態で、出題日は作った時刻', () => {
    const t = at(2026, 10, 20, 12)
    const c = newCard(t)
    expect(c.state).toBe(State.New)
    expect(c.due.getTime()).toBe(t.getTime())
    expect(c.reps).toBe(0)
  })
})

describe('reviewCard（ts-fsrs の日の数え方をアプリの朝 4 時に合わせる。仕様書 6-2）', () => {
  const cases = [
    { name: '23 時 00 分 → 翌 7 時 00 分', t1: at(2026, 10, 20, 23, 0), t2: at(2026, 10, 21, 7, 0), raw: 0, app: 1 },
    { name: '8 時 59 分 → 9 時 01 分', t1: at(2026, 10, 20, 8, 59), t2: at(2026, 10, 20, 9, 1), raw: 1, app: 0 },
    { name: '3 時 59 分 → 4 時 01 分', t1: at(2026, 10, 20, 3, 59), t2: at(2026, 10, 20, 4, 1), raw: 0, app: 1 },
  ]

  for (const c of cases) {
    it(`${c.name}: 2 回目の elapsed_days はアプリの日の差の ${c.app}`, () => {
      const first = reviewCard(newCard(c.t1), c.t1, 3)
      const second = reviewCard(first.card, c.t2, 3)
      expect(second.elapsedDays).toBe(c.app)
      expect(dayDiff(dayOf(c.t1), dayOf(c.t2))).toBe(c.app)
    })

    it(`${c.name}: ts-fsrs のままだと ${c.raw}（対比。この食い違いを直すためにずらす）`, () => {
      const f = fsrs({ enable_fuzz: true })
      const first = f.next(createEmptyCard(c.t1), c.t1, Rating.Good)
      const second = f.next(first.card, c.t2, Rating.Good)
      expect(second.log.elapsed_days).toBe(c.raw)
    })
  }

  it('入力のカードを書き換えない', () => {
    const t1 = at(2026, 10, 20, 23)
    const c0 = newCard(t1)
    const snap0 = structuredClone(c0)
    const r1 = reviewCard(c0, t1, 3)
    expect(c0).toEqual(snap0)
    const snap1 = structuredClone(r1.card)
    reviewCard(r1.card, at(2026, 10, 21, 7), 1)
    expect(r1.card).toEqual(snap1)
  })

  it('返ったカードの last_review は解いた時刻（ずらさない）', () => {
    const t = at(2026, 10, 20, 23, 0)
    const r = reviewCard(newCard(t), t, 3)
    expect(r.card.last_review?.getTime()).toBe(t.getTime())
  })

  it('返ったカードの due もずらさない時刻（新しいカードの Good は 10 分後、Again は 1 分後）', () => {
    const t = at(2026, 10, 20, 23, 0)
    expect(reviewCard(newCard(t), t, 3).card.due.getTime()).toBe(t.getTime() + 10 * MIN)
    expect(reviewCard(newCard(t), t, 1).card.due.getTime()).toBe(t.getTime() + 1 * MIN)
  })

  it('Good を 2 回で Review の状態になり、出題日はアプリの日で 2 日後', () => {
    const t1 = at(2026, 10, 20, 23, 0)
    const { card, lastAt } = reviewStateCard(t1)
    expect(card.state).toBe(State.Review)
    expect(dayDiff(dayOf(lastAt), dueDay(card))).toBe(2)
  })

  it('同じカード・同じ時刻・同じ評価なら同じ結果（間隔のゆらぎがあっても）', () => {
    const { card, lastAt } = reviewStateCard(at(2026, 10, 20, 23, 0))
    const t3 = new Date(lastAt.getTime() + 2 * DAY)
    const a = reviewCard(card, t3, 3)
    const b = reviewCard(card, t3, 3)
    expect(a).toEqual(b)
    expect(a.card.scheduled_days).toBeGreaterThan(2)
  })

  it('判定を直すとき: 解く前のカードに元の時刻で付け直すと、最初からその評価を付けたのと同じになる', () => {
    const { card: before, lastAt } = reviewStateCard(at(2026, 10, 20, 23, 0))
    const t3 = new Date(lastAt.getTime() + 2 * DAY)
    const direct = reviewCard(before, t3, 3)
    reviewCard(before, t3, 2) // 元は △（Hard）だった
    const redo = reviewCard(before, t3, 3) // ○ に直した
    expect(redo).toEqual(direct)
  })
})

describe('isNew・isReviewState・dueDay', () => {
  it('新しいカードは isNew、Review の状態のカードは isReviewState', () => {
    const t = at(2026, 10, 20, 12)
    const c = newCard(t)
    expect(isNew(c)).toBe(true)
    expect(isReviewState(c)).toBe(false)
    const learning = reviewCard(c, t, 3).card
    expect(learning.state).toBe(State.Learning)
    expect(isNew(learning)).toBe(false)
    expect(isReviewState(learning)).toBe(false)
    const { card } = reviewStateCard(t)
    expect(isReviewState(card)).toBe(true)
  })

  it('dueDay は出題日のアプリの日（3 時 59 分は前の日）', () => {
    const c = { ...newCard(at(2026, 10, 20)), due: at(2026, 10, 21, 3, 59) }
    expect(dueDay(c)).toBe('2026-10-20')
  })
})

describe('reviveCard（JSON から戻したカード）', () => {
  it('日時の文字列を Date に戻し、元のカードと同じになる', () => {
    const { card } = reviewStateCard(at(2026, 10, 20, 23, 0))
    const raw: unknown = JSON.parse(JSON.stringify(card))
    const revived = reviveCard(raw)
    expect(revived.due).toBeInstanceOf(Date)
    expect(revived.last_review).toBeInstanceOf(Date)
    expect(revived).toEqual(card)
  })

  it('last_review の無い新しいカードも戻せる', () => {
    const c = newCard(at(2026, 10, 20, 12))
    const revived = reviveCard(JSON.parse(JSON.stringify(c)))
    expect(revived.last_review).toBeUndefined()
    expect(revived.state).toBe(State.New)
    expect(revived.due.getTime()).toBe(c.due.getTime())
  })

  it('戻したカードを ts-fsrs の next と reviewCard に渡せて、元のカードと同じ結果になる', () => {
    const { card, lastAt } = reviewStateCard(at(2026, 10, 20, 23, 0))
    const revived = reviveCard(JSON.parse(JSON.stringify(card)))
    const t3 = new Date(lastAt.getTime() + 2 * DAY)
    const f = fsrs({ enable_fuzz: true })
    expect(f.next(revived, t3, Rating.Good).card).toEqual(f.next(card, t3, Rating.Good).card)
    expect(reviewCard(revived, t3, 3)).toEqual(reviewCard(card, t3, 3))
  })

  it('形式が違えば Error を投げる', () => {
    const good: Record<string, unknown> = JSON.parse(JSON.stringify(newCard(at(2026, 10, 20))))
    expect(() => reviveCard(null)).toThrow()
    expect(() => reviveCard('card')).toThrow()
    expect(() => reviveCard({ ...good, due: undefined })).toThrow()
    expect(() => reviveCard({ ...good, due: 'あした' })).toThrow()
    expect(() => reviveCard({ ...good, last_review: 'きのう' })).toThrow()
    expect(() => reviveCard({ ...good, stability: '1.5' })).toThrow()
    expect(() => reviveCard({ ...good, reps: null })).toThrow()
    expect(() => reviveCard({ ...good, state: 9 })).toThrow()
  })
})

describe('isClockError（仕様書 12 章: 端末の時計を戻したときなど）', () => {
  it('解いた時刻が前回より前のアプリの日なら reviewCard が投げ、isClockError で見分けられる', () => {
    const t1 = at(2026, 10, 20, 10)
    const card = reviewCard(newCard(t1), t1, 3).card
    let thrown: unknown
    try {
      reviewCard(card, at(2026, 10, 19, 10), 3)
    } catch (e) {
      thrown = e
    }
    expect(thrown).toBeInstanceOf(Error)
    expect(isClockError(thrown)).toBe(true)
  })

  it('同じアプリの日のうちに戻した時刻なら投げない', () => {
    const t1 = at(2026, 10, 20, 10)
    const card = reviewCard(newCard(t1), t1, 3).card
    expect(() => reviewCard(card, at(2026, 10, 20, 9), 3)).not.toThrow()
  })

  it('ほかのエラーは時刻の誤りとみなさない', () => {
    expect(isClockError(new Error('保存できません'))).toBe(false)
    expect(isClockError('Invalid delta_t')).toBe(false)
    expect(isClockError(undefined)).toBe(false)
  })
})
