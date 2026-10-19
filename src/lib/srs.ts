// ts-fsrs 5.4.2 を呼ぶ関数（仕様書 6-2・6-7）
// ts-fsrs は前回からの日数を世界標準時の日付の差で数える（日本では朝 9 時に日が変わる）。
// そこで渡すカードの due・last_review と解いた時刻を同じ幅だけ進めて渡し、返ったカードを同じ幅だけ戻す。
// こうすると ts-fsrs の日の変わり目がアプリの朝 4 時と一致する。ts-fsrs 6.0 で時間帯の設定が入ったら外す
import { createEmptyCard, fsrs, State, type Card } from 'ts-fsrs'
import { DAY_START_HOUR } from './config.ts'
import { dayOf } from './day.ts'
import type { RatingValue } from './types.ts'

const HOUR_MS = 3_600_000

// 目標正答率 0.9・学習ステップ 1 分と 10 分・再学習ステップ 10 分は ts-fsrs の既定。違うのは fuzz だけ
const scheduler = fsrs({ enable_fuzz: true })

// ずらす幅 =（端末と世界標準時の時差 − 4 時間）。日本なら 5 時間
export function fsrsShiftMs(at: Date): number {
  return (-at.getTimezoneOffset() / 60 - DAY_START_HOUR) * HOUR_MS
}

function moveDate(d: Date, ms: number): Date {
  return new Date(d.getTime() + ms)
}

// due・last_review を ms だけ動かした新しいカード（元のカードは変えない）
function moveCard(card: Card, ms: number): Card {
  const moved: Card = { ...card, due: moveDate(card.due, ms) }
  if (card.last_review) moved.last_review = moveDate(card.last_review, ms)
  return moved
}

export function newCard(now: Date): Card {
  return createEmptyCard(now)
}

// 評価を付ける。返すカードの due・last_review はずらさない時刻。elapsedDays はテスト用
export function reviewCard(
  card: Card,
  at: Date,
  rating: RatingValue,
): { card: Card; elapsedDays: number } {
  const ms = fsrsShiftMs(at)
  const { card: next, log } = scheduler.next(moveCard(card, ms), moveDate(at, ms), rating)
  return { card: moveCard(next, -ms), elapsedDays: log.elapsed_days }
}

// ts-fsrs が時刻の誤りで止まったか（解いた時刻が前回より前のアプリの日。端末の時計を戻したときなど）。
// ts-fsrs 5.4.2 は FSRSValidationError: Invalid delta_t "-1" を投げるが、その型を export していないので文で見分ける
export function isClockError(e: unknown): boolean {
  return e instanceof Error && e.message.includes('Invalid delta_t')
}

export function isNew(card: Card): boolean {
  return card.state === State.New
}

export function isReviewState(card: Card): boolean {
  return card.state === State.Review
}

// 出題日のアプリの日
export function dueDay(card: Card): string {
  return dayOf(card.due)
}

const NUMBER_KEYS = [
  'stability',
  'difficulty',
  'elapsed_days',
  'scheduled_days',
  'learning_steps',
  'reps',
  'lapses',
] as const

const STATES: readonly unknown[] = [State.New, State.Learning, State.Review, State.Relearning]

function toDate(value: unknown, key: string): Date {
  const d =
    value instanceof Date
      ? new Date(value.getTime())
      : typeof value === 'string'
        ? new Date(value)
        : undefined
  if (!d || Number.isNaN(d.getTime())) throw new Error(`カードの ${key} が日時ではありません`)
  return d
}

// JSON から戻したカード（日時が文字列）を、ts-fsrs に渡せる Card に戻す。形式が違えば Error を投げる
export function reviveCard(raw: unknown): Card {
  if (typeof raw !== 'object' || raw === null) throw new Error('カードの形式が違います')
  const r = raw as Record<string, unknown>
  const num = (key: (typeof NUMBER_KEYS)[number]): number => {
    const v = r[key]
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`カードの ${key} が数ではありません`)
    return v
  }
  if (!STATES.includes(r.state)) throw new Error('カードの state が違います')
  const card: Card = {
    due: toDate(r.due, 'due'),
    stability: num('stability'),
    difficulty: num('difficulty'),
    elapsed_days: num('elapsed_days'),
    scheduled_days: num('scheduled_days'),
    learning_steps: num('learning_steps'),
    reps: num('reps'),
    lapses: num('lapses'),
    state: r.state as State,
  }
  if (r.last_review !== undefined && r.last_review !== null) {
    card.last_review = toDate(r.last_review, 'last_review')
  }
  return card
}
