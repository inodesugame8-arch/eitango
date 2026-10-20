import { createEmptyCard, State, type Card } from 'ts-fsrs'
import { describe, expect, it } from 'vitest'
import { dayOf } from './day.ts'
import { buildToday, estimateMinutes, pickAhead, type AheadInput, type TodayInput } from './queue.ts'
import { orderByHash } from './random.ts'
import { newCard, reviewCard } from './srs.ts'
import type { CardRecord, Direction, RatingValue, ReviewRecord, Word } from './types.ts'

const MIN = 60_000
const DAY = 86_400_000

// 端末の時計（テストでは Asia/Tokyo）での日時。月は 1 から数える
function at(y: number, mo: number, d: number, h = 0, mi = 0): Date {
  return new Date(y, mo - 1, d, h, mi)
}

interface World {
  words: Word[]
  cards: CardRecord[]
  reviews: ReviewRecord[]
}

function world(): World {
  return { words: [], cards: [], reviews: [] }
}

function cid(wordId: string, direction: Direction): string {
  return `${wordId}:${direction}`
}

// 語と、新しいカード 2 枚を足す
function addWord(w: World, id: string, createdAt: Date): Word {
  const word: Word = {
    id,
    term: id,
    kind: 'word',
    meaning: id,
    accepted: [id],
    nearMiss: [],
    acceptedEn: [id],
    needsAi: false,
    createdAt,
    updatedAt: createdAt,
  }
  w.words.push(word)
  for (const direction of ['en-ja', 'ja-en'] as const) {
    w.cards.push({ id: cid(id, direction), wordId: id, direction, card: newCard(createdAt) })
  }
  return word
}

function record(w: World, cardId: string): CardRecord {
  const rec = w.cards.find((c) => c.id === cardId)
  if (!rec) throw new Error(`カードが無い: ${cardId}`)
  return rec
}

// カードを Review の状態にする（ts-fsrs の createEmptyCard から必要な項目を書く）
function setReview(w: World, cardId: string, due: Date, lastReview: Date): void {
  const card: Card = {
    ...createEmptyCard(lastReview),
    state: State.Review,
    due,
    last_review: lastReview,
    stability: 10,
    difficulty: 5,
    scheduled_days: 10,
    reps: 3,
  }
  record(w, cardId).card = card
}

// t に評価 rating で解く（srs の reviewCard で実際に進め、解答記録を残す）
function solve(w: World, cardId: string, t: Date, rating: RatingValue, practice = false): void {
  const rec = record(w, cardId)
  const before = rec.card
  if (!practice) rec.card = reviewCard(before, t, rating).card
  w.reviews.push({
    id: `r${w.reviews.length + 1}`,
    cardId,
    wordId: rec.wordId,
    direction: rec.direction,
    at: t,
    day: dayOf(t),
    answer: '',
    verdict: rating === 1 ? 'wrong' : rating === 2 ? 'close' : 'correct',
    judgedBy: 'local',
    rating,
    thinkMs: 1000,
    totalMs: 2000,
    usedHint: false,
    appealed: false,
    practice,
    before,
  })
}

function input(w: World, now: Date, over: Partial<TodayInput> = {}): TodayInput {
  return {
    words: w.words,
    cards: w.cards,
    reviews: w.reviews,
    now,
    newPerDay: 5,
    pendingCardIds: new Set(),
    ...over,
  }
}

// 番号つきの id（w01, w02, …）
function ids(prefix: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => `${prefix}${String(i + 1).padStart(2, '0')}`)
}

// 復習の語を n 個（英→日が Review の状態で、出題日が due）。日→英は New のまま
function addReviewWords(w: World, prefix: string, n: number, due: Date): string[] {
  const list = ids(prefix, n)
  list.forEach((id, i) => {
    addWord(w, id, at(2026, 9, 1, 12, i))
    setReview(w, cid(id, 'en-ja'), due, new Date(due.getTime() - 10 * DAY))
  })
  return list
}

function addNewWords(w: World, prefix: string, n: number, from: Date): string[] {
  const list = ids(prefix, n)
  list.forEach((id, i) => addWord(w, id, new Date(from.getTime() + i * MIN)))
  return list
}

const now = at(2026, 10, 20, 12, 0)

