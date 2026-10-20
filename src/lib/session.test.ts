import { createEmptyCard, State, type Card } from 'ts-fsrs'
import { describe, expect, it } from 'vitest'
import {
  addExtraNew,
  addStepEntries,
  ensureSession,
  newSession,
  pickNext,
  recordAnswer,
  remainingCount,
  removeCard,
  type NextPick,
} from './session.ts'
import { newCard, reviewCard } from './srs.ts'
import type { SessionState, Verdict } from './types.ts'

const MIN = 60_000

// 端末の時計（テストでは Asia/Tokyo）での日時。月は 1 から数える
function at(y: number, mo: number, d: number, h = 0, mi = 0): Date {
  return new Date(y, mo - 1, d, h, mi)
}

const DAY = '2026-10-20'
const now = at(2026, 10, 20, 21, 0)

// Review の状態のカード（出題日は今日）
function reviewState(): Card {
  return {
    ...createEmptyCard(at(2026, 10, 1)),
    state: State.Review,
    due: at(2026, 10, 20, 8),
    last_review: at(2026, 10, 10),
    stability: 10,
    difficulty: 5,
    scheduled_days: 10,
    reps: 3,
  }
}

// 解いて、その判定で recordAnswer する
function answer(
  session: SessionState,
  cardId: string,
  before: Card,
  t: Date,
  verdict: Verdict,
  practice = false,
): { session: SessionState; card: Card } {
  const rating = verdict === 'wrong' ? 1 : verdict === 'close' ? 2 : 3
  const card = practice ? before : reviewCard(before, t, rating).card
  return { session: recordAnswer(session, { cardId, practice, verdict, cardAfter: card }), card }
}

describe('newSession・ensureSession', () => {
  it('newSession は空の予定', () => {
    expect(newSession(DAY)).toEqual({ day: DAY, answers: 0, seq: 0, pending: [], practiced: [], extraNew: 0 })
  })

  it('保存した予定が無ければ、今のアプリの日で新しく作る', () => {
    expect(ensureSession(undefined, at(2026, 10, 21, 3, 59))).toEqual(newSession('2026-10-20'))
  })

  it('同じアプリの日なら、保存した予定をそのまま引き継ぐ', () => {
    const s: SessionState = {
      day: DAY,
      answers: 4,
      seq: 2,
      pending: [{ cardId: 'a:en-ja', reason: 'again', seq: 1, afterAnswers: 6 }],
      practiced: ['b:en-ja'],
      extraNew: 5,
    }
    expect(ensureSession(s, at(2026, 10, 21, 3, 59))).toBe(s)
  })

  it('アプリの日が変わったら（朝 4 時をまたいだら）、予定を捨てて新しく作る', () => {
    const s: SessionState = {
      day: DAY,
      answers: 4,
      seq: 2,
      pending: [{ cardId: 'a:en-ja', reason: 'again', seq: 1, afterAnswers: 6 }],
      practiced: ['b:en-ja'],
      extraNew: 5,
    }
    // 「新しい問題を足す」で増やした分もその日だけ（仕様書 6-9）
    expect(ensureSession(s, at(2026, 10, 21, 4, 0))).toEqual(newSession('2026-10-21'))
  })
})

describe('addStepEntries', () => {
  it('学習ステップの予定を seq の順に足し、元の予定は変えない', () => {
    const s = newSession(DAY)
    const t1 = at(2026, 10, 20, 21, 5)
    const t2 = at(2026, 10, 20, 21, 3)
    const next = addStepEntries(s, [
      { cardId: 'a:en-ja', dueAt: t1 },
      { cardId: 'b:en-ja', dueAt: t2 },
    ])
    expect(next.pending).toEqual([
      { cardId: 'a:en-ja', reason: 'step', seq: 0, dueAt: t1 },
      { cardId: 'b:en-ja', reason: 'step', seq: 1, dueAt: t2 },
    ])
    expect(next.seq).toBe(2)
    expect(s.pending).toEqual([])
  })

  it('すでに予定にあるカードは足さない', () => {
    const s = addStepEntries(newSession(DAY), [{ cardId: 'a:en-ja', dueAt: now }])
    const next = addStepEntries(s, [{ cardId: 'a:en-ja', dueAt: now }])
    expect(next.pending).toHaveLength(1)
    expect(next.seq).toBe(1)
  })
})

