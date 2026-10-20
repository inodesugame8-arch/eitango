import { describe, expect, it } from 'vitest'
import type { Word } from '../types.ts'
import { GeminiError, type GeminiErrorKind } from './client.ts'
import {
  FILL_SCHEMA,
  FILL_SYSTEM,
  fillPrompt,
  JUDGE_EN_JA_SYSTEM,
  JUDGE_JA_EN_SYSTEM,
  JUDGE_SCHEMA,
  judgePrompt,
  parseFill,
  parseJudge,
} from './prompts.ts'

const created = new Date(2026, 9, 18, 12)

function word(over: Partial<Word> = {}): Word {
  return {
    id: 'w1',
    term: 'give up',
    kind: 'word',
    context: "don't give up, we can still win",
    meaning: '諦める',
    tone: '励ます',
    accepted: ['諦める', 'あきらめる'],
    nearMiss: ['負ける', 'やめる'],
    acceptedEn: ['give up', 'quit'],
    cloze: "don't ___ ___, we can still win",
    clozeAnswer: 'give up',
    needsAi: false,
    createdAt: created,
    updatedAt: created,
    ...over,
  }
}

function thrownKind(f: () => unknown): GeminiErrorKind {
  try {
    f()
  } catch (e) {
    if (e instanceof GeminiError) return e.kind
    throw e
  }
  throw new Error('失敗しなかった')
}

describe('判定の指示（仕様書 7-3 の文のまま）', () => {
  it('英→日', () => {
    expect(JUDGE_EN_JA_SYSTEM).toBe(
      [
        'あなたは英単語テストの採点者です。学習者は英語初心者の日本人です。',
        '基準:',
        '- 意味の中心が合えば correct（表記ゆれ・語尾・言い換えは問わない）。',
        '- ニュアンス・強さ・品詞がずれる、または文脈とは別の意味なら close。',
        '- フレーズは口調も見る。意味が合っても口調が違えば close。',
        '- 反対の意味・別の語・あいまいすぎる答えは wrong。',
        '- reason は 30 字以内の日本語で、褒め言葉や前置きは書かない。',
        '- better は、より自然な日本語訳。答えがすでに自然なら空文字。',
      ].join('\n'),
    )
  })

  it('日→英', () => {
    expect(JUDGE_JA_EN_SYSTEM).toBe(
      [
        'あなたは英作文の採点者です。学習者は英語初心者の日本人です。',
        '基準:',
        '- 求める意味と口調が合えば correct（崩した言い方・小さな語順の違いは問わない）。',
        '- 意味は合うが不自然・口調が違う・小さな文法の誤りなら close。',
        '- 意味が違う・通じないなら wrong。',
        '- 穴埋めの問題では、学習者の語を穴に入れた文で判断する。',
        '- reason は 30 字以内の日本語で、褒め言葉や前置きは書かない。',
        '- better は、より自然な英語。答えがすでに自然なら空文字。',
      ].join('\n'),
    )
  })
})