describe('buildToday: 80 枚の決まり（仕様書 6-3 の 4）', () => {
  it('今日の復習が 80 枚ちょうどなら、新しい問題を足さない', () => {
    const w = world()
    addReviewWords(w, 'r', 80, at(2026, 10, 20, 9))
    addNewWords(w, 'n', 5, at(2026, 10, 1, 12))
    const plan = buildToday(input(w, now))
    expect(plan.reviewTotal).toBe(80)
    expect(plan.allowNew).toBe(false)
    expect(plan.newRemaining).toBe(0)
    expect(plan.queue).toHaveLength(80)
    expect(plan.queue.some((id) => id.startsWith('n'))).toBe(false)
  })

  it('79 枚なら新しい問題を足す（1 日の新しい語の数まで）', () => {
    const w = world()
    addReviewWords(w, 'r', 79, at(2026, 10, 20, 9))
    addNewWords(w, 'n', 7, at(2026, 10, 1, 12))
    const plan = buildToday(input(w, now))
    expect(plan.reviewTotal).toBe(79)
    expect(plan.allowNew).toBe(true)
    expect(plan.newRemaining).toBe(5)
    expect(plan.queue).toHaveLength(84)
    // 登録の古い順に 5 語
    const newOnes = plan.queue.filter((id) => id.startsWith('n')).sort()
    expect(newOnes).toEqual(['n01:en-ja', 'n02:en-ja', 'n03:en-ja', 'n04:en-ja', 'n05:en-ja'])
  })

  it('休み明けに、前日以前に出題日が来たカードだけで 80 枚なら新しい問題を足さない', () => {
    const w = world()
    addReviewWords(w, 'a', 30, at(2026, 10, 14, 20)) // 6 日前
    addReviewWords(w, 'b', 50, at(2026, 10, 19, 23)) // 昨日
    addReviewWords(w, 'c', 10, at(2026, 10, 21, 9)) // 明日（数えない）
    addNewWords(w, 'n', 5, at(2026, 10, 1, 12))
    const plan = buildToday(input(w, now))
    expect(plan.reviewTotal).toBe(80)
    expect(plan.reviewRemaining).toBe(80)
    expect(plan.allowNew).toBe(false)
    expect(plan.queue).toHaveLength(80)
    expect(plan.queue.some((id) => id.startsWith('c'))).toBe(false)
  })

  it('出題日を時刻で比べず、アプリの日で比べる（夜 23 時が出題日のカードも朝から出る。朝 4 時前は前の日）', () => {
    const w = world()
    addReviewWords(w, 'a', 1, at(2026, 10, 20, 23, 0))
    addReviewWords(w, 'b', 1, at(2026, 10, 21, 3, 59))
    addReviewWords(w, 'c', 1, at(2026, 10, 21, 4, 0))
    const plan = buildToday(input(w, at(2026, 10, 20, 7, 0)))
    expect(plan.queue.filter((id) => id.endsWith(':en-ja')).sort()).toEqual(['a01:en-ja', 'b01:en-ja'])
  })

  it('今日すでに解いた復習も 80 枚に数える（開き直しても数が変わらない）', () => {
    const w = world()
    const list = addReviewWords(w, 'r', 80, at(2026, 10, 20, 9))
    addNewWords(w, 'n', 5, at(2026, 10, 1, 12))
    list.slice(0, 30).forEach((id, i) => solve(w, cid(id, 'en-ja'), at(2026, 10, 20, 10, i), 3))
    const plan = buildToday(input(w, now))
    expect(plan.reviewTotal).toBe(80)
    expect(plan.reviewRemaining).toBe(50)
    expect(plan.allowNew).toBe(false)
    expect(plan.queue).toHaveLength(50)
  })

  it('今日初めて解いた新しいカードは 80 枚に数えない', () => {
    const w = world()
    addReviewWords(w, 'r', 78, at(2026, 10, 20, 9))
    const fresh = addNewWords(w, 'n', 7, at(2026, 10, 1, 12))
    // 新しいカード 3 枚を今日解いた（× で学習中・出題日は今日）
    fresh.slice(0, 3).forEach((id, i) => solve(w, cid(id, 'en-ja'), at(2026, 10, 20, 10, i), 1))
    const plan = buildToday(input(w, now))
    expect(plan.reviewTotal).toBe(78)
    expect(plan.allowNew).toBe(true)
    expect(plan.newRemaining).toBe(2)
  })

  it('先取りで解いたカード（その日に最初に解く前の出題日が明日以降）は 80 枚に数えない', () => {
    const w = world()
    addReviewWords(w, 'r', 79, at(2026, 10, 20, 9))
    const ahead = addReviewWords(w, 'a', 3, at(2026, 10, 25, 9))
    solve(w, cid(ahead[0], 'en-ja'), at(2026, 10, 20, 10, 0), 3)
    // × で再学習に入り、出題日が今日になっても数えない
    solve(w, cid(ahead[1], 'en-ja'), at(2026, 10, 20, 10, 1), 1)
    // × の後にもう一度解いても数えない（2 回目の解く前の出題日は今日だが、最初の解答で決める）
    solve(w, cid(ahead[2], 'en-ja'), at(2026, 10, 20, 10, 2), 1)
    solve(w, cid(ahead[2], 'en-ja'), at(2026, 10, 20, 10, 30), 3)
    addNewWords(w, 'n', 5, at(2026, 10, 1, 12))
    const plan = buildToday(input(w, now))
    expect(plan.reviewTotal).toBe(79)
    expect(plan.allowNew).toBe(true)
    expect(plan.newRemaining).toBe(5)
  })

  it('その日に最初に解いた記録は、解いた時刻でなく解く前の回数で決める（端末の時計を戻して解き直しても、先取りのカードを数えない）', () => {
    const w = world()
    addReviewWords(w, 'r', 79, at(2026, 10, 20, 9))
    const [a] = addReviewWords(w, 'a', 1, at(2026, 10, 25, 9))
    // 10 時に先取りで × と答え（解く前の回数は 3）、時計を 9 時 05 分に戻してもう一度解いた（解く前の回数は 4・出題日は今日）
    solve(w, cid(a, 'en-ja'), at(2026, 10, 20, 10, 0), 1)
    solve(w, cid(a, 'en-ja'), at(2026, 10, 20, 9, 5), 3)
    expect(w.reviews.map((r) => r.before.reps)).toEqual([3, 4])
    expect(dayOf(w.reviews[1].before.due)).toBe('2026-10-20')
    addNewWords(w, 'n', 5, at(2026, 10, 1, 12))
    const plan = buildToday(input(w, now))
    expect(plan.reviewTotal).toBe(79)
    expect(plan.allowNew).toBe(true)
    expect(plan.newRemaining).toBe(5)
  })
})