describe('pickNext（仕様書 6-4「次の 1 問の選び方」）', () => {
  it('並びの先頭を出す（予定が無いとき）', () => {
    expect(pickNext(newSession(DAY), ['a:en-ja', 'b:en-ja'], now)).toEqual({
      kind: 'card',
      cardId: 'a:en-ja',
      practice: false,
      from: 'queue',
    })
  })

  it('出題日の来た学習中のカードが、並びより先に出る', () => {
    const s = addStepEntries(newSession(DAY), [{ cardId: 'l:en-ja', dueAt: at(2026, 10, 20, 20, 59) }])
    expect(pickNext(s, ['a:en-ja'], now)).toEqual({
      kind: 'card',
      cardId: 'l:en-ja',
      practice: false,
      from: 'pending',
    })
  })

  it('出題日がまだの学習中のカードより、並びを先に出す', () => {
    const s = addStepEntries(newSession(DAY), [{ cardId: 'l:en-ja', dueAt: at(2026, 10, 20, 21, 1) }])
    expect(pickNext(s, ['a:en-ja'], now)).toMatchObject({ cardId: 'a:en-ja', from: 'queue' })
  })

  it('× のカードは、ほかの問題を 3 問解いた後に並びより先に出る', () => {
    let s = newSession(DAY)
    const queue = ['b:en-ja', 'c:en-ja', 'd:en-ja', 'e:en-ja']
    s = answer(s, 'a:en-ja', newCard(now), now, 'wrong').session
    expect(s.pending).toEqual([{ cardId: 'a:en-ja', reason: 'again', seq: 0, afterAnswers: 4 }])
    for (const id of ['b:en-ja', 'c:en-ja']) {
      const pick = pickNext(s, queue, now)
      expect(pick).toMatchObject({ cardId: id, from: 'queue' })
      queue.shift()
      s = answer(s, id, reviewState(), now, 'correct').session
    }
    // 2 問しか解いていないので、まだ並び
    expect(pickNext(s, queue, now)).toMatchObject({ cardId: 'd:en-ja', from: 'queue' })
    queue.shift()
    s = answer(s, 'd:en-ja', reviewState(), now, 'correct').session
    // 3 問解いたので × のカード
    expect(pickNext(s, queue, now)).toEqual({ kind: 'card', cardId: 'a:en-ja', practice: false, from: 'pending' })
  })

  it('出番の来た予定が複数あれば、seq の小さいものから（配列の順ではない）', () => {
    const s: SessionState = {
      day: DAY,
      answers: 10,
      seq: 9,
      pending: [
        { cardId: 'late:en-ja', reason: 'again', seq: 7, afterAnswers: 8 },
        { cardId: 'step:en-ja', reason: 'step', seq: 5, dueAt: at(2026, 10, 20, 20, 50) },
        { cardId: 'early:en-ja', reason: 'practice', seq: 2, afterAnswers: 9 },
      ],
      practiced: ['early:en-ja'],
      extraNew: 0,
    }
    expect(pickNext(s, ['q:en-ja'], now)).toEqual({
      kind: 'card',
      cardId: 'early:en-ja',
      practice: true,
      from: 'pending',
    })
  })

  it('予定から選んでも、予定は消さない（recordAnswer するまで残す）', () => {
    const s = addStepEntries(newSession(DAY), [{ cardId: 'l:en-ja', dueAt: at(2026, 10, 20, 20, 59) }])
    const before = structuredClone(s)
    pickNext(s, [], now)
    expect(s).toEqual(before)
  })

  it('最後の 1 枚が × なら、答えを見た直後でもすぐもう一度出る', () => {
    const s = answer(newSession(DAY), 'a:en-ja', newCard(now), now, 'wrong').session
    expect(pickNext(s, [], now)).toEqual({ kind: 'card', cardId: 'a:en-ja', practice: false, from: 'pending' })
  })

  it('最後に △ の練習だけ残ったら、すぐ練習として出る', () => {
    const r = answer(newSession(DAY), 'a:en-ja', reviewState(), now, 'close')
    expect(r.card.state).toBe(State.Review)
    expect(r.session.pending).toEqual([{ cardId: 'a:en-ja', reason: 'practice', seq: 0, afterAnswers: 6 }])
    expect(pickNext(r.session, [], now)).toEqual({ kind: 'card', cardId: 'a:en-ja', practice: true, from: 'pending' })
  })

  it('待たずに出すときは、× と練習（seq の順）が、学習中のカードより先', () => {
    const s: SessionState = {
      day: DAY,
      answers: 1,
      seq: 3,
      pending: [
        { cardId: 'step:en-ja', reason: 'step', seq: 0, dueAt: at(2026, 10, 20, 21, 2) },
        { cardId: 'p:en-ja', reason: 'practice', seq: 2, afterAnswers: 6 },
        { cardId: 'x:en-ja', reason: 'again', seq: 1, afterAnswers: 4 },
      ],
      practiced: ['p:en-ja'],
      extraNew: 0,
    }
    expect(pickNext(s, [], now)).toMatchObject({ cardId: 'x:en-ja', practice: false })
    const s2 = { ...s, pending: s.pending.filter((p) => p.cardId !== 'x:en-ja') }
    expect(pickNext(s2, [], now)).toMatchObject({ cardId: 'p:en-ja', practice: true })
  })

  it('学習中のカードは出題日の早い順に前倒しする', () => {
    const s = addStepEntries(newSession(DAY), [
      { cardId: 'later:en-ja', dueAt: at(2026, 10, 20, 21, 9) },
      { cardId: 'sooner:en-ja', dueAt: at(2026, 10, 20, 21, 4) },
    ])
    expect(pickNext(s, [], now)).toMatchObject({ cardId: 'sooner:en-ja', from: 'pending' })
  })

  it('学習中のカードは、出題日が 20 分以内なら前倒しして出す（ちょうど 20 分も出す）', () => {
    const s = addStepEntries(newSession(DAY), [{ cardId: 'l:en-ja', dueAt: new Date(now.getTime() + 20 * MIN) }])
    expect(pickNext(s, [], now)).toEqual({ kind: 'card', cardId: 'l:en-ja', practice: false, from: 'pending' })
  })

  it('出題日が 20 分より先の学習中のカードは出さない（今日の分は終わり）', () => {
    const s = addStepEntries(newSession(DAY), [
      { cardId: 'l:en-ja', dueAt: new Date(now.getTime() + 20 * MIN + 1) },
    ])
    expect(pickNext(s, [], now)).toEqual({ kind: 'done' })
  })

  it('3 時 55 分に ○ で出題日が 4 時 05 分（次のアプリの日）になったカードは前倒ししない', () => {
    const t = at(2026, 10, 21, 3, 55)
    const s0 = newSession('2026-10-20')
    const r = answer(s0, 'a:en-ja', newCard(t), t, 'correct')
    expect(r.card.state).toBe(State.Learning)
    expect(r.card.due).toEqual(at(2026, 10, 21, 4, 5))
    expect(r.session.pending).toEqual([])
    expect(pickNext(r.session, [], t)).toEqual({ kind: 'done' })
    // 予定に入っていても、出題日のアプリの日が今日でなければ前倒ししない
    const s = addStepEntries(s0, [{ cardId: 'a:en-ja', dueAt: at(2026, 10, 21, 4, 5) }])
    expect(pickNext(s, [], t)).toEqual({ kind: 'done' })
  })

  it('予定も並びも無ければ done', () => {
    const done: NextPick = { kind: 'done' }
    expect(pickNext(newSession(DAY), [], now)).toEqual(done)
  })
})

