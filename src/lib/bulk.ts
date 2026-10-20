// まとめて読み込む JSON と、Claude への頼み方（仕様書 8-3）。バックアップからの戻し（置き換え）ではなく追加
import { makeCloze } from './cloze.ts'
import { newId } from './id.ts'
import { sameJa } from './match.ts'
import { normalizeEn, normalizeJa } from './normalize.ts'
import type { Kind, Word } from './types.ts'

// 「Claude への頼み方をコピー」で入れる文。この後ろに単語を並べて Claude に渡す
export const CLAUDE_PROMPT = [
  '英単語アプリに読み込む JSON を作ってください。',
  '学習者は英語初心者の日本人で、オンラインゲームのチャットや若者の日常会話（スラングを含む）で出会った英語を覚えたい。',
  '下に並べた英語 1 つにつき 1 つのオブジェクトを作り、JSON の配列だけを返してください（前置きや説明は書かない）。',
  '',
  '各オブジェクトの項目:',
  '- term: 英語（並べたとおり）。必須',
  '- kind: 1〜3 語の単語・熟語なら "word"、文・あいさつ・決まり文句なら "phrase"',
  '- context: 出会った英文（書いてあればそのまま。無ければ空文字）',
  '- source: 出会った場所（ゲーム名など。書いてあれば。無ければ空文字）',
  '- meaning: 出会った英文があれば、その文脈での日本語の意味。意味が書いてあれば、それを軸にする。必須',
  '- tone: 口調と使う場面（30 字以内）。特に無ければ空文字',
  '- accepted: 正解にしてよい日本語訳を 2〜6 個。meaning を必ず含め、漢字とかなの書き分け（例: 諦める・あきらめる）も入れる',
  '- near_miss: 紛らわしいが不正解にすべき訳を 0〜3 個',
  '- accepted_en: 日本語から英語を答える問題で正解にしてよい英語を 1〜4 個。英語そのものを含め、崩した言い方（wanna など）や同じ意味の別の言い方を入れる。ハイフンでつなぐ英語（pay-to-win など）は、空白で区切った形（pay to win）も入れる',
  '- example_en: 短い例文（10 語以内）。example_ja: その訳',
  '- note: スラングか、くだけた言い方か、など（30 字以内）。無ければ空文字',
  '- cloze と cloze_answer: kind が "word" のときだけ作る。出会った英文（無ければ example_en）の中で英語に当たる語を、1 語につき ___ 1 つに置き換えた文を cloze に、置き換えた語を文の中の語形のまま cloze_answer に入れる（例: gave up）。kind が "phrase" なら両方空文字。英語に当たる語が文の中に 2 回以上あるときも両方空文字',
  '',
  '例:',
  '[{"term":"give up","kind":"word","context":"don\'t give up, we can still win","source":"","meaning":"諦める","tone":"","accepted":["諦める","あきらめる","断念する"],"near_miss":["負ける"],"accepted_en":["give up","quit"],"example_en":"Never give up.","example_ja":"決して諦めるな。","note":"","cloze":"don\'t ___ ___, we can still win","cloze_answer":"give up"}]',
  '',
  '英語（1 行に 1 つ。出会った英文や意味があれば同じ行に書く）:',
  '',
].join('\n')

// 貼った文字列に ``` の囲みがあれば、最初の囲みの中だけを返す（Claude の返事に付くことがあるため）
export function stripFences(text: string): string {
  const m = /```[^\n]*\n([\s\S]*?)\n?```/.exec(text)
  return (m ? m[1] : text).trim()
}

// 3 語以上か、? か ! で終わればフレーズ（仕様書 8-2 の初めの値）
export function guessKind(term: string): Kind {
  const t = term.trim()
  const words = t.split(/\s+/).filter((w) => w !== '')
  return words.length >= 3 || /[?!]$/.test(t) ? 'phrase' : 'word'
}

export type ParseBulkResult = { ok: true; words: Word[]; skipped: number } | { ok: false; error: string }

class FormatError extends Error {}

type Obj = Record<string, unknown>

// 必須の文字列（前後の空白を除いて空でないこと）
function required(o: Obj, key: string, where: string): string {
  const v = o[key]
  if (typeof v !== 'string' || v.trim() === '') throw new FormatError(`${where}の ${key} が空か、文字列ではありません`)
  return v.trim()
}

// 任意の文字列。無い・null・空文字は undefined
function optional(o: Obj, key: string, where: string): string | undefined {
  const v = o[key]
  if (v === undefined || v === null) return undefined
  if (typeof v !== 'string') throw new FormatError(`${where}の ${key} が文字列ではありません`)
  return v.trim() === '' ? undefined : v.trim()
}

// 任意の文字列の配列。無い・null は undefined。空の要素は除く
function optionalList(o: Obj, key: string, where: string): string[] | undefined {
  const v = o[key]
  if (v === undefined || v === null) return undefined
  if (!Array.isArray(v) || !v.every((x) => typeof x === 'string')) {
    throw new FormatError(`${where}の ${key} が文字列の配列ではありません`)
  }
  return v.map((x) => x.trim()).filter((x) => x !== '')
}