describe('buildToday: 兄弟カード（仕様書 6-3 の 2）', () => {
  it('英→日と日→英の両方の出題日が来ている日は、英→日だけを出す', () => {
    const w = world()
    addWord(w, 'x', at(2026, 9, 1))
    setReview(w, 'x:en-ja', at(2026, 10, 20, 8), at(2026, 10, 10))
    setReview(w, 'x:ja-en', at(2026, 10, 19, 8), at(2026, 10, 9))
    const plan = buildToday(input(w, now))
    expect(plan.queue).toEqual(['x:en-ja'])
    expect(plan.reviewTotal).toBe(1)
    expect(plan.reviewRemaining).toBe(1)
  })

  it('英→日を今日解いていたら、日→英は出さない', () => {
    const w = world()
    addWord(w, 'x', at(2026, 9, 1))
    setReview(w, 'x:en-ja', at(2026, 10, 20, 8), at(2026, 10, 10))
    setReview(w, 'x:ja-en', at(2026, 10, 20, 8), at(2026, 10, 10))
    solve(w, 'x:en-ja', at(2026, 10, 20, 9), 3)
    const plan = buildToday(input(w, now))
    expect(plan.queue).toEqual([])
    expect(plan.reviewTotal).toBe(1)
    expect(plan.reviewRemaining).toBe(0)
  })

  it('日→英を今日解いていたら、英→日は出さない', () => {
    const w = world()
    addWord(w, 'x', at(2026, 9, 1))
    setReview(w, 'x:en-ja', at(2026, 10, 20, 8), at(2026, 10, 10))
    setReview(w, 'x:ja-en', at(2026, 10, 20, 8), at(2026, 10, 10))
    solve(w, 'x:ja-en', at(2026, 10, 20, 9), 3)
    const plan = buildToday(input(w, now))
    expect(plan.queue).toEqual([])
  })

  it('英→日を今日解いていたら、その語の新しい日→英も選ばず、次に古い候補で埋める', () => {
    const w = world()
    // a・b・c は英→日を 10 月 10 日・11 日・12 日に初めて解いた語（日→英は New）
    for (const [i, id] of ['a', 'b', 'c'].entries()) {
      addWord(w, id, at(2026, 10, 1, 12, i))
      solve(w, `${id}:en-ja`, at(2026, 10, 10 + i, 20), 3)
      setReview(w, `${id}:en-ja`, at(2026, 10, 25), at(2026, 10, 10 + i, 20))
    }
    // a の英→日は今日も出題日で、朝に解いた
    setReview(w, 'a:en-ja', at(2026, 10, 20, 8), at(2026, 10, 10, 20))
    solve(w, 'a:en-ja', at(2026, 10, 20, 9), 3)
    const plan = buildToday(input(w, now, { newPerDay: 2 }))
    expect(plan.queue.sort()).toEqual(['b:ja-en', 'c:ja-en'])
    expect(plan.newRemaining).toBe(2)
  })
})