describe('recordAnswer（仕様書 6-4 の表）', () => {
  it('答えるたびに answers を 1 増やす', () => {
    const s = answer(newSession(DAY), 'a:en-ja', reviewState(), now, 'correct').session
    expect(s.answers).toBe(1)
  })

  it('× で出題日が今日: again（3 問後）', () => {
    const r = answer(newSession(DAY), 'a:en-ja', reviewState(), now, 'wrong')
    expect(r.card.state).toBe(State.Relearning)
    expect(r.session.pending).toEqual([{ cardId: 'a:en-ja', reason: 'again', seq: 0, afterAnswers: 4 }])
    expect(r.session.seq).toBe(1)
  })

  it('△・○ で出題日が今日（学習中のカード）: step（FSRS の出題日）', () => {
    const r = answer(newSession(DAY), 'a:en-ja', newCard(now), now, 'correct')
    expect(r.card.state).toBe(State.Learning)
    expect(r.session.pending).toEqual([{ cardId: 'a:en-ja', reason: 'step', seq: 0, dueAt: r.card.due }])
    const h = answer(newSession(DAY), 'b:en-ja', newCard(now), now, 'close')
    expect(h.session.pending).toEqual([{ cardId: 'b:en-ja', reason: 'step', seq: 0, dueAt: h.card.due }])
  })

  it('△ で出題日が明日以降（Review の状態のカード）: practice（5 問後に 1 回）', () => {
    const r = answer(newSession(DAY), 'a:en-ja', reviewState(), now, 'close')
    expect(r.session.pending).toEqual([{ cardId: 'a:en-ja', reason: 'practice', seq: 0, afterAnswers: 6 }])
    expect(r.session.practiced).toEqual(['a:en-ja'])
  })

  it('3 時 58 分に学習中のカードを △ で答え、出題日が 4 時 04 分（次のアプリの日）になったら練習を入れない', () => {
    const t = at(2026, 10, 21, 3, 58)
    const r = answer(newSession('2026-10-20'), 'a:en-ja', newCard(t), t, 'close')
    expect(r.card.state).toBe(State.Learning)
    expect(r.card.due).toEqual(at(2026, 10, 21, 4, 4))
    expect(r.session.pending).toEqual([])
    expect(r.session.practiced).toEqual([])
    expect(r.session.seq).toBe(0)
    expect(r.session.answers).toBe(1)
  })

  it('3 時 52 分に Review の状態のカードを × で答え、出題日が 4 時 02 分（次のアプリの日）になったら again を足さない（最後の 1 枚なら今日の分は終わり）', () => {
    const t = at(2026, 10, 21, 3, 52)
    const r = answer(newSession('2026-10-20'), 'a:en-ja', reviewState(), t, 'wrong')
    expect(r.card.state).toBe(State.Relearning)
    expect(r.card.due).toEqual(at(2026, 10, 21, 4, 2))
    expect(r.session.pending).toEqual([])
    expect(r.session.seq).toBe(0)
    expect(r.session.answers).toBe(1)
    expect(pickNext(r.session, [], t)).toEqual({ kind: 'done' })
  })

  it('○ で出題日が明日以降: 何も足さない', () => {
    const r = answer(newSession(DAY), 'a:en-ja', reviewState(), now, 'correct')
    expect(r.session.pending).toEqual([])
    expect(r.session.seq).toBe(0)
  })

  it('練習の答えは、予定から消して answers を増やすだけ（× でも again を足さない）', () => {
    const r = answer(newSession(DAY), 'a:en-ja', reviewState(), now, 'close')
    const p = answer(r.session, 'a:en-ja', r.card, now, 'wrong', true)
    expect(p.session.pending).toEqual([])
    expect(p.session.answers).toBe(2)
    expect(p.session.seq).toBe(1)
  })

  it('練習は 1 枚 1 回（同じカードの △ がもう一度あっても練習を足さない）', () => {
    const r1 = answer(newSession(DAY), 'a:en-ja', reviewState(), now, 'close')
    const r2 = answer(r1.session, 'a:en-ja', reviewState(), now, 'close')
    expect(r2.session.pending).toEqual([])
    expect(r2.session.practiced).toEqual(['a:en-ja'])
  })

  it('同じカードの予定はまず消してから足す（学習ステップ → × で again に置き換わる）', () => {
    const r1 = answer(newSession(DAY), 'a:en-ja', newCard(now), now, 'correct')
    const t2 = r1.card.due
    const r2 = answer(r1.session, 'a:en-ja', r1.card, t2, 'wrong')
    expect(r2.session.pending).toEqual([{ cardId: 'a:en-ja', reason: 'again', seq: 1, afterAnswers: 5 }])
  })

  it('元の session は変えない', () => {
    const s = newSession(DAY)
    const before = structuredClone(s)
    answer(s, 'a:en-ja', reviewState(), now, 'close')
    expect(s).toEqual(before)
  })

  it('判定を直すときは、答える前の session から新しい判定でやり直す', () => {
    const s0 = addStepEntries(newSession(DAY), [{ cardId: 'z:en-ja', dueAt: at(2026, 10, 20, 22) }])
    const wrong = answer(s0, 'a:en-ja', reviewState(), now, 'wrong').session
    const fixed = answer(s0, 'a:en-ja', reviewState(), now, 'correct').session
    expect(wrong.pending.map((p) => p.reason)).toEqual(['step', 'again'])
    expect(fixed.pending.map((p) => p.reason)).toEqual(['step'])
    expect(fixed.answers).toBe(1)
  })
})

