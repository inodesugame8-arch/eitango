// 判定と登録の補助の、指示・内容・出力のスキーマと、返事の読み取り（仕様書 7-3・8-1）
// 動作確認の段で使うので、src/lib のうち types と gemini/client 以外は import しない
import type { Direction, Kind, Verdict, Word } from '../types.ts'
import { GeminiError } from './client.ts'

export const JUDGE_EN_JA_SYSTEM = [
  'あなたは英単語テストの採点者です。学習者は英語初心者の日本人です。',
  '基準:',
  '- 意味の中心が合えば correct（表記ゆれ・語尾・言い換えは問わない）。',
  '- ニュアンス・強さ・品詞がずれる、または文脈とは別の意味なら close。',
  '- フレーズは口調も見る。意味が合っても口調が違えば close。',
  '- 反対の意味・別の語・あいまいすぎる答えは wrong。',
  '- reason は 30 字以内の日本語。correct でなければ、答えのどこが違うか（意味・ニュアンス・口調など）を書く。褒め言葉や前置きは書かない。',
  '- better は、より自然な日本語訳。答えがすでに自然なら空文字。',
].join('\n')

export const JUDGE_JA_EN_SYSTEM = [
  'あなたは英作文の採点者です。学習者は英語初心者の日本人です。',
  '基準:',
  '- 求める意味と口調が合えば correct（崩した言い方・小さな語順の違いは問わない）。',
  '- 意味は合うが不自然・口調が違う・小さな文法の誤りなら close。',
  '- 意味が違う・通じないなら wrong。',
  '- 穴埋めの問題では、学習者の語を穴に入れた文で判断する。',
  '- 穴埋めの問題で、穴の答えの代わりに別の言い方（許容する言い方に無いもの）を入れたら、意味が合っていても close（覚えたい語を書けていないため）。',
  '- reason は 30 字以内の日本語。correct でなければ、答えのどこが違うか（語形・時制・意味・口調など）を書く。褒め言葉や前置きは書かない。',
  '- better は、より自然な英語。答えがすでに自然なら空文字。',
].join('\n')

export const FILL_SYSTEM = [
  'あなたは英語学習者向けの単語カードを作る編集者です。学習者は英語初心者の日本人で、オンラインゲームのチャットや若者の日常会話（スラングを含む）で出会った英語を覚えたい。',
  '決まり:',
  '- 学習者が意味を入れていれば、それが覚えたい意味。accepted・near_miss・accepted_en・tone・example_en・example_ja・note・cloze をすべてその意味で作る。英語にスラングなど別の意味があっても、その意味では作らない（例: salty に「塩辛い」なら、味の例文にする）。出会った英文がその意味で使われていなければ、cloze は example_en から作る。',
  '- meaning: カードを作った意味（accepted・example_ja と同じ意味）。学習者が意味を入れていれば、ふつうはその意味のまま。入れていなければ、出会った英文があればその文脈での意味。',
  '- kind: 1〜3 語の単語・熟語なら word、文・あいさつ・決まり文句なら phrase。',
  '- accepted: 正解にしてよい日本語訳を 2〜6 個。meaning を必ず含め、漢字とかなの書き分け（例: 諦める・あきらめる）も入れる。',
  '- near_miss: 紛らわしいが不正解にすべき訳を 0〜3 個。',
  '- accepted_en: 日→英で正解にしてよい英語を 1〜4 個。英語そのものを含め、崩した言い方（wanna など）や同じ意味の別の言い方を入れる。ハイフンでつなぐ英語（pay-to-win など）は、空白で区切った形（pay to win）も入れる。',
  '- tone: 口調と使う場面（30 字以内）。特に無ければ空文字。',
  '- example_en: 短い例文（10 語以内）。example_ja: その訳。',
  '- note: スラングか、くだけた言い方か、など（30 字以内）。無ければ空文字。',
  '- cloze と cloze_answer: kind が word のときだけ作る。出会った英文（無ければ example_en）の中で英語に当たる語を、1 語につき ___ 1 つに置き換えた文を cloze に、置き換えた語を文の中の語形のまま cloze_answer に入れる（例: gave up）。kind が phrase なら両方空文字。英語に当たる語が文の中に 2 回以上あるときも両方空文字。出会った英文の中の語の綴りが、英語（その活用形を含む）の正しい綴りと違うときは、example_en から作る。',
  '- term_check: 英語（学習者が打った英語）に、打ち間違い・綴りの誤り・似た語との取り違え（loose と lose など）・言い回しの覚え違いがありそうなら suspect、無ければ ok。スラング・略語・わざと崩した綴り（gg、ngl、wanna、u など）・アポストロフィを省いた書き方（dont、im など）・活用した形（gave up、nerfed など）・イギリス綴り（colour など）・固有名詞・ゲームの用語は誤りにしない。英語が文なら、綴りの誤りと明らかな語の取り違えだけを見て、くだけた文法は見ない。出会った英文や学習者の意味があれば手がかりにする。迷うときは ok。',
  '- suggestion: term_check が suspect のとき、正しいと思う英語を 1 つ。英語だけを書き、説明や日本語は付けない（英語が文なら、直した文）。ok なら空文字。',
  '- check_reason: term_check が suspect のとき、そう思う理由（30 字以内の日本語）。ok なら空文字。',
  '- 英語に誤りがありそうでも、ほかの欄は、打ったとおりの英語について作る（suggestion の英語に置き換えて作らない）。',
  '- 褒め言葉や前置きは書かない。',
].join('\n')

