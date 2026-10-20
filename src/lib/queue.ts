// 今日の問題の集め方（仕様書 6-3）
import { State } from 'ts-fsrs'
import { NEW_CARD_FACTOR, REVIEW_CAP_FOR_NEW, SECONDS_PER_CARD } from './config.ts'
import { dayOf } from './day.ts'
import { orderByHash } from './random.ts'
import { dueDay } from './srs.ts'
import type { CardRecord, Direction, ReviewRecord, Word } from './types.ts'

export interface TodayInput {
  words: readonly Word[]
  cards: readonly CardRecord[]
  reviews: readonly ReviewRecord[]
  now: Date
  newPerDay: number
  pendingCardIds: ReadonlySet<string> // もう一度出す予定に入っているカード（今日の並びから除く）
  extraNew?: number // 「新しい問題を足す」で増やした分（既定 0）。80 枚の決まりは見ない（仕様書 6-9）
}

export interface TodayPlan {
  queue: string[] // 今日の並び（英→日のまとまり、次に日→英のまとまり）
  stepEntries: { cardId: string; dueAt: Date }[] // 出題日が今日のうちで今より後の学習中のカード（予定に足す）
  reviewTotal: number // 80 枚の決まりで数える枚数
  reviewRemaining: number // 今日の復習のうち、今日まだ解いていない枚数
  newRemaining: number // 今日まだ出していない新しいカードの枚数（並びに入れた分）
  allowNew: boolean
}

function key(wordId: string, direction: Direction): string {
  return `${wordId}\u0000${direction}`
}

function other(direction: Direction): Direction {
  return direction === 'en-ja' ? 'ja-en' : 'en-ja'
}

export function buildToday(input: TodayInput): TodayPlan {
  const { words, cards, reviews, now, newPerDay, pendingCardIds } = input
  const extraNew = input.extraNew ?? 0
  // 1. 今日の解答記録（練習は除く）
  const today = dayOf(now)
  const todayReviews = reviews.filter((r) => r.day === today && !r.practice)
  const solvedToday = new Set(todayReviews.map((r) => r.cardId))

  // 2. 今日初めて解いた新しいカード
  const newTodayReviews = todayReviews.filter((r) => r.before.state === State.New)
  const newToday = new Set(newTodayReviews.map((r) => r.cardId))
  const newTodayCount = (direction: Direction): number =>
    new Set(newTodayReviews.filter((r) => r.direction === direction).map((r) => r.cardId)).size

  const byWordDir = new Map<string, CardRecord>()
  for (const c of cards) byWordDir.set(key(c.wordId, c.direction), c)
  const sibling = (c: CardRecord): CardRecord | undefined => byWordDir.get(key(c.wordId, other(c.direction)))
  // 同じ語のもう片方を今日解いていれば、このカードは今日は出さない
  const siblingSolved = (c: CardRecord): boolean => {
    const s = sibling(c)
    return s !== undefined && solvedToday.has(s.id)
  }

  // 3. 今日の復習の候補（出題日はアプリの日で比べる）
  // 4. 兄弟カード: もう片方を今日解いていれば外す。両方が候補なら英→日を残す
  const due = cards.filter(
    (c) => c.card.state !== State.New && dueDay(c.card) <= today && !newToday.has(c.id) && !siblingSolved(c),
  )
  const dueIds = new Set(due.map((c) => c.id))
  const candidates = due.filter((c) => {
    if (c.direction !== 'ja-en') return true
    const s = sibling(c)
    return s === undefined || !dueIds.has(s.id)
  })
  const candidateIds = new Set(candidates.map((c) => c.id))

  // 5. 80 枚の決まりで数える枚数 = 候補のうち今日まだ解いていないカード + 今日解いた復習。
  //    今日解いた復習は、その日に最初に解く前の出題日が今日以前のカードだけ（今日初めて解いた新しいカードと、
  //    「先取りで復習する」で解いたカードは数えない。仕様書 6-3 の 4・6-9）
  const firstToday = new Map<string, ReviewRecord>()
  for (const r of todayReviews) {
    const f = firstToday.get(r.cardId)
    if (f === undefined || r.at.getTime() < f.at.getTime()) firstToday.set(r.cardId, r)
  }
  const counted = new Set<string>()
  for (const c of candidates) if (!solvedToday.has(c.id)) counted.add(c.id)
  for (const [cardId, r] of firstToday) {
    if (r.before.state !== State.New && dueDay(r.before) <= today) counted.add(cardId)
  }
  const reviewTotal = counted.size
  const allowNew = reviewTotal < REVIEW_CAP_FOR_NEW

  // 6. 今日の復習のうち、今日まだ解いていない枚数
  const reviewRemaining = candidates.filter((c) => !solvedToday.has(c.id)).length

  // 7. 並びに入れるもの・学習ステップの予定に入れるもの
  const enJa: string[] = []
  const jaEn: string[] = []
  const stepEntries: { cardId: string; dueAt: Date }[] = []
  for (const c of candidates) {
    if (pendingCardIds.has(c.id)) continue
    const learning = c.card.state === State.Learning || c.card.state === State.Relearning
    if (learning && c.card.due.getTime() > now.getTime()) {
      stepEntries.push({ cardId: c.id, dueAt: c.card.due })
    } else if (c.direction === 'en-ja') {
      enJa.push(c.id)
    } else {
      jaEn.push(c.id)
    }
  }

  const wordById = new Map(words.map((w) => [w.id, w]))
  const createdAt = (wordId: string): number => wordById.get(wordId)?.createdAt.getTime() ?? 0
  const byWordId = (a: CardRecord, b: CardRecord): number => (a.wordId < b.wordId ? -1 : a.wordId > b.wordId ? 1 : 0)

  // 新しい問題の上限 = 1 日の新しい語の数（80 枚の決まりに当たる日は 0）+「新しい問題を足す」で増やした分
  const newLimit = (allowNew ? newPerDay : 0) + extraNew
  let newEnJa: CardRecord[] = []
  let newJaEn: CardRecord[] = []
  if (newLimit > 0) {
    // 8. 新しい英→日: 登録の古い順（同じなら語の id 順）
    const enJaLimit = Math.max(0, newLimit - newTodayCount('en-ja'))
    newEnJa = cards
      .filter((c) => c.direction === 'en-ja' && c.card.state === State.New && !siblingSolved(c))
      .sort((a, b) => createdAt(a.wordId) - createdAt(b.wordId) || byWordId(a, b))
      .slice(0, enJaLimit)

    // 9. 新しい日→英: 英→日を初めて解いた日が昨日以前の語。英→日を初めて解いた順（同じなら登録の古い順）
    const firstAt = new Map<string, Date>()
    for (const r of reviews) {
      const t = firstAt.get(r.cardId)
      if (t === undefined || r.at.getTime() < t.getTime()) firstAt.set(r.cardId, r.at)
    }
    const firstTime = (c: CardRecord): number => {
      const s = sibling(c)
      return s ? (firstAt.get(s.id)?.getTime() ?? 0) : 0
    }
    const jaEnLimit = Math.max(0, newLimit - newTodayCount('ja-en'))
    newJaEn = cards
      .filter((c) => {
        if (c.direction !== 'ja-en' || c.card.state !== State.New) return false
        const s = sibling(c)
        if (s === undefined || s.card.state === State.New) return false
        const first = firstAt.get(s.id)
        if (first !== undefined && dayOf(first) >= today) return false
        // 4 で外れたもの（英→日を今日解いた・英→日が今日の候補）を除いてから選ぶ
        return !solvedToday.has(s.id) && !candidateIds.has(s.id)
      })
      .sort(
        (a, b) =>
          firstTime(a) - firstTime(b) || createdAt(a.wordId) - createdAt(b.wordId) || byWordId(a, b),
      )
      .slice(0, jaEnLimit)
  }

  // 10. 並び: 英→日のまとまり、次に日→英。それぞれアプリの日 + カードの id のハッシュの順
  const queue = [
    ...orderByHash([...enJa, ...newEnJa.map((c) => c.id)], (id) => id, today),
    ...orderByHash([...jaEn, ...newJaEn.map((c) => c.id)], (id) => id, today),
  ]

  return {
    queue,
    stepEntries,
    reviewTotal,
    reviewRemaining,
    // 11. 並びに入れた新しいカードの枚数
    newRemaining: newEnJa.length + newJaEn.length,
    allowNew,
  }
}