describe('removeCard・remainingCount', () => {
  it('removeCard はそのカードの予定を消す', () => {
    const s = addStepEntries(newSession(DAY), [
      { cardId: 'a:en-ja', dueAt: now },
      { cardId: 'b:en-ja', dueAt: now },
    ])
    expect(removeCard(s, 'a:en-ja').pending.map((p) => p.cardId)).toEqual(['b:en-ja'])
    expect(s.pending).toHaveLength(2)
  })

  it('remainingCount は予定の数 + 並びの数', () => {
    const s = addStepEntries(newSession(DAY), [{ cardId: 'a:en-ja', dueAt: now }])
    expect(remainingCount(s, ['b:en-ja', 'c:en-ja'])).toBe(3)
    expect(remainingCount(newSession(DAY), [])).toBe(0)
  })
})

describe('addExtraNew（もっとやる の「新しい問題を足す」。仕様書 6-9）', () => {
  it('新しい問題の上限を足し、元の予定は変えない', () => {
    const s = newSession(DAY)
    const once = addExtraNew(s, 5)
    expect(once.extraNew).toBe(5)
    expect(addExtraNew(once, 5).extraNew).toBe(10)
    expect(s.extraNew).toBe(0)
  })

  it('答えても増やした分は残る（開き直しても続く）', () => {
    const s = addExtraNew(newSession(DAY), 5)
    const r = answer(s, 'a:en-ja', reviewState(), now, 'correct')
    expect(r.session.extraNew).toBe(5)
  })
})
