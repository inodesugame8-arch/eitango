// 単語の画面の計算: 手で保存する語（仕様書 8-2）・編集の保存（9-4）・一覧の並び（5-2）
import { guessKind } from './bulk.ts'
import { makeCloze } from './cloze.ts'
import { newId } from './id.ts'
import { sameEn, sameJa } from './match.ts'
import type { ReviewRecord, Word } from './types.ts'

type OptionalKey = 'context' | 'source' | 'tone' | 'exampleEn' | 'exampleJa' | 'note' | 'cloze' | 'clozeAnswer'

const OPTIONAL_KEYS: readonly OptionalKey[] = [
  'context',
  'source',
  'tone',
  'exampleEn',
  'exampleJa',
  'note',
  'cloze',
  'clozeAnswer',
]

function trimmed(text: string | undefined): string {
  return (text ?? '').trim()
}

// 空なら項目ごと消し、あれば前後の空白を除いて入れる
function setOpt(word: Word, key: OptionalKey, value: string | undefined): void {
  const t = trimmed(value)
  if (t === '') delete word[key]
  else word[key] = t
}

function cleanList(list: readonly string[]): string[] {
  return list.map((t) => t.trim()).filter((t) => t !== '')
}

// AI が使えないときに、意味を自分で入れて保存する語（仕様書 8-2）。種類は guessKind、許容訳は意味だけ、
// 許容する英語は英語だけ、穴埋めは 7-5 の決まりで作り（単語・熟語だけ）、AI で補う前の印を付ける
export function manualWord(
  input: { term: string; context?: string; meaning: string; source?: string },
  now: Date,
): Word {
  const term = input.term.trim()
  const meaning = input.meaning.trim()
  const kind = guessKind(term)
  const word: Word = {
    id: newId(),
    term,
    kind,
    meaning,
    accepted: meaning === '' ? [] : [meaning],
    nearMiss: [],
    acceptedEn: [term],
    needsAi: true,
    createdAt: now,
    updatedAt: now,
  }
  setOpt(word, 'context', input.context)
  setOpt(word, 'source', input.source)
  if (kind === 'word' && word.context !== undefined) {
    const made = makeCloze(term, word.context)
    if (made) {
      word.cloze = made.cloze
      word.clozeAnswer = made.answer
    }
  }
  return word
}

// 編集の保存（仕様書 9-4）。id・作った日時・AI で補う前の印は元の語のまま。
// 英語か出会った英文を変えたら穴埋めを空にし、AI で補う前の印を付ける。種類をフレーズに変えたら穴埋めを空にする。
// 英語を変えたら、許容する英語の元の英語も新しい英語に替える。種類を単語・熟語に変えて穴埋めが空なら 7-5 で作る。
// 許容訳には意味を必ず入れておく（7-2）。カードの FSRS の状態はここでは触らない
export function applyEdit(original: Word, draft: Word, now: Date): Word {
  const out: Word = {
    id: original.id,
    term: draft.term.trim(),
    kind: draft.kind,
    meaning: draft.meaning.trim(),
    accepted: cleanList(draft.accepted),
    nearMiss: cleanList(draft.nearMiss),
    acceptedEn: cleanList(draft.acceptedEn),
    needsAi: original.needsAi,
    createdAt: original.createdAt,
    updatedAt: now,
  }
  for (const key of OPTIONAL_KEYS) setOpt(out, key, draft[key])
  if (out.meaning !== '' && !out.accepted.some((t) => sameJa(t, out.meaning))) out.accepted.push(out.meaning)

  const termChanged = out.term !== original.term.trim()
  const contextChanged = trimmed(out.context) !== trimmed(original.context)
  // 英語を変えたら、許容する英語に入っている元の英語を新しい英語に替える（重なれば 1 つに）。
  // 8-2 でアプリが英語そのものを入れているので、残すと直す前の英語で ○ になるため
  if (termChanged) {
    const en: string[] = []
    for (const t of out.acceptedEn) {
      const v = sameEn(t, original.term) ? out.term : t
      if (sameEn(v, out.term) && en.some((x) => sameEn(x, out.term))) continue
      en.push(v)
    }
    out.acceptedEn = en
  }
  // 穴埋めは単語・熟語だけで、文と答えの組（片方だけなら両方を空に）
  if (out.kind === 'phrase' || out.cloze === undefined || out.clozeAnswer === undefined) {
    delete out.cloze
    delete out.clozeAnswer
  }
  // 種類を単語・熟語に変えて穴埋めが空で、出会った英文があれば、7-5 の決まりで作る（作れなければ空のまま）
  if (original.kind === 'phrase' && out.kind === 'word' && out.cloze === undefined && out.context !== undefined) {
    const made = makeCloze(out.term, out.context)
    if (made) {
      out.cloze = made.cloze
      out.clozeAnswer = made.answer
    }
  }
  // 英語か出会った英文を変えたら、穴埋めを空にし（作らずに AI に回す）、AI で補う前の印を付ける
  if (termChanged || contextChanged) {
    delete out.cloze
    delete out.clozeAnswer
    out.needsAi = true
  }
  return out
}

export type WordOrder = 'wrong' | 'new'

// 一覧の並び（仕様書 5-2）。new: 登録の新しい順。wrong: 最後に × になった時刻の新しい順で、
// × になったことの無い語は後ろに登録の新しい順。元の配列は変えない
export function sortWords(words: readonly Word[], reviews: readonly ReviewRecord[], order: WordOrder): Word[] {
  const byNew = (a: Word, b: Word): number =>
    b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  if (order === 'new') return [...words].sort(byNew)
  const lastWrong = new Map<string, number>()
  for (const r of reviews) {
    if (r.verdict !== 'wrong') continue
    const t = r.at.getTime()
    if ((lastWrong.get(r.wordId) ?? -Infinity) < t) lastWrong.set(r.wordId, t)
  }
  return [...words].sort((a, b) => {
    const x = lastWrong.get(a.id)
    const y = lastWrong.get(b.id)
    if (x !== undefined && y !== undefined) return y - x || byNew(a, b)
    if (x !== undefined) return -1
    if (y !== undefined) return 1
    return byNew(a, b)
  })
}
