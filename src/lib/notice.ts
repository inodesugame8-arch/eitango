// 確認の画面・編集の画面に出す AI の知らせ（設計書 2026-11-10 の 4-2 の 3・5-1）。
// 材料は最後に AI を呼んだときの返事から作り、語のデータには入れない
import type { FillResult, TermCheck } from './gemini/prompts.ts'
import { sameEn } from './match.ts'
import { normalizeJa } from './normalize.ts'

export interface AiNotes {
  term: string // 点検した英語（送った英語。前後の空白を除く）
  meaning: string // 送った意味（入れていなければ空文字）
  aiMeaning: string // AI の返した meaning
  check: TermCheck
}

export function notesFrom(sent: { term: string; meaning?: string }, fill: FillResult): AiNotes {
  return { term: sent.term.trim(), meaning: (sent.meaning ?? '').trim(), aiMeaning: fill.meaning, check: fill.check }
}

// 打ち間違いの知らせ（5-1）。suspect で候補があり、候補が点検した英語と同じでなく（英語の正規化で比べるので、
// 崩した形と元の形は同じとみなす）、英語の欄が点検した英語のままのときだけ出す。出さないときは null
export function typoNotice(
  notes: AiNotes | undefined,
  currentTerm: string,
): { suggestion: string; reason: string } | null {
  if (notes === undefined || !notes.check.suspect) return null
  const suggestion = notes.check.suggestion.trim()
  if (suggestion === '' || sameEn(suggestion, notes.term)) return null
  if (currentTerm.trim() !== notes.term) return null
  return { suggestion, reason: notes.check.reason.trim() }
}

// AI が別の意味で作ったかもしれないとき（4-2 の 3）は、AI の meaning を返す。入れた意味と AI の meaning に日本語の
// 正規化をかけ、どちらかがもう片方を含めば重なるとみなして出さない（空文字）
export function meaningNotice(notes: AiNotes | undefined): string {
  if (notes === undefined) return ''
  const mine = normalizeJa(notes.meaning)
  const ai = normalizeJa(notes.aiMeaning)
  if (mine === '' || ai === '' || mine.includes(ai) || ai.includes(mine)) return ''
  return notes.aiMeaning.trim()
}