interface Item {
  term: string
  kind?: Kind
  context?: string
  source?: string
  meaning: string
  tone?: string
  accepted?: string[]
  nearMiss?: string[]
  acceptedEn?: string[]
  exampleEn?: string
  exampleJa?: string
  note?: string
  cloze?: string
  clozeAnswer?: string
}

function readItem(v: unknown, where: string): Item {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) {
    throw new FormatError(`${where}が { } のオブジェクトではありません`)
  }
  const o = v as Obj
  const term = required(o, 'term', where)
  const meaning = required(o, 'meaning', where)
  let kind: Kind | undefined
  if (o.kind !== undefined && o.kind !== null && o.kind !== '') {
    if (o.kind !== 'word' && o.kind !== 'phrase') throw new FormatError(`${where}の kind が違います（word か phrase）`)
    kind = o.kind
  }
  const cloze = optional(o, 'cloze', where)
  const clozeAnswer = optional(o, 'cloze_answer', where)
  if ((cloze === undefined) !== (clozeAnswer === undefined)) {
    throw new FormatError(`${where}の cloze と cloze_answer は、両方入れるか両方空にしてください`)
  }
  return {
    term,
    kind,
    context: optional(o, 'context', where),
    source: optional(o, 'source', where),
    meaning,
    tone: optional(o, 'tone', where),
    accepted: optionalList(o, 'accepted', where),
    nearMiss: optionalList(o, 'near_miss', where),
    acceptedEn: optionalList(o, 'accepted_en', where),
    exampleEn: optional(o, 'example_en', where),
    exampleJa: optional(o, 'example_ja', where),
    note: optional(o, 'note', where),
    cloze,
    clozeAnswer,
  }
}

function toWord(item: Item, now: Date): Word {
  const kind = item.kind ?? guessKind(item.term)
  const hasAccepted = item.accepted !== undefined && item.accepted.length > 0
  // accepted があれば AI で補ったものとして扱い、意味が無ければ足す。無ければ 8-2 と同じ初めの値
  const accepted = hasAccepted ? [...(item.accepted ?? [])] : [item.meaning]
  if (!accepted.some((t) => sameJa(t, item.meaning))) accepted.push(item.meaning)
  const word: Word = {
    id: newId(),
    term: item.term,
    kind,
    meaning: item.meaning,
    accepted,
    nearMiss: item.nearMiss ?? [],
    acceptedEn: item.acceptedEn && item.acceptedEn.length > 0 ? item.acceptedEn : [item.term],
    needsAi: !hasAccepted,
    createdAt: now,
    updatedAt: now,
  }
  // 空の任意の項目は入れない
  if (item.context !== undefined) word.context = item.context
  if (item.source !== undefined) word.source = item.source
  if (item.tone !== undefined) word.tone = item.tone
  if (item.exampleEn !== undefined) word.exampleEn = item.exampleEn
  if (item.exampleJa !== undefined) word.exampleJa = item.exampleJa
  if (item.note !== undefined) word.note = item.note
  // 穴埋めは単語・熟語だけ。無ければ出会った英文から 7-5 の決まりで作る
  if (kind === 'word') {
    if (item.cloze !== undefined && item.clozeAnswer !== undefined) {
      word.cloze = item.cloze
      word.clozeAnswer = item.clozeAnswer
    } else if (item.context !== undefined) {
      const made = makeCloze(item.term, item.context)
      if (made) {
        word.cloze = made.cloze
        word.clozeAnswer = made.answer
      }
    }
  }
  return word
}

// 同じ語 = 英語の正規化をかけた term と、日本語の正規化をかけた meaning が両方同じ
function sameKey(term: string, meaning: string): string {
  return `${normalizeEn(term)}\u0000${normalizeJa(meaning)}`
}

// 全部読み込むか、何も読み込まないか。既にある語と、配列の中で先に出た語は読み飛ばして数える
export function parseBulk(text: string, existing: readonly Word[], now: Date): ParseBulkResult {
  let raw: unknown
  try {
    raw = JSON.parse(stripFences(text))
  } catch {
    return { ok: false, error: 'JSON として読めませんでした' }
  }
  if (!Array.isArray(raw)) return { ok: false, error: 'JSON の配列ではありません（[ ] で囲んだ一覧にしてください）' }
  let items: Item[]
  try {
    items = raw.map((v, i) => readItem(v, `${i + 1} 番目`))
  } catch (e) {
    if (e instanceof FormatError) return { ok: false, error: e.message }
    throw e
  }
  const seen = new Set(existing.map((w) => sameKey(w.term, w.meaning)))
  const kept: Item[] = []
  let skipped = 0
  for (const item of items) {
    const k = sameKey(item.term, item.meaning)
    if (seen.has(k)) {
      skipped += 1
      continue
    }
    seen.add(k)
    kept.push(item)
  }
  // 貼った順に新しい問題として出すため、登録の日時を後ろほど 1 ミリ秒ずつ新しくする（最後の語が now）
  const t = now.getTime()
  const words = kept.map((item, i) => toWord(item, new Date(t - (kept.length - 1 - i))))
  return { ok: true, words, skipped }
}
