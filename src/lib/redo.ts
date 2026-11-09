// 確認の画面・編集の画面の欄と、「AI で作り直す」の当てはめ（設計書 2026-11-09 の 3-4）。
// 画面の欄の文字（一覧は 1 行に 1 つ）のまま扱う。その画面で直した欄（開いたとき、作り直した後は作り直した直後の値から
// 変わった欄）のうち空でないものは残し、ほかは AI の値にする。英語・出会った英文・出会った場所・意味はいつも残す
// （意味が空のときだけ AI の意味）。例文と訳、穴埋めの文と穴の答えは、それぞれ 2 つで 1 組
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

// 作り直した欄を返す。cur は今の画面の欄、base は開いたとき（作り直した後は作り直した直後）の欄、fill は AI の返事。
// 入力の欄は変えない
export function redoFields(cur: EditorFields, base: EditorFields, fill: FillResult): EditorFields {
  const meaning = cur.meaning.trim() === '' ? fill.meaning : cur.meaning
  const kind = cur.kind !== base.kind ? cur.kind : fill.kind

  // 許容訳には意味を必ず入れる（残した許容訳には、保存のときに applyEdit が入れる）
  const accepted = keepList(cur, base, 'accepted')
    ? listLines(cur.accepted)
    : addJa(addJa([], fill.accepted), [meaning.trim()])
  // 紛らわしい誤訳からは、許容訳（残したものか作り直したもの）と意味にある訳を除く
  const allowed = addJa(accepted, [meaning.trim()])
  const nearMiss = keepList(cur, base, 'nearMiss')
    ? listLines(cur.nearMiss)
    : addJa([], fill.nearMiss.filter((t) => !allowed.some((a) => sameJa(a, t))))
  const acceptedEn = keepList(cur, base, 'acceptedEn') ? listLines(cur.acceptedEn) : addEn([], fill.acceptedEn)

  const keepExample = keepText(cur, base, 'exampleEn') || keepText(cur, base, 'exampleJa')
  const keepCloze = keepText(cur, base, 'cloze') || keepText(cur, base, 'clozeAnswer')
  // AI の穴埋めは、種類が単語・熟語で、文と答えの両方があるときだけ入れる
  const aiCloze = kind === 'word' && fill.cloze.trim() !== '' && fill.clozeAnswer.trim() !== ''

  return {
    term: cur.term,
    kind,
    context: cur.context,
    source: cur.source,
    meaning,
    tone: keepText(cur, base, 'tone') ? cur.tone : fill.tone,
    accepted: accepted.join('\n'),
    nearMiss: nearMiss.join('\n'),
    acceptedEn: acceptedEn.join('\n'),
    exampleEn: keepExample ? cur.exampleEn : fill.exampleEn,
    exampleJa: keepExample ? cur.exampleJa : fill.exampleJa,
    note: keepText(cur, base, 'note') ? cur.note : fill.note,
    cloze: keepCloze ? cur.cloze : aiCloze ? fill.cloze : '',
    clozeAnswer: keepCloze ? cur.clozeAnswer : aiCloze ? fill.clozeAnswer : '',
  }
}