// 目安の時間（分）=（復習 + 新しいカード × 2.6）× 20 秒。切り上げ（仕様書 5-1）
export function estimateMinutes(reviewRemaining: number, newRemaining: number): number {
  const seconds = (reviewRemaining + newRemaining * NEW_CARD_FACTOR) * SECONDS_PER_CARD
  // 2.6 × 枚数の小数の誤差で 1 分多くならないよう、秒に丸めてから分にする
  return Math.ceil(Math.round(seconds) / 60)
}

export interface AheadInput {
  cards: readonly CardRecord[]
  reviews: readonly ReviewRecord[]
  now: Date
  busyCardIds: ReadonlySet<string> // 今日の並びと、もう一度出す予定に入っているカード
  limit: number
}

// 「先取りで復習する」（仕様書 6-9）: New でなく、出題日のアプリの日が明日以降のカードを、出題日の近い順に limit 枚。
// 今日解いた語と、並び・予定に入っているカードの語は、どちらのカードも除く（同じ語の 2 枚は 1 日に 1 枚だけ。6-3 の 2）。
// 同じ語の 2 枚が当てはまるときは、出題日の近い方だけ
export function pickAhead(input: AheadInput): string[] {
  const { cards, reviews, now, busyCardIds, limit } = input
  const today = dayOf(now)
  const busyWords = new Set<string>()
  for (const r of reviews) if (r.day === today && !r.practice) busyWords.add(r.wordId)
  for (const c of cards) if (busyCardIds.has(c.id)) busyWords.add(c.wordId)
  const candidates = cards
    .filter((c) => c.card.state !== State.New && dueDay(c.card) > today && !busyWords.has(c.wordId))
    .sort((a, b) => a.card.due.getTime() - b.card.due.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const out: string[] = []
  const usedWords = new Set<string>()
  for (const c of candidates) {
    if (out.length >= limit) break
    if (usedWords.has(c.wordId)) continue
    usedWords.add(c.wordId)
    out.push(c.id)
  }
  return out
}