describe('buildToday: 新しい問題（仕様書 6-3 の 3）', () => {
  it('新しい英→日は登録の古い順（同じ時刻なら語の id 順）に N 枚', () => {
    const w = world()
    addWord(w, 'z', at(2026, 10, 3))
    addWord(w, 'b', at(2026, 10, 2))
    addWord(w, 'a', at(2026, 10, 2))
    addWord(w, 'y', at(2026, 10, 1))
    // N = 2 なら、10 月 2 日の同じ時刻の a と b の間で切れる
    const plan = buildToday(input(w, now, { newPerDay: 2 }))
    expect(plan.queue.sort()).toEqual(['a:en-ja', 'y:en-ja'])
    expect(plan.newRemaining).toBe(2)
  })

  it('今日すでに出した新しいカードの数を引く（英→日）', () => {
    const w = world()
    const list = addNewWords(w, 'n', 7, at(2026, 10, 1, 12))
    const first = buildToday(input(w, at(2026, 10, 20, 9)))
    expect(first.newRemaining).toBe(5)
    solve(w, cid(list[0], 'en-ja'), at(2026, 10, 20, 9, 1), 3)
    solve(w, cid(list[1], 'en-ja'), at(2026, 10, 20, 9, 2), 1)
    const plan = buildToday(
      input(w, at(2026, 10, 20, 9, 5), {
        pendingCardIds: new Set([cid(list[0], 'en-ja'), cid(list[1], 'en-ja')]),
      }),
    )
    expect(plan.newRemaining).toBe(3)
    expect(plan.queue.sort()).toEqual(['n03:en-ja', 'n04:en-ja', 'n05:en-ja'])
  })

  it('今日すでに出した新しいカードの数を引く（日→英）', () => {
    const w = world()
    const list = ids('p', 7)
    list.forEach((id, i) => {
      addWord(w, id, at(2026, 10, 1, 12, i))
      solve(w, cid(id, 'en-ja'), at(2026, 10, 15, 20, i), 3)
      setReview(w, cid(id, 'en-ja'), at(2026, 10, 30), at(2026, 10, 15, 20, i))
    })
    solve(w, cid(list[0], 'ja-en'), at(2026, 10, 20, 9, 1), 3)
    solve(w, cid(list[1], 'ja-en'), at(2026, 10, 20, 9, 2), 3)
    const plan = buildToday(input(w, at(2026, 10, 20, 9, 5)))
    expect(plan.newRemaining).toBe(3)
    expect(plan.queue.sort()).toEqual(['p03:ja-en', 'p04:ja-en', 'p05:ja-en'])
  })

  it('新しい日→英は、英→日を初めて解いた日が昨日以前の語だけ。英→日を初めて解いた順（登録の順ではない）', () => {
    const w = world()
    addWord(w, 'old', at(2026, 9, 1))
    addWord(w, 'mid', at(2026, 9, 2))
    addWord(w, 'today', at(2026, 9, 3))
    addWord(w, 'never', at(2026, 9, 4))
    solve(w, 'mid:en-ja', at(2026, 10, 18, 20), 3)
    solve(w, 'old:en-ja', at(2026, 10, 19, 21), 3)
    solve(w, 'today:en-ja', at(2026, 10, 20, 8), 3)
    for (const id of ['mid', 'old', 'today']) setReview(w, `${id}:en-ja`, at(2026, 10, 30), at(2026, 10, 18))
    const plan = buildToday(input(w, now, { newPerDay: 5 }))
    const jaEn = plan.queue.filter((id) => id.endsWith(':ja-en'))
    expect(jaEn.sort()).toEqual(['mid:ja-en', 'old:ja-en'])
    // 選ぶ順は英→日を初めて解いた順: N = 1 なら mid
    const one = buildToday(input(w, now, { newPerDay: 1 }))
    expect(one.queue.filter((id) => id.endsWith(':ja-en'))).toEqual(['mid:ja-en'])
  })

  it('新しい日→英は、英→日を初めて解いた日が今日より後の語（端末の時計を戻したとき）も出さない', () => {
    const w = world()
    addWord(w, 'p', at(2026, 9, 1))
    // 英→日を 10 月 21 日 10 時に解いた記録がある（解答記録の日は 10 月 21 日。今日の解答記録には入らない）
    solve(w, 'p:en-ja', at(2026, 10, 21, 10), 3)
    setReview(w, 'p:en-ja', at(2026, 10, 30), at(2026, 10, 21, 10))
    expect(w.reviews[0].day).toBe('2026-10-21')
    const plan = buildToday(input(w, now))
    expect(plan.queue).not.toContain('p:ja-en')
  })

  it('英→日が New のままの語の日→英は出さない', () => {
    const w = world()
    addNewWords(w, 'n', 2, at(2026, 10, 1))
    const plan = buildToday(input(w, now))
    expect(plan.queue.every((id) => id.endsWith(':en-ja'))).toBe(true)
  })

  it('1 日目に新しい英→日で ×→○→○ と答えた語の 2 日目: 英→日が復習で来て、日→英の新しい候補は外れ、空いた枠は次に古い候補で埋まる', () => {
    const w = world()
    addWord(w, 'x', at(2026, 10, 19, 12, 0))
    addWord(w, 'y', at(2026, 10, 19, 12, 1))
    addWord(w, 'z', at(2026, 10, 19, 12, 2))
    // 1 日目（10 月 20 日）
    solve(w, 'x:en-ja', at(2026, 10, 20, 21, 0), 1)
    solve(w, 'x:en-ja', at(2026, 10, 20, 21, 3), 3)
    solve(w, 'x:en-ja', at(2026, 10, 20, 21, 14), 3)
    solve(w, 'y:en-ja', at(2026, 10, 20, 21, 20), 3)
    solve(w, 'y:en-ja', at(2026, 10, 20, 21, 31), 3)
    solve(w, 'z:en-ja', at(2026, 10, 20, 21, 40), 3)
    solve(w, 'z:en-ja', at(2026, 10, 20, 21, 51), 3)
    expect(record(w, 'x:en-ja').card.state).toBe(State.Review)
    expect(dayOf(record(w, 'x:en-ja').card.due)).toBe('2026-10-21')
    expect(dayOf(record(w, 'y:en-ja').card.due)).toBe('2026-10-22')
    // 1 日目のうちは日→英を出さない
    const day1 = buildToday(input(w, at(2026, 10, 20, 22, 0), { newPerDay: 2 }))
    expect(day1.queue.filter((id) => id.endsWith(':ja-en'))).toEqual([])
    // 2 日目（10 月 21 日）
    const day2 = buildToday(input(w, at(2026, 10, 21, 12, 0), { newPerDay: 2 }))
    expect(day2.queue.slice(0, 1)).toEqual(['x:en-ja'])
    expect(day2.queue.slice(1).sort()).toEqual(['y:ja-en', 'z:ja-en'])
    expect(day2.reviewRemaining).toBe(1)
    expect(day2.newRemaining).toBe(2)
  })

  it('80 枚の決まりに当たる日は、新しい日→英も足さない', () => {
    const w = world()
    addReviewWords(w, 'r', 80, at(2026, 10, 20, 9))
    addWord(w, 'p', at(2026, 9, 1))
    solve(w, 'p:en-ja', at(2026, 10, 15, 20), 3)
    setReview(w, 'p:en-ja', at(2026, 10, 30), at(2026, 10, 15, 20))
    const plan = buildToday(input(w, now))
    expect(plan.queue).not.toContain('p:ja-en')
  })
})

