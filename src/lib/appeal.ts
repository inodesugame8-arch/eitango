// 判定を直したときの一覧の出し入れ（仕様書 6-6）。FSRS の付け直しは srs.ts の reviewCard で行う
import { sameEn, sameJa } from './match.ts'
import { normalizeEn, normalizeJa } from './normalize.ts'
import type { Direction, JudgedBy, Verdict, Word } from './types.ts'

type Same = (a: string, b: string) => boolean

// 正規化して answer と同じものを除いた新しい配列
function without(list: readonly string[], answer: string, same: Same): string[] {
  return list.filter((t) => !same(answer, t))
}

// answer（前後の空白を除く）を加えた新しい配列。正規化して同じものがあれば加えない
function withAdded(list: readonly string[], answer: string, same: Same): string[] {
  const text = answer.trim()
  return list.some((t) => same(text, t)) ? [...list] : [...list, text]
}

// 「正解にする」: 英→日は紛らわしい誤訳から外してから許容訳に加え、日→英は許容する英語に加える（紛らわしい誤訳は日本語の一覧なので触らない）。
// 「不正解にする」: 許容訳（日→英は許容する英語）から外してから、英→日は紛らわしい誤訳に加える。
// 「おしいにする」: 英→日は許容訳と紛らわしい誤訳から外し、日→英は許容する英語から外す。紛らわしい誤訳には加えない
// （次は AI が判定する）。
// どれも updatedAt を now にした新しい Word を返す
export function applyAppeal(
  word: Word,
  direction: Direction,
  answer: string,
  to: Verdict,
  now: Date,
): Word {
  let accepted = [...word.accepted]
  let nearMiss = [...word.nearMiss]
  let acceptedEn = [...word.acceptedEn]
  const empty = (direction === 'en-ja' ? normalizeJa(answer) : normalizeEn(answer)) === ''
  if (!empty && direction === 'en-ja') {
    if (to === 'correct') {
      nearMiss = without(nearMiss, answer, sameJa)
      accepted = withAdded(accepted, answer, sameJa)
    } else if (to === 'wrong') {
      accepted = without(accepted, answer, sameJa)
      nearMiss = withAdded(nearMiss, answer, sameJa)
    } else {
      accepted = without(accepted, answer, sameJa)
      nearMiss = without(nearMiss, answer, sameJa)
    }
  } else if (!empty) {
    // 日→英。紛らわしい誤訳は日本語の一覧なので、英語の答えとは比べない
    if (to === 'correct') acceptedEn = withAdded(acceptedEn, answer, sameEn)
    else acceptedEn = without(acceptedEn, answer, sameEn)
  }
  return { ...word, accepted, nearMiss, acceptedEn, updatedAt: now }
}

// △ と × に直す選択肢を出すか。英→日で答えが意味（meaning）そのもの、日→英で答えが英語（term）か
// 穴の答えそのものなら出さない（外すと、許容訳に意味を必ず入れておくという 7-2 の前提が崩れるため）。
// 空の答えにも出さない（外す答えが無いため）
export function canAppealDown(word: Word, direction: Direction, answer: string): boolean {
  if (direction === 'en-ja') return normalizeJa(answer) !== '' && !sameJa(answer, word.meaning)
  if (normalizeEn(answer) === '') return false
  if (sameEn(answer, word.term)) return false
  if (word.clozeAnswer && sameEn(answer, word.clozeAnswer)) return false
  return true
}

const VERDICT_ORDER: readonly Verdict[] = ['correct', 'close', 'wrong']

// 「判定を直す」で出す選択肢（○ △ × の順）。元の判定以外の 2 つ。canAppealDown が false なら ○ への直しだけ残す。
// 「わからない」で × になった答えには出さない。空の配列なら「判定を直す」自体を出さない
export function appealChoices(
  word: Word,
  direction: Direction,
  answer: string,
  current: Verdict,
  judgedBy: JudgedBy,
): Verdict[] {
  if (judgedBy === 'giveup') return []
  const down = canAppealDown(word, direction, answer)
  return VERDICT_ORDER.filter((v) => v !== current && (down || v === 'correct'))
}