describe('judgePrompt（仕様書 7-3 の内容の行）', () => {
  it('英→日: 全部の行', () => {
    const p = judgePrompt(word(), 'en-ja', 'あきらめない')
    expect(p.system).toBe(JUDGE_EN_JA_SYSTEM)
    expect(p.schema).toBe(JUDGE_SCHEMA)
    expect(p.user).toBe(
      [
        '英語: give up',
        "出会った英文: don't give up, we can still win",
        'この文脈での意味: 諦める',
        '口調: 励ます',
        '許容する訳: 諦める、あきらめる',
        '不正解にすべき訳: 負ける、やめる',
        '学習者の答え: あきらめない',
      ].join('\n'),
    )
  })

  it('英→日: 値が空の項目は行ごと省く', () => {
    const p = judgePrompt(word({ context: undefined, tone: '', nearMiss: [] }), 'en-ja', '投げ出す')
    expect(p.user).toBe(
      ['英語: give up', 'この文脈での意味: 諦める', '許容する訳: 諦める、あきらめる', '学習者の答え: 投げ出す'].join(
        '\n',
      ),
    )
  })

  it('日→英（全文を答える問題）: 穴埋めの文が無いとき', () => {
    const p = judgePrompt(word({ cloze: undefined, clozeAnswer: undefined }), 'ja-en', 'give in')
    expect(p.system).toBe(JUDGE_JA_EN_SYSTEM)
    expect(p.user).toBe(
      [
        '求める意味: 諦める',
        '口調: 励ます',
        "出会った英文: don't give up, we can still win",
        '正解の例: give up',
        '許容する言い方: give up / quit',
        '学習者の答え: give in',
      ].join('\n'),
    )
  })

  it('日→英（穴埋めの問題）: 穴埋めの文があるとき', () => {
    const p = judgePrompt(word(), 'ja-en', 'give in')
    expect(p.system).toBe(JUDGE_JA_EN_SYSTEM)
    expect(p.user).toBe(
      [
        "穴埋めの文: don't ___ ___, we can still win",
        '穴の答え: give up',
        '求める意味: 諦める',
        '口調: 励ます',
        '許容する言い方: give up / quit',
        '学習者が穴に入れた語: give in',
      ].join('\n'),
    )
  })

  it('日→英: フレーズは、穴埋めの文が残っていても全文の版（穴埋めは単語・熟語だけ。仕様書 7-5）', () => {
    const p = judgePrompt(
      word({
        term: 'my bad',
        kind: 'phrase',
        context: 'my bad, I missed',
        meaning: 'ごめん、自分のミス',
        tone: '軽い謝り',
        acceptedEn: ['my bad'],
        cloze: '___ ___, I missed',
        clozeAnswer: 'my bad',
      }),
      'ja-en',
      'my mistake',
    )
    expect(p.system).toBe(JUDGE_JA_EN_SYSTEM)
    expect(p.user).toBe(
      [
        '求める意味: ごめん、自分のミス',
        '口調: 軽い謝り',
        '出会った英文: my bad, I missed',
        '正解の例: my bad',
        '許容する言い方: my bad',
        '学習者の答え: my mistake',
      ].join('\n'),
    )
  })

  it('日→英: 穴の答えが無ければ、穴埋めの文があっても全文の版', () => {
    const p = judgePrompt(word({ clozeAnswer: undefined }), 'ja-en', 'give in')
    expect(p.user.startsWith('求める意味: 諦める')).toBe(true)
    expect(p.user).not.toContain('穴埋めの文')
  })

  it('日→英: 値が空の項目は行ごと省く', () => {
    const p = judgePrompt(
      word({ cloze: undefined, clozeAnswer: undefined, tone: undefined, context: '  ', acceptedEn: [] }),
      'ja-en',
      'quit',
    )
    expect(p.user).toBe(['求める意味: 諦める', '正解の例: give up', '学習者の答え: quit'].join('\n'))
  })
})

describe('JUDGE_SCHEMA（仕様書 7-3: verdict・reason は必須、better は任意）', () => {
  it('項目と必須', () => {
    expect(JUDGE_SCHEMA).toEqual({
      type: 'object',
      properties: {
        verdict: { type: 'string', enum: ['correct', 'close', 'wrong'] },
        reason: { type: 'string' },
        better: { type: 'string' },
      },
      required: ['verdict', 'reason'],
    })
  })
})

describe('parseJudge', () => {
  it('正しい返事を読む', () => {
    expect(parseJudge({ verdict: 'close', reason: '口調が違う', better: 'あきらめんな' })).toEqual({
      verdict: 'close',
      reason: '口調が違う',
      better: 'あきらめんな',
    })
  })

  it('better が無ければ空文字', () => {
    expect(parseJudge({ verdict: 'correct', reason: '合う' })).toEqual({ verdict: 'correct', reason: '合う', better: '' })
  })

  it('verdict が違えば bad-response', () => {
    expect(thrownKind(() => parseJudge({ verdict: 'maybe', reason: 'x' }))).toBe('bad-response')
    expect(thrownKind(() => parseJudge({ reason: 'x' }))).toBe('bad-response')
  })

  it('reason が無ければ bad-response', () => {
    expect(thrownKind(() => parseJudge({ verdict: 'wrong' }))).toBe('bad-response')
    expect(thrownKind(() => parseJudge({ verdict: 'wrong', reason: 3 }))).toBe('bad-response')
  })

  it('オブジェクトでなければ bad-response', () => {
    expect(thrownKind(() => parseJudge(null))).toBe('bad-response')
    expect(thrownKind(() => parseJudge('correct'))).toBe('bad-response')
    expect(thrownKind(() => parseJudge([]))).toBe('bad-response')
  })
})

