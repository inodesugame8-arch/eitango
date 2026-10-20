// AI（登録の補助）の返事を語に当てはめる（仕様書 8-1・8-4）。
// gemini/prompts.ts は動作確認の段で使うので照合（match）を import できず、ここに分けた
import type { FillResult } from './gemini/prompts.ts'
import { sameEn, sameJa } from './match.ts'
import { normalizeEn, normalizeJa } from './normalize.ts'
import type { Word } from './types.ts'

type Same = (a: string, b: string) => boolean

// list に more を足した新しい配列（前後の空白を除き、正規化して同じもの・空になるものは足さない）
function addAll(list: readonly string[], more: readonly string[], same: Same, normalize: (t: string) => string): string[] {
  const out = [...list]
  for (const raw of more) {
    const t = raw.trim()
    if (normalize(t) === '' || out.some((x) => same(x, t))) continue
    out.push(t)
  }
  return out
}

const addJa = (list: readonly string[], more: readonly string[]): string[] => addAll(list, more, sameJa, normalizeJa)
const addEn = (list: readonly string[], more: readonly string[]): string[] => addAll(list, more, sameEn, normalizeEn)

function empty(text: string | undefined): boolean {
  return text === undefined || text.trim() === ''
}

// 空なら項目ごと消し、あれば入れる
function setOpt(word: Word, key: 'tone' | 'exampleEn' | 'exampleJa' | 'note' | 'cloze' | 'clozeAnswer', value: string): void {
  if (empty(value)) delete word[key]
  else word[key] = value.trim()
}

// new: 登録の確認の画面に出す値（本人が入れた意味があればそれを使い、accepted に meaning を必ず含める）
// supplement: AI で補う（意味と種類は変えない。一覧は足すだけ。空の項目だけ埋める。needsAi を false に）。
// 許容訳と紛らわしい誤訳の、もう片方にある訳は足さない（× に直して紛らわしい誤訳に入れた訳を、AI が許容訳に
// 戻さないように。英→日の △・日→英の ×・△ に直した答えは一覧に残らないので守れない。仕様書 8-4）
export function applyFill(word: Word, fill: FillResult, mode: 'new' | 'supplement', now: Date): Word {
  const notIn = (list: readonly string[]) => (t: string): boolean => !list.some((x) => sameJa(x, t))
  if (mode === 'new') {
    const meaning = empty(word.meaning) ? fill.meaning : word.meaning.trim()
    const accepted = addJa(addJa([], fill.accepted), [meaning])
    const out: Word = {
      ...word,
      kind: fill.kind,
      meaning,
      accepted,
      // 許容訳にある訳は紛らわしい誤訳に入れない（supplement と同じ決まり）
      nearMiss: addJa([], fill.nearMiss.filter(notIn(accepted))),
      acceptedEn: addEn([], fill.acceptedEn),
      needsAi: false,
      updatedAt: now,
    }
    setOpt(out, 'tone', fill.tone)
    setOpt(out, 'exampleEn', fill.exampleEn)
    setOpt(out, 'exampleJa', fill.exampleJa)
    setOpt(out, 'note', fill.note)
    // 穴埋めは単語・熟語だけ。文と答えの両方があるときだけ入れる
    const hasCloze = out.kind === 'word' && !empty(fill.cloze) && !empty(fill.clozeAnswer)
    setOpt(out, 'cloze', hasCloze ? fill.cloze : '')
    setOpt(out, 'clozeAnswer', hasCloze ? fill.clozeAnswer : '')
    return out
  }

  const accepted = addJa(addJa(word.accepted, fill.accepted.filter(notIn(word.nearMiss))), [word.meaning])
  const out: Word = {
    ...word,
    accepted,
    nearMiss: addJa(word.nearMiss, fill.nearMiss.filter(notIn(accepted))),
    acceptedEn: addEn(word.acceptedEn, fill.acceptedEn),
    needsAi: false,
    updatedAt: now,
  }
  if (empty(word.tone)) setOpt(out, 'tone', fill.tone)
  if (empty(word.note)) setOpt(out, 'note', fill.note)
  // 例文は英語と訳の組で扱う（訳だけを別の例文から入れない）
  if (empty(word.exampleEn)) {
    setOpt(out, 'exampleEn', fill.exampleEn)
    setOpt(out, 'exampleJa', fill.exampleJa)
  }
  // 穴埋めも文と答えの組。単語・熟語で、まだ無いときだけ
  if (word.kind === 'word' && empty(word.cloze) && !empty(fill.cloze) && !empty(fill.clozeAnswer)) {
    setOpt(out, 'cloze', fill.cloze)
    setOpt(out, 'clozeAnswer', fill.clozeAnswer)
  }
  return out
}
