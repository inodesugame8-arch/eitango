// 判定の指示を試す 20 問（仕様書 13-2）。照合を通さず、直接 AI で判定する。
// expected は本人の判定の見込みで、目安。本人が直してよい
import type { Direction, Verdict, Word } from '../lib/types.ts'

// 判定に使う Word の項目
export type CaseWord = Pick<Word, 'term' | 'kind' | 'meaning' | 'accepted' | 'nearMiss' | 'acceptedEn'> &
  Partial<Pick<Word, 'context' | 'tone' | 'cloze' | 'clozeAnswer'>>

export type JudgeCase = CaseWord & {
  no: number
  direction: Direction
  answer: string
  expected: Verdict
}

// 同じ語を何問かで使うもの
const sick: CaseWord = {
  term: 'sick',
  kind: 'word',
  context: 'that play was sick',
  meaning: 'すごい・かっこいい',
  tone: 'スラング',
  accepted: ['すごい', 'かっこいい', 'やばい'],
  nearMiss: ['病気の'],
  acceptedEn: ['sick'],
}

const winEnJa: CaseWord = {
  term: 'Do you even wanna win?',
  kind: 'phrase',
  context: 'Do you even wanna win?',
  meaning: '本気で勝つ気あんの？',
  tone: 'イラ立ち・皮肉。味方を責める言い方',
  accepted: ['本気で勝つ気あるの', '勝つ気あんの'],
  // 「勝ちたいの」は入れない（入れると × にすべき答えになり、11 の「口調の違いは △」を試せない）
  nearMiss: [],
  acceptedEn: ['Do you even wanna win?'],
}

const giveUpJaEn: CaseWord = {
  term: 'give up',
  kind: 'word',
  context: "don't give up, we can still win",
  meaning: 'あきらめる',
  accepted: ['あきらめる'],
  nearMiss: [],
  acceptedEn: ['give up'],
  cloze: "Don't ___ ___, we can still win.",
  clozeAnswer: 'give up',
}

const winJaEn: CaseWord = {
  term: 'Do you even wanna win?',
  kind: 'phrase',
  meaning: '本気で勝つ気あんの？',
  tone: 'イラ立ち・皮肉',
  accepted: ['本気で勝つ気あんの？'],
  nearMiss: [],
  acceptedEn: ['Do you even want to win?'],
}