describe('buildToday: 並び（仕様書 6-3 の 5）', () => {
  function mixedWorld(): World {
    const w = world()
    addReviewWords(w, 'r', 6, at(2026, 10, 20, 8))
    // 日→英の復習（英→日は先の日）
    ids('s', 4).forEach((id, i) => {
      addWord(w, id, at(2026, 9, 2, 12, i))
      solve(w, cid(id, 'en-ja'), at(2026, 10, 5, 20, i), 3)
      setReview(w, cid(id, 'en-ja'), at(2026, 11, 1), at(2026, 10, 10))
      setReview(w, cid(id, 'ja-en'), at(2026, 10, 19, 20), at(2026, 10, 9))
    })
    addNewWords(w, 'n', 5, at(2026, 10, 1, 12))
    return w
  }

  it('英→日のまとまりが先、日→英が後。まとまりの中は orderByHash（アプリの日 + カードの id）の順', () => {
    const plan = buildToday(input(mixedWorld(), now))
    const enJa = plan.queue.filter((id) => id.endsWith(':en-ja'))
    const jaEn = plan.queue.filter((id) => id.endsWith(':ja-en'))
    expect(enJa).toHaveLength(11)
    expect(jaEn).toHaveLength(4)
    expect(plan.queue).toEqual([...enJa, ...jaEn])
    expect(enJa).toEqual(orderByHash(enJa, (id) => id, '2026-10-20'))
    expect(jaEn).toEqual(orderByHash(jaEn, (id) => id, '2026-10-20'))
    // 新しいカードも復習と混ぜる（新しいカードだけが先頭や末尾に固まらない）
    const newPositions = enJa.map((id, i) => (id.startsWith('n') ? i : -1)).filter((i) => i >= 0)
    expect(newPositions).not.toEqual([0, 1, 2, 3, 4])
    expect(newPositions).not.toEqual([6, 7, 8, 9, 10])
  })

  it('開き直した後: 解いたカードを抜いた残りの順は最初の順と同じ', () => {
    const w = mixedWorld()
    const first = buildToday(input(w, at(2026, 10, 20, 9, 0)))
    const solved = first.queue.slice(0, 5)
    const pending = new Set<string>()
    solved.forEach((id, i) => {
      solve(w, id, at(2026, 10, 20, 9, 1 + i), 3)
      // 新しいカードは学習ステップ（もう一度出す予定）に入る
      if (record(w, id).card.state === State.Learning) pending.add(id)
    })
    const again = buildToday(input(w, at(2026, 10, 20, 9, 8), { pendingCardIds: pending }))
    expect(again.queue).toEqual(first.queue.filter((id) => !solved.includes(id)))
    expect(again.reviewRemaining + again.newRemaining).toBe(first.queue.length - 5)
  })

  it('同じ日なら何度作っても同じ並び', () => {
    const w = mixedWorld()
    const a = buildToday(input(w, at(2026, 10, 20, 9)))
    const b = buildToday(input(w, at(2026, 10, 20, 23)))
    expect(b.queue).toEqual(a.queue)
  })
})

