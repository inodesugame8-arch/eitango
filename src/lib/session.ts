// 次の 1 問の選び方と、その日のうちにもう一度出す予定（仕様書 6-4）
import { State, type Card } from 'ts-fsrs'
import { AGAIN_AFTER_ANSWERS, LEARN_AHEAD_MS, PRACTICE_AFTER_ANSWERS } from './config.ts'
import { dayOf } from './day.ts'
import type { PendingEntry, SessionState, Verdict } from './types.ts'

export function newSession(day: string): SessionState {
  return { day, answers: 0, seq: 0, pending: [], practiced: [], extraNew: 0 }
}

// 「もっとやる」の「新しい問題を足す」: 今日の新しい問題の上限を count だけ増やす（その日だけ。仕様書 6-9）
export function addExtraNew(session: SessionState, count: number): SessionState {
  return { ...session, extraNew: session.extraNew + count }
}

// 保存した予定が今のアプリの日のものなら引き継ぎ、違えば（朝 4 時をまたいだら）新しく作る
export function ensureSession(session: SessionState | undefined, now: Date): SessionState {
  const day = dayOf(now)
  return session && session.day === day ? session : newSession(day)
}

// 学習ステップの予定を足す（すでに予定にあるカードは足さない）
export function addStepEntries(
  session: SessionState,
  entries: readonly { cardId: string; dueAt: Date }[],
): SessionState {
  const pending = [...session.pending]
  let seq = session.seq
  for (const e of entries) {
    if (pending.some((p) => p.cardId === e.cardId)) continue
    pending.push({ cardId: e.cardId, reason: 'step', seq, dueAt: e.dueAt })
    seq += 1
  }
  return { ...session, seq, pending }
}

// 次の 1 問（TypeScript の組み込みの Pick と同じ名前を避けて NextPick）
export type NextPick =
  | { kind: 'card'; cardId: string; practice: boolean; from: 'pending' | 'queue' }
  | { kind: 'done' }

function fromPending(p: PendingEntry): NextPick {
  return { kind: 'card', cardId: p.cardId, practice: p.reason === 'practice', from: 'pending' }
}

function bySeq(a: PendingEntry, b: PendingEntry): number {
  return a.seq - b.seq
}

// 予定から選んだカードは、recordAnswer するまで予定に残す（途中でやめても残るように）
export function pickNext(session: SessionState, queue: readonly string[], now: Date): NextPick {
  const t = now.getTime()
  // 1. 出番の来た予定（3 問たった ×・出題日が来た学習中のカード・5 問たった △ の練習）を、予定に入れた順に
  const ready = session.pending
    .filter((p) =>
      p.reason === 'step'
        ? p.dueAt !== undefined && p.dueAt.getTime() <= t
        : session.answers >= (p.afterAnswers ?? 0),
    )
    .sort(bySeq)
  if (ready.length > 0) return fromPending(ready[0])

  // 2. 今日の並びの次のカード
  if (queue.length > 0) return { kind: 'card', cardId: queue[0], practice: false, from: 'queue' }

  // 3. 待たずに出す: × と練習（予定に入れた順）、次に出題日が 20 分以内で今日の学習中のカード（出題日の早い順）
  const waiting = session.pending.filter((p) => p.reason !== 'step').sort(bySeq)
  if (waiting.length > 0) return fromPending(waiting[0])
  const ahead = session.pending
    .filter(
      (p) =>
        p.reason === 'step' &&
        p.dueAt !== undefined &&
        p.dueAt.getTime() - t <= LEARN_AHEAD_MS &&
        dayOf(p.dueAt) === session.day,
    )
    .sort((a, b) => (a.dueAt?.getTime() ?? 0) - (b.dueAt?.getTime() ?? 0) || a.seq - b.seq)
  if (ahead.length > 0) return fromPending(ahead[0])

  // 4. どれも無ければ今日の分は終わり
  return { kind: 'done' }
}

export interface AnswerInfo {
  cardId: string
  practice: boolean
  verdict: Verdict
  cardAfter: Card // 練習のときは解く前と同じカード
}

// 答えを予定に反映する。判定を直したときは、答える前の session から新しい判定でやり直す（仕様書 6-6）
export function recordAnswer(session: SessionState, info: AnswerInfo): SessionState {
  const pending = session.pending.filter((p) => p.cardId !== info.cardId)
  const answers = session.answers + 1
  const base: SessionState = { ...session, answers, pending }
  // 練習の結果は FSRS に渡さないので、予定も足さない
  if (info.practice) return base

  if (dayOf(info.cardAfter.due) === session.day) {
    const entry: PendingEntry =
      info.verdict === 'wrong'
        ? { cardId: info.cardId, reason: 'again', seq: session.seq, afterAnswers: answers + AGAIN_AFTER_ANSWERS }
        : { cardId: info.cardId, reason: 'step', seq: session.seq, dueAt: info.cardAfter.due }
    return { ...base, seq: session.seq + 1, pending: [...pending, entry] }
  }

  // 練習を入れるのは、答えた後のカードが Review の状態のときだけ（学習中のカードを朝 4 時の直前に △ で答え、
  // 出題日が次のアプリの日になった場合には入れない）
  if (
    info.verdict === 'close' &&
    info.cardAfter.state === State.Review &&
    !session.practiced.includes(info.cardId)
  ) {
    const entry: PendingEntry = {
      cardId: info.cardId,
      reason: 'practice',
      seq: session.seq,
      afterAnswers: answers + PRACTICE_AFTER_ANSWERS,
    }
    return {
      ...base,
      seq: session.seq + 1,
      pending: [...pending, entry],
      practiced: [...session.practiced, info.cardId],
    }
  }
  return base
}

// 語を消したときなど、そのカードの予定を消す
export function removeCard(session: SessionState, cardId: string): SessionState {
  return { ...session, pending: session.pending.filter((p) => p.cardId !== cardId) }
}

// 進み具合の右の数のうち、まだ残っている分（予定の数 + 並びの数）
export function remainingCount(session: SessionState, queue: readonly string[]): number {
  return session.pending.length + queue.length
}