// 出力のスキーマ（JSON Schema。responseFormat.text.schema と responseJsonSchema のどちらにも渡せる）
export const JUDGE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['correct', 'close', 'wrong'] },
    reason: { type: 'string' },
    better: { type: 'string' },
  },
  required: ['verdict', 'reason'],
}

const STRING = { type: 'string' }
const FILL_KEYS = [
  'kind',
  'meaning',
  'tone',
  'accepted',
  'near_miss',
  'accepted_en',
  'example_en',
  'example_ja',
  'note',
  'cloze',
  'cloze_answer',
  'term_check',
  'suggestion',
  'check_reason',
] as const

export const FILL_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    kind: { type: 'string', enum: ['word', 'phrase'] },
    meaning: STRING,
    tone: STRING,
    accepted: { type: 'array', items: STRING, minItems: 1, maxItems: 6 },
    near_miss: { type: 'array', items: STRING, maxItems: 3 },
    accepted_en: { type: 'array', items: STRING, minItems: 1, maxItems: 4 },
    example_en: STRING,
    example_ja: STRING,
    note: STRING,
    cloze: STRING,
    cloze_answer: STRING,
    term_check: { type: 'string', enum: ['ok', 'suspect'] },
    suggestion: STRING,
    check_reason: STRING,
  },
  required: [...FILL_KEYS],
}

export interface PromptParts {
  system: string
  user: string
  schema: Record<string, unknown>
}

// 「名前: 値」の行を作る。値が空の項目は行ごと省く
function lines(rows: readonly (readonly [string, string | undefined])[]): string {
  return rows
    .filter(([, value]) => value !== undefined && value.trim() !== '')
    .map(([label, value]) => `${label}: ${(value ?? '').trim()}`)
    .join('\n')
}

// 単語・熟語で、穴埋めの文と穴の答えがあるか（フレーズに穴埋めが残っていても使わない。仕様書 7-5）
function usesCloze(word: Word): boolean {
  return (
    word.kind === 'word' &&
    word.cloze !== undefined &&
    word.cloze.trim() !== '' &&
    word.clozeAnswer !== undefined &&
    word.clozeAnswer.trim() !== ''
  )
}

// 日→英は、単語・熟語で穴埋めの文と穴の答えがあれば穴埋めの版、それ以外は全文の版
export function judgePrompt(word: Word, direction: Direction, answer: string): PromptParts {
  if (direction === 'en-ja') {
    return {
      system: JUDGE_EN_JA_SYSTEM,
      user: lines([
        ['英語', word.term],
        ['出会った英文', word.context],
        ['この文脈での意味', word.meaning],
        ['口調', word.tone],
        ['許容する訳', word.accepted.join('、')],
        ['不正解にすべき訳', word.nearMiss.join('、')],
        ['学習者の答え', answer],
      ]),
      schema: JUDGE_SCHEMA,
    }
  }
  const user = usesCloze(word)
    ? lines([
        ['穴埋めの文', word.cloze],
        ['穴の答え', word.clozeAnswer],
        ['求める意味', word.meaning],
        ['口調', word.tone],
        ['許容する言い方', word.acceptedEn.join(' / ')],
        ['学習者が穴に入れた語', answer],
      ])
    : lines([
        ['求める意味', word.meaning],
        ['口調', word.tone],
        ['出会った英文', word.context],
        ['正解の例', word.term],
        ['許容する言い方', word.acceptedEn.join(' / ')],
        ['学習者の答え', answer],
      ])
  return { system: JUDGE_JA_EN_SYSTEM, user, schema: JUDGE_SCHEMA }
}