describe('buildToday: 学習中のカードと、もう一度出す予定', () => {
  it('学習中で出題日が今より後のカードは並びに入れず stepEntries に入る', () => {
    const w = world()
    addWord(w, 'l', at(2026, 9, 1))
    const card: Card = { ...createEmptyCard(at(2026, 10, 19)), state: State.Learning, due: at(2026, 10, 20, 12, 5), learning_steps: 1, reps: 1 }
    record(w, 'l:en-ja').card = card
    const plan = buildToday(input(w, now))
    expect(plan.queue).toEqual([])
    expect(plan.stepEntries).toEqual([{ cardId: 'l:en-ja', dueAt: at(2026, 10, 20, 12, 5) }])
    expect(plan.reviewRemaining).toBe(1)
  })

  it('再学習中（今日 × にした復習）で出題日が今より後も stepEntries。出題日が過ぎていれば並び', () => {
    const w = world()
    addReviewWords(w, 'r', 1, at(2026, 10, 20, 8))
    solve(w, 'r01:en-ja', at(2026, 10, 20, 11, 55), 1)
    expect(record(w, 'r01:en-ja').card.state).toBe(State.Relearning)
    const due = record(w, 'r01:en-ja').card.due
    const before = buildToday(input(w, now))
    expect(before.stepEntries).toEqual([{ cardId: 'r01:en-ja', dueAt: due }])
    expect(before.queue).toEqual([])
    const after = buildToday(input(w, new Date(due.getTime() + MIN)))
    expect(after.stepEntries).toEqual([])
    expect(after.queue).toEqual(['r01:en-ja'])
    expect(after.reviewTotal).toBe(1)
    expect(after.reviewRemaining).toBe(0)
  })

  it('pendingCardIds のカードは並びにも stepEntries にも入らない', () => {
    const w = world()
    addReviewWords(w, 'r', 2, at(2026, 10, 20, 8))
    solve(w, 'r01:en-ja', at(2026, 10, 20, 11, 55), 1)
    const plan = buildToday(input(w, now, { pendingCardIds: new Set(['r01:en-ja', 'r02:en-ja']) }))
    expect(plan.queue).toEqual([])
    expect(plan.stepEntries).toEqual([])
    expect(plan.reviewTotal).toBe(2)
    expect(plan.reviewRemaining).toBe(1)
  })

  // 新しいカードの問題を 10 月 21 日 3 時 58 分（アプリの日は 10 月 20 日）に出し、朝 4 時をまたいだ 4 時 01 分に答えた
  // （解答記録の日は 10 月 21 日・解く前は New）。前の日の予定は捨てられ、pendingCardIds には無い。今日の復習は 2 枚
  function crossedWorld(rating: RatingValue): World {
    const w = world()
    addReviewWords(w, 'r', 2, at(2026, 10, 21, 9))
    addWord(w, 'n', at(2026, 10, 1, 12))
    solve(w, 'n:en-ja', at(2026, 10, 21, 4, 1), rating)
    return w
  }

  it('今日初めて解いた新しいカードで、学習中・出題日が今より後なら stepEntries に入る（80 枚と、今日まだ解いていない復習には数えない）', () => {
    const w = crossedWorld(3)
    const due = record(w, 'n:en-ja').card.due
    expect(record(w, 'n:en-ja').card.state).toBe(State.Learning)
    expect(dayOf(due)).toBe('2026-10-21')
    const plan = buildToday(input(w, at(2026, 10, 21, 4, 2)))
    expect(plan.reviewTotal).toBe(2)
    expect(plan.reviewRemaining).toBe(2)
    expect(plan.queue).not.toContain('n:en-ja')
    expect(plan.stepEntries).toEqual([{ cardId: 'n:en-ja', dueAt: due }])
  })

  it('今日初めて解いた新しいカードで、出題日が今以前なら並びに入る（80 枚と、今日まだ解いていない復習には数えない）', () => {
    const w = crossedWorld(1)
    const due = record(w, 'n:en-ja').card.due
    expect(record(w, 'n:en-ja').card.state).toBe(State.Learning)
    const plan = buildToday(input(w, new Date(due.getTime() + MIN)))
    expect(plan.reviewTotal).toBe(2)
    expect(plan.reviewRemaining).toBe(2)
    expect(plan.stepEntries).toEqual([])
    expect(plan.queue).toContain('n:en-ja')
  })

  it('今日初めて解いた新しいカードも、もう一度出す予定に入っていれば並びにも stepEntries にも入らない', () => {
    const w = crossedWorld(3)
    const due = record(w, 'n:en-ja').card.due
    for (const t of [at(2026, 10, 21, 4, 2), new Date(due.getTime() + MIN)]) {
      const plan = buildToday(input(w, t, { pendingCardIds: new Set(['n:en-ja']) }))
      expect(plan.queue).not.toContain('n:en-ja')
      expect(plan.stepEntries).toEqual([])
      expect(plan.reviewTotal).toBe(2)
      expect(plan.reviewRemaining).toBe(2)
    }
  })

  it('練習の解答記録は今日解いた数に入れない', () => {
    const w = world()
    addReviewWords(w, 'r', 1, at(2026, 10, 20, 8))
    solve(w, 'r01:en-ja', at(2026, 10, 20, 9), 2, true)
    const plan = buildToday(input(w, now))
    expect(plan.reviewRemaining).toBe(1)
    expect(plan.queue).toEqual(['r01:en-ja'])
  })

  it('語が 1 つも無ければ空', () => {
    const plan = buildToday(input(world(), now))
    expect(plan).toEqual({
      queue: [],
      stepEntries: [],
      reviewTotal: 0,
      reviewRemaining: 0,
      newRemaining: 0,
      allowNew: true,
    })
  })
})