export const JUDGE_CASES: readonly JudgeCase[] = [
  {
    no: 1,
    direction: 'en-ja',
    term: 'give up',
    kind: 'word',
    context: "don't give up, we can still win",
    meaning: 'あきらめる',
    accepted: ['あきらめる', '諦める', '断念する'],
    nearMiss: ['やめる', '手放す'],
    acceptedEn: ['give up'],
    answer: 'ギブアップする',
    expected: 'correct',
  },
  { no: 2, direction: 'en-ja', ...sick, answer: '病気の', expected: 'wrong' },
  { no: 3, direction: 'en-ja', ...sick, answer: '最高', expected: 'correct' },
  {
    no: 4,
    direction: 'en-ja',
    term: 'salty',
    kind: 'word',
    context: 'why are you so salty',
    meaning: '負けてイラついている',
    accepted: ['イラついている', '不機嫌'],
    nearMiss: ['しょっぱい'],
    acceptedEn: ['salty'],
    answer: 'しょっぱい',
    expected: 'wrong',
  },
  {
    no: 5,
    direction: 'en-ja',
    term: 'carry',
    kind: 'word',
    context: 'he carried us',
    meaning: '（強くて）チームを勝たせる',
    accepted: ['チームを勝たせる', '引っ張る'],
    nearMiss: ['運ぶ'],
    acceptedEn: ['carry'],
    answer: 'チームを引っ張った',
    expected: 'correct',
  },
  {
    no: 6,
    direction: 'en-ja',
    term: 'throw',
    kind: 'word',
    context: 'stop throwing',
    meaning: 'わざと負ける・試合を投げる',
    accepted: ['わざと負ける', '試合を投げる'],
    // 「投げる」は入れない（入れると × にすべき答えになり、「文脈と違う意味は △」を試せない）
    nearMiss: [],
    acceptedEn: ['throw'],
    answer: '投げる',
    expected: 'close',
  },
  {
    no: 7,
    direction: 'en-ja',
    term: 'clutch',
    kind: 'word',
    context: 'that was clutch',
    meaning: 'ここ一番で決める（こと）',
    accepted: ['ここ一番で決める', '土壇場で決める'],
    nearMiss: [],
    acceptedEn: ['clutch'],
    answer: '大事な場面',
    expected: 'close',
  },
  {
    no: 8,
    direction: 'en-ja',
    term: 'overrated',
    kind: 'word',
    context: 'this weapon is overrated',
    meaning: '過大評価されている',
    accepted: ['過大評価されている', '評価されすぎ'],
    nearMiss: ['過小評価されている'],
    acceptedEn: ['overrated'],
    answer: '過小評価されている',
    expected: 'wrong',
  },
  {
    no: 9,
    direction: 'en-ja',
    term: 'no cap',
    kind: 'word',
    context: 'no cap that was insane',
    meaning: 'マジで・うそじゃなく',
    accepted: ['マジで', 'うそじゃなく', 'ガチで'],
    nearMiss: ['帽子なし'],
    acceptedEn: ['no cap'],
    answer: 'ガチで',
    expected: 'correct',
  },
  {
    no: 10,
    direction: 'en-ja',
    term: 'lowkey',
    kind: 'word',
    context: 'I lowkey want to quit',
    meaning: 'ちょっと・正直なところ',
    tone: '控えめに言う',
    accepted: ['ちょっと', '正直', 'ひそかに'],
    nearMiss: ['低い'],
    acceptedEn: ['lowkey'],
    answer: '低い',
    expected: 'wrong',
  },
  { no: 11, direction: 'en-ja', ...winEnJa, answer: '勝ちたいの？', expected: 'close' },
  { no: 12, direction: 'en-ja', ...winEnJa, answer: '勝つ気ある？', expected: 'correct' },
  {
    no: 13,
    direction: 'en-ja',
    term: 'my bad',
    kind: 'phrase',
    context: 'my bad, I missed',
    meaning: 'ごめん、自分のミス',
    tone: '軽い謝り',
    accepted: ['ごめん', '自分のミス', '私のせい'],
    nearMiss: [],
    acceptedEn: ['my bad'],
    answer: '私が悪かったです',
    expected: 'close',
  },
  {
    no: 14,
    direction: 'en-ja',
    term: 'gg',
    kind: 'word',
    context: 'gg wp',
    meaning: 'いい試合だった',
    tone: '試合の終わりに',
    accepted: ['いい試合だった', 'おつかれ'],
    nearMiss: [],
    acceptedEn: ['gg'],
    answer: 'グッドゲーム',
    expected: 'correct',
  },
  { no: 15, direction: 'ja-en', ...giveUpJaEn, answer: 'quit', expected: 'correct' },
  { no: 16, direction: 'ja-en', ...giveUpJaEn, answer: 'give in', expected: 'close' },
  { no: 17, direction: 'ja-en', ...winJaEn, answer: 'Do you even want to win', expected: 'correct' },
  { no: 18, direction: 'ja-en', ...winJaEn, answer: 'Do you want to win?', expected: 'close' },
  {
    no: 19,
    direction: 'ja-en',
    term: 'my bad',
    kind: 'phrase',
    meaning: 'ごめん、自分のミス',
    tone: '軽い謝り',
    accepted: ['ごめん、自分のミス'],
    nearMiss: [],
    acceptedEn: ['my bad'],
    answer: 'my mistake',
    expected: 'correct',
  },
  {
    no: 20,
    direction: 'ja-en',
    term: 'carry',
    kind: 'word',
    context: 'he carried us',
    meaning: '（強くて）チームを勝たせる',
    accepted: ['（強くて）チームを勝たせる'],
    nearMiss: [],
    acceptedEn: ['carry'],
    cloze: 'he ___ us',
    clozeAnswer: 'carried',
    // carry だと本番では照合で ○ になり AI に届かないので、届く語形にする
    answer: 'carries',
    expected: 'close',
  },
]

// 判定の指示（judgePrompt）に渡す Word にする。id と日時は判定に使わないので決まった値
export function caseWord(c: JudgeCase): Word {
  const at = new Date(0)
  const word: Word = {
    id: `check-${c.no}`,
    term: c.term,
    kind: c.kind,
    meaning: c.meaning,
    accepted: [...c.accepted],
    nearMiss: [...c.nearMiss],
    acceptedEn: [...c.acceptedEn],
    needsAi: false,
    createdAt: at,
    updatedAt: at,
  }
  if (c.context !== undefined) word.context = c.context
  if (c.tone !== undefined) word.tone = c.tone
  if (c.cloze !== undefined) word.cloze = c.cloze
  if (c.clozeAnswer !== undefined) word.clozeAnswer = c.clozeAnswer
  return word
}
