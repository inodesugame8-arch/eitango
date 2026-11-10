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

// 候補が英語の形か（ラテン文字・数字・空白と ' ’ - . , ! ? だけ）。日本語や説明つきの候補を英語の欄に入れないため
const ENGLISH = /^[\p{Script=Latin}0-9\s'’\-.,!?]+$/u

// ハイフンを空白にしてから比べる（normalizeEn はハイフンを消すので、pay-to-win と pay to win が別になるため）
const sameIgnoringHyphen = (a: string, b: string): boolean => sameEn(a.replace(/-/g, ' '), b.replace(/-/g, ' '))

// 打ち間違いの知らせ（5-1）。suspect で英語の形の候補があり、候補が点検した英語と同じでなく（英語の正規化で比べるので、
// 崩した形と元の形、ハイフンと空白の違いは同じとみなす）、英語の欄が点検した英語のままのときだけ出す。出さないときは null
export function typoNotice(
  notes: AiNotes | undefined,
  currentTerm: string,
): { suggestion: string; reason: string } | null {
  if (notes === undefined || !notes.check.suspect) return null
  const suggestion = notes.check.suggestion.trim()
  if (!ENGLISH.test(suggestion) || sameIgnoringHyphen(suggestion, notes.term)) return null
  if (currentTerm.trim() !== notes.term) return null
  return { suggestion, reason: notes.check.reason.trim() }
}

// 「候補で作り直す」で送る意味（5-1）。意味の欄が、学習者が入れていない AI の意味のまま（材料の意味が空で、欄が AI の
// meaning と同じ）なら空文字を送り、候補の英語の意味を AI に作り直させる（打ち間違えた語について作った意味を、
// 候補の英語で覚えたい意味として送らないため）。本人が入れた・直した意味は欄のまま
export function candidateMeaning(notes: AiNotes | undefined, currentMeaning: string): string {
  if (notes !== undefined && notes.meaning === '' && currentMeaning.trim() === notes.aiMeaning.trim()) return ''
  return currentMeaning
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