describe('estimateMinutes（仕様書 5-1: （復習 + 新しいカード × 2.6）× 20 秒、切り上げ）', () => {
  it('復習 42 枚・新しい問題 10 枚は 23 分（68 × 20 秒 = 1360 秒）', () => {
    expect(estimateMinutes(42, 10)).toBe(23)
  })

  it('0 枚は 0 分、端数は切り上げ、ちょうどなら切り上げない', () => {
    expect(estimateMinutes(0, 0)).toBe(0)
    expect(estimateMinutes(1, 0)).toBe(1)
    expect(estimateMinutes(3, 0)).toBe(1)
    expect(estimateMinutes(4, 0)).toBe(2)
    expect(estimateMinutes(0, 15)).toBe(13) // 39 × 20 = 780 秒 = 13 分
    expect(estimateMinutes(0, 3)).toBe(3) // 7.8 × 20 = 156 秒
  })
})

describe('buildToday: もっとやる の「新しい問題を足す」（仕様書 6-9）', () => {
  it('extraNew の分だけ、新しい英→日の上限が増える', () => {
    const w = world()
    const list = addNewWords(w, 'n', 12, at(2026, 10, 1, 12))
    const plan = buildToday(input(w, now, { extraNew: 5 }))
    expect(plan.newRemaining).toBe(10)
    expect([...plan.queue].sort()).toEqual(list.slice(0, 10).map((id) => cid(id, 'en-ja')).sort())
  })

  it('extraNew の分だけ、新しい日→英の上限も増える（英→日を初めて解いた日の翌日以降の決まりはそのまま）', () => {
    const w = world()
    const list = addNewWords(w, 'n', 12, at(2026, 10, 1, 12))
    for (const id of list) {
      solve(w, cid(id, 'en-ja'), at(2026, 10, 19, 12), 3)
      setReview(w, cid(id, 'en-ja'), at(2026, 10, 25, 12), at(2026, 10, 19, 12))
    }
    expect(buildToday(input(w, now)).newRemaining).toBe(5)
    const plan = buildToday(input(w, now, { extraNew: 5 }))
    expect(plan.newRemaining).toBe(10)
    expect(plan.queue.every((id) => id.endsWith(':ja-en'))).toBe(true)
  })

  it('80 枚の決まりに当たる日でも、足した分は出す（allowNew は false のまま）', () => {
    const w = world()
    addReviewWords(w, 'r', 80, at(2026, 10, 20, 9))
    const fresh = addNewWords(w, 'n', 7, at(2026, 10, 1, 12))
    expect(buildToday(input(w, now)).newRemaining).toBe(0)
    const plan = buildToday(input(w, now, { extraNew: 5 }))
    expect(plan.allowNew).toBe(false)
    expect(plan.newRemaining).toBe(5)
    expect(plan.queue).toEqual(expect.arrayContaining(fresh.slice(0, 5).map((id) => cid(id, 'en-ja'))))
  })

  it('足した分からも、今日すでに出した新しいカードの数を引く', () => {
    const w = world()
    const list = addNewWords(w, 'n', 12, at(2026, 10, 1, 12))
    for (const id of list.slice(0, 5)) solve(w, cid(id, 'en-ja'), at(2026, 10, 20, 9), 3)
    expect(buildToday(input(w, now)).newRemaining).toBe(0)
    const plan = buildToday(input(w, now, { extraNew: 5 }))
    expect(plan.newRemaining).toBe(5)
    expect(plan.queue.filter((id) => list.slice(5, 10).map((x) => cid(x, 'en-ja')).includes(id))).toHaveLength(5)
  })

  it('「先取りで復習する」で並びに足した英→日の語は、新しい日→英に選ばず、次に古い候補で埋める（同じ語の 2 枚は 1 日に 1 枚。仕様書 6-3 の 2）', () => {
    const w = world()
    // x・a・b・c は英→日を 10 月 9 日・10 日・11 日・12 日に初めて解いた語（英→日の出題日は 10 月 25 日、日→英は New）
    for (const [i, id] of ['x', 'a', 'b', 'c'].entries()) {
      addWord(w, id, at(2026, 10, 1, 12, i))
      solve(w, `${id}:en-ja`, at(2026, 10, 9 + i, 20), 3)
      setReview(w, `${id}:en-ja`, at(2026, 10, 25), at(2026, 10, 9 + i, 20))
    }
    // 今日の新しい日→英（1 日の新しい語の数は 1）は x で出し終えた
    solve(w, 'x:ja-en', at(2026, 10, 20, 9), 4)
    expect(buildToday(input(w, now, { newPerDay: 1 })).queue).toEqual([])
    // 先取りが無ければ、足した 2 枚は a・b
    expect(buildToday(input(w, now, { newPerDay: 1, extraNew: 2 })).queue.sort()).toEqual(['a:ja-en', 'b:ja-en'])
    // 先取りで a の英→日を並びに足してから「新しい問題を足す」と、a の日→英は選ばず c で埋める
    const plan = buildToday(
      input(w, now, { newPerDay: 1, extraNew: 2, queuedCardIds: new Set(['a:en-ja']) }),
    )
    expect(plan.queue.sort()).toEqual(['b:ja-en', 'c:ja-en'])
    expect(plan.newRemaining).toBe(2)
  })
})