describe('登録の補助の指示（仕様書 8-1 の文のまま）', () => {
  it('FILL_SYSTEM', () => {
    expect(FILL_SYSTEM).toBe(
      [
        'あなたは英語学習者向けの単語カードを作る編集者です。学習者は英語初心者の日本人で、オンラインゲームのチャットや若者の日常会話（スラングを含む）で出会った英語を覚えたい。',
        '決まり:',
        '- meaning: 出会った英文があれば、その文脈での意味。学習者が意味を入れていれば、それを軸にする。',
        '- kind: 1〜3 語の単語・熟語なら word、文・あいさつ・決まり文句なら phrase。',
        '- accepted: 正解にしてよい日本語訳を 2〜6 個。meaning を必ず含め、漢字とかなの書き分け（例: 諦める・あきらめる）も入れる。',
        '- near_miss: 紛らわしいが不正解にすべき訳を 0〜3 個。',
        '- accepted_en: 日→英で正解にしてよい英語を 1〜4 個。英語そのものを含め、崩した言い方（wanna など）や同じ意味の別の言い方を入れる。ハイフンでつなぐ英語（pay-to-win など）は、空白で区切った形（pay to win）も入れる。',
        '- tone: 口調と使う場面（30 字以内）。特に無ければ空文字。',
        '- example_en: 短い例文（10 語以内）。example_ja: その訳。',
        '- note: スラングか、くだけた言い方か、など（30 字以内）。無ければ空文字。',
        '- cloze と cloze_answer: kind が word のときだけ作る。出会った英文（無ければ example_en）の中で英語に当たる語を、1 語につき ___ 1 つに置き換えた文を cloze に、置き換えた語を文の中の語形のまま cloze_answer に入れる（例: gave up）。kind が phrase なら両方空文字。英語に当たる語が文の中に 2 回以上あるときも両方空文字。',
        '- 褒め言葉や前置きは書かない。',
      ].join('\n'),
    )
  })
})

describe('fillPrompt（仕様書 8-1 の内容の行）', () => {
  it('全部の行', () => {
    const p = fillPrompt({ term: 'nerf', context: 'they nerfed the sniper', meaning: '弱くする' })
    expect(p.system).toBe(FILL_SYSTEM)
    expect(p.schema).toBe(FILL_SCHEMA)
    expect(p.user).toBe(['英語: nerf', '出会った英文: they nerfed the sniper', '学習者が入れた意味: 弱くする'].join('\n'))
  })

  it('値が空の項目は行ごと省く', () => {
    expect(fillPrompt({ term: 'nerf' }).user).toBe('英語: nerf')
    expect(fillPrompt({ term: 'nerf', context: '', meaning: ' ' }).user).toBe('英語: nerf')
  })
})

describe('FILL_SCHEMA（仕様書 8-1: 全部を必須）', () => {
  it('11 の項目がすべて必須で、配列の数の決まりがある', () => {
    const s = FILL_SCHEMA as { type: string; properties: Record<string, Record<string, unknown>>; required: string[] }
    const keys = [
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
    ]
    expect(s.type).toBe('object')
    expect(Object.keys(s.properties)).toEqual(keys)
    expect(s.required).toEqual(keys)
    expect(s.properties.kind).toEqual({ type: 'string', enum: ['word', 'phrase'] })
    expect(s.properties.accepted).toEqual({ type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 6 })
    expect(s.properties.near_miss).toEqual({ type: 'array', items: { type: 'string' }, maxItems: 3 })
    expect(s.properties.accepted_en).toEqual({ type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 4 })
  })
})

describe('parseFill（snake_case の返事を読む）', () => {
  const raw = {
    kind: 'word',
    meaning: '弱くする',
    tone: '',
    accepted: ['弱くする', '弱体化する', ' '],
    near_miss: ['強くする'],
    accepted_en: ['nerf', 'weaken'],
    example_en: 'They nerfed my main.',
    example_ja: 'メインのキャラが弱体化された。',
    note: 'ゲームの言葉',
    cloze: 'they ___ the sniper',
    cloze_answer: 'nerfed',
  }

  it('項目を camelCase にし、前後の空白と空の要素を除く', () => {
    expect(parseFill(raw)).toEqual({
      kind: 'word',
      meaning: '弱くする',
      tone: '',
      accepted: ['弱くする', '弱体化する'],
      nearMiss: ['強くする'],
      acceptedEn: ['nerf', 'weaken'],
      exampleEn: 'They nerfed my main.',
      exampleJa: 'メインのキャラが弱体化された。',
      note: 'ゲームの言葉',
      cloze: 'they ___ the sniper',
      clozeAnswer: 'nerfed',
    })
  })

  it('形式が違えば bad-response', () => {
    expect(thrownKind(() => parseFill({ ...raw, kind: 'noun' }))).toBe('bad-response')
    expect(thrownKind(() => parseFill({ ...raw, meaning: '' }))).toBe('bad-response')
    expect(thrownKind(() => parseFill({ ...raw, accepted: '弱くする' }))).toBe('bad-response')
    expect(thrownKind(() => parseFill({ ...raw, near_miss: undefined }))).toBe('bad-response')
    expect(thrownKind(() => parseFill({ ...raw, cloze_answer: 1 }))).toBe('bad-response')
    expect(thrownKind(() => parseFill(null))).toBe('bad-response')
  })
})
