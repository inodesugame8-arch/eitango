// 確認の画面・編集の画面の欄と、「AI で作り直す」の当てはめ（設計書 2026-11-09 の 3-4）。
// 画面の欄の文字（一覧は 1 行に 1 つ）のまま扱う。その画面で直した欄（比べる値から変わった欄）のうち空でないものは残し、
// ほかは AI の値にする。英語・出会った英文・出会った場所・意味はいつも残す（意味が空のときだけ AI の意味）。
// 例文と訳、穴埋めの文と穴の答えは、それぞれ 2 つで 1 組。比べる値は、画面を開いたときの値。作り直した後は、
// 作り直した欄だけを新しい値に替え、残した欄は前の比べる値のままにする（1 回目で残した本人の直しを、2 回目も残すため）
import { addEn, addJa } from './fill.ts'
import type { FillResult } from './gemini/prompts.ts'
import { sameJa } from './match.ts'
import type { Kind, Word } from './types.ts'

export interface EditorFields {
  term: string
  kind: Kind
  context: string
  source: string
  meaning: string
  tone: string
  accepted: string // 1 行に 1 つ
  nearMiss: string // 1 行に 1 つ
  acceptedEn: string // 1 行に 1 つ
  exampleEn: string
  exampleJa: string
  note: string
  cloze: string
  clozeAnswer: string
}

// 作り直した結果
export interface Redone {
  fields: EditorFields // 作り直した後の画面の欄
  base: EditorFields // 次に作り直すときの比べる値（作り直した欄は新しい値、残した欄は前の比べる値のまま）
}

// 語を画面の欄にする（無い項目は空文字、一覧は 1 行に 1 つ）
export function toFields(w: Word): EditorFields {
  return {
    term: w.term,
    kind: w.kind,
    context: w.context ?? '',
    source: w.source ?? '',
    meaning: w.meaning,
    tone: w.tone ?? '',
    accepted: w.accepted.join('\n'),
    nearMiss: w.nearMiss.join('\n'),
    acceptedEn: w.acceptedEn.join('\n'),
    exampleEn: w.exampleEn ?? '',
    exampleJa: w.exampleJa ?? '',
    note: w.note ?? '',
    cloze: w.cloze ?? '',
    clozeAnswer: w.clozeAnswer ?? '',
  }
}

type TextKey = 'tone' | 'note' | 'exampleEn' | 'exampleJa' | 'cloze' | 'clozeAnswer'
type ListKey = 'accepted' | 'nearMiss' | 'acceptedEn'

// 一覧の欄を行に分ける（行ごとに前後の空白を除き、空の行を除く）
function listLines(text: string): string[] {
  return text
    .split('\n')
    .map((t) => t.trim())
    .filter((t) => t !== '')
}

// 1 行の欄: 直していて（前後の空白を除いて比べる）空でなければ残す
function keepText(cur: EditorFields, base: EditorFields, key: TextKey): boolean {
  const t = cur[key].trim()
  return t !== '' && t !== base[key].trim()
}

// 一覧の欄: 直していて（行に分けてから比べる）空でなければ残す
function keepList(cur: EditorFields, base: EditorFields, key: ListKey): boolean {
  const now = listLines(cur[key])
  return now.length > 0 && now.join('\n') !== listLines(base[key]).join('\n')
}

// 組の欄: どちらかを直していて、2 つとも空でなければ組ごと残す（片方でも空なら組ごと作り直す。片方だけの組を残さない）
function keepPair(cur: EditorFields, base: EditorFields, a: TextKey, b: TextKey): boolean {
  return (keepText(cur, base, a) || keepText(cur, base, b)) && cur[a].trim() !== '' && cur[b].trim() !== ''
}

// 作り直す。cur は今の画面の欄、base は比べる値、fill は AI の返事。入力の欄は変えない
export function redoFields(cur: EditorFields, base: EditorFields, fill: FillResult): Redone {
  const meaning = cur.meaning.trim() === '' ? fill.meaning : cur.meaning
  const keepKind = cur.kind !== base.kind
  const kind = keepKind ? cur.kind : fill.kind
  const keepAccepted = keepList(cur, base, 'accepted')
  const keepNearMiss = keepList(cur, base, 'nearMiss')
  const keepAcceptedEn = keepList(cur, base, 'acceptedEn')
  const keepTone = keepText(cur, base, 'tone')
  const keepNote = keepText(cur, base, 'note')
  const keepExample = keepPair(cur, base, 'exampleEn', 'exampleJa')
  const keepCloze = keepPair(cur, base, 'cloze', 'clozeAnswer')

  // 紛らわしい誤訳を残したときは、作り直す許容訳から、残した紛らわしい誤訳にある訳を除く（「AI で補う」と同じ考え）。
  // 意味は除かない（許容訳には意味を必ず入れる。残した許容訳には、保存のときに applyEdit が入れる）
  const keptNearMiss = keepNearMiss ? listLines(cur.nearMiss) : []
  const accepted = keepAccepted
    ? listLines(cur.accepted)
    : addJa(addJa([], fill.accepted.filter((t) => !keptNearMiss.some((x) => sameJa(x, t)))), [meaning.trim()])
  // 紛らわしい誤訳からは、許容訳（残したものか作り直したもの）と意味にある訳を除く
  const allowed = addJa(accepted, [meaning.trim()])
  const nearMiss = keepNearMiss
    ? keptNearMiss
    : addJa([], fill.nearMiss.filter((t) => !allowed.some((a) => sameJa(a, t))))
  const acceptedEn = keepAcceptedEn ? listLines(cur.acceptedEn) : addEn([], fill.acceptedEn)
  // AI の穴埋めは、種類が単語・熟語で、文と答えの両方があるときだけ入れる
  const aiCloze = kind === 'word' && fill.cloze.trim() !== '' && fill.clozeAnswer.trim() !== ''

  const fields: EditorFields = {
    term: cur.term,
    kind,
    context: cur.context,
    source: cur.source,
    meaning,
    tone: keepTone ? cur.tone : fill.tone,
    accepted: accepted.join('\n'),
    nearMiss: nearMiss.join('\n'),
    acceptedEn: acceptedEn.join('\n'),
    exampleEn: keepExample ? cur.exampleEn : fill.exampleEn,
    exampleJa: keepExample ? cur.exampleJa : fill.exampleJa,
    note: keepNote ? cur.note : fill.note,
    cloze: keepCloze ? cur.cloze : aiCloze ? fill.cloze : '',
    clozeAnswer: keepCloze ? cur.clozeAnswer : aiCloze ? fill.clozeAnswer : '',
  }
  // 次の比べる値。いつも残す欄（英語・英文・場所・意味）は比べないので、今の値を入れておく
  const nextBase: EditorFields = {
    ...fields,
    kind: keepKind ? base.kind : fields.kind,
    tone: keepTone ? base.tone : fields.tone,
    accepted: keepAccepted ? base.accepted : fields.accepted,
    nearMiss: keepNearMiss ? base.nearMiss : fields.nearMiss,
    acceptedEn: keepAcceptedEn ? base.acceptedEn : fields.acceptedEn,
    exampleEn: keepExample ? base.exampleEn : fields.exampleEn,
    exampleJa: keepExample ? base.exampleJa : fields.exampleJa,
    note: keepNote ? base.note : fields.note,
    cloze: keepCloze ? base.cloze : fields.cloze,
    clozeAnswer: keepCloze ? base.clozeAnswer : fields.clozeAnswer,
  }
  return { fields, base: nextBase }
}