describe('pickAhead: もっとやる の「先取りで復習する」（仕様書 6-9）', () => {
  function ahead(w: World, over: Partial<AheadInput> = {}): string[] {
    return pickAhead({ cards: w.cards, reviews: w.reviews, now, busyCardIds: new Set(), limit: 10, ...over })
  }

  // 英→日を Review の状態で、出題日を due にした語を足す（日→英は New のまま）
  function reviewWord(w: World, id: string, due: Date): string {
    addWord(w, id, at(2026, 9, 1, 12))
    setReview(w, cid(id, 'en-ja'), due, new Date(due.getTime() - 10 * DAY))
    return cid(id, 'en-ja')
  }

  it('出題日のアプリの日が明日以降のカードを、出題日の近い順に limit 枚まで', () => {
    const w = world()
    const d30 = reviewWord(w, 'd30', at(2026, 10, 30, 9))
    const d22 = reviewWord(w, 'd22', at(2026, 10, 22, 9))
    const d21 = reviewWord(w, 'd21', at(2026, 10, 21, 4, 0))
    const d25 = reviewWord(w, 'd25', at(2026, 10, 25, 9))
    reviewWord(w, 'today', at(2026, 10, 20, 23, 0))
    // 10 月 21 日の 3 時 59 分は、アプリの日では 10 月 20 日（今日）
    reviewWord(w, 'early', at(2026, 10, 21, 3, 59))
    addNewWords(w, 'n', 2, at(2026, 10, 1, 12))
    expect(ahead(w)).toEqual([d21, d22, d25, d30])
    expect(ahead(w, { limit: 2 })).toEqual([d21, d22])
  })

  it('今日解いた語は、どちらのカードも除く（練習の記録は数えない）', () => {
    const w = world()
    const x = reviewWord(w, 'x', at(2026, 10, 20, 9))
    setReview(w, cid('x', 'ja-en'), at(2026, 10, 23, 9), at(2026, 10, 13, 9))
    solve(w, x, at(2026, 10, 20, 10), 3)
    expect(record(w, x).card.due.getTime()).toBeGreaterThan(now.getTime())
    const y = reviewWord(w, 'y', at(2026, 10, 24, 9))
    solve(w, y, at(2026, 10, 20, 10), 2, true)
    expect(ahead(w)).toEqual([y])
  })

  it('今日の並びと、もう一度出す予定に入っているカードの語は除く', () => {
    const w = world()
    reviewWord(w, 'q', at(2026, 10, 22, 9))
    setReview(w, cid('q', 'ja-en'), at(2026, 10, 23, 9), at(2026, 10, 13, 9))
    const z = reviewWord(w, 'z', at(2026, 10, 24, 9))
    expect(ahead(w, { busyCardIds: new Set([cid('q', 'en-ja')]) })).toEqual([z])
  })

  it('同じ語の 2 枚が当てはまるときは、出題日の近い方の 1 枚だけ', () => {
    const w = world()
    reviewWord(w, 'b', at(2026, 10, 26, 9))
    setReview(w, cid('b', 'ja-en'), at(2026, 10, 23, 9), at(2026, 10, 13, 9))
    expect(ahead(w)).toEqual([cid('b', 'ja-en')])
  })

  it('足せるカードが無ければ空', () => {
    const w = world()
    addNewWords(w, 'n', 3, at(2026, 10, 1, 12))
    reviewWord(w, 'today', at(2026, 10, 20, 9))
    expect(ahead(w)).toEqual([])
  })
})