export interface JudgeResult {
  verdict: Verdict
  reason: string
  better: string
}

type Obj = Record<string, unknown>

function asObj(v: unknown): Obj {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) {
    throw new GeminiError('bad-response', '返事がオブジェクトではありません')
  }
  return v as Obj
}

const VERDICTS: readonly unknown[] = ['correct', 'close', 'wrong']

// 形式が違えば GeminiError('bad-response')。better が無ければ ''
export function parseJudge(obj: unknown): JudgeResult {
  const o = asObj(obj)
  if (!VERDICTS.includes(o.verdict)) throw new GeminiError('bad-response', `verdict が違います（${String(o.verdict)}）`)
  if (typeof o.reason !== 'string') throw new GeminiError('bad-response', 'reason がありません')
  return {
    verdict: o.verdict as Verdict,
    reason: o.reason.trim(),
    better: typeof o.better === 'string' ? o.better.trim() : '',
  }
}

export function fillPrompt(input: { term: string; context?: string; meaning?: string }): PromptParts {
  return {
    system: FILL_SYSTEM,
    user: lines([
      ['英語', input.term],
      ['出会った英文', input.context],
      ['学習者が覚えたい意味', input.meaning],
    ]),
    schema: FILL_SCHEMA,
  }
}

// 英語の打ち間違いの点検（設計書 2026-11-10 の 5-2）
export interface TermCheck {
  suspect: boolean
  suggestion: string
  reason: string
}

export interface FillResult {
  kind: Kind
  meaning: string
  tone: string
  accepted: string[]
  nearMiss: string[]
  acceptedEn: string[]
  exampleEn: string
  exampleJa: string
  note: string
  cloze: string
  clozeAnswer: string
  check: TermCheck
}

function str(o: Obj, key: string): string {
  const v = o[key]
  if (typeof v !== 'string') throw new GeminiError('bad-response', `${key} が文字列ではありません`)
  return v.trim()
}

function strList(o: Obj, key: string): string[] {
  const v = o[key]
  if (!Array.isArray(v) || !v.every((x) => typeof x === 'string')) {
    throw new GeminiError('bad-response', `${key} が文字列の配列ではありません`)
  }
  return v.map((x) => x.trim()).filter((x) => x !== '')
}

// 点検の 3 つ。無い・形が違うときは ok とみなし、誤りにしない（点検のせいで「作る」を失敗させない。設計書 2026-11-10 の 5-2）
function readCheck(o: Obj): TermCheck {
  return {
    suspect: o.term_check === 'suspect',
    suggestion: typeof o.suggestion === 'string' ? o.suggestion.trim() : '',
    reason: typeof o.check_reason === 'string' ? o.check_reason.trim() : '',
  }
}

// snake_case の返事を読む。形式が違えば GeminiError('bad-response')
export function parseFill(obj: unknown): FillResult {
  const o = asObj(obj)
  if (o.kind !== 'word' && o.kind !== 'phrase') throw new GeminiError('bad-response', `kind が違います（${String(o.kind)}）`)
  const meaning = str(o, 'meaning')
  if (meaning === '') throw new GeminiError('bad-response', 'meaning が空です')
  return {
    kind: o.kind,
    meaning,
    tone: str(o, 'tone'),
    accepted: strList(o, 'accepted'),
    nearMiss: strList(o, 'near_miss'),
    acceptedEn: strList(o, 'accepted_en'),
    exampleEn: str(o, 'example_en'),
    exampleJa: str(o, 'example_ja'),
    note: str(o, 'note'),
    cloze: str(o, 'cloze'),
    clozeAnswer: str(o, 'cloze_answer'),
    check: readCheck(o),
  }
}
