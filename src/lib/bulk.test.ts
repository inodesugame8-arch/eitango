import { describe, expect, it } from 'vitest'
import { CLAUDE_PROMPT, guessKind, parseBulk, stripFences } from './bulk.ts'
import type { Word } from './types.ts'

const now = new Date(2026, 9, 20, 21, 0)

function ok(text: string, existing: readonly Word[] = []): { words: Word[]; skipped: number } {
  const r = parseBulk(text, existing, now)
  if (!r.ok) throw new Error(r.error)
  return r
}

function error(text: string, existing: readonly Word[] = []): string {
  const r = parseBulk(text, existing, now)
  if (r.ok) throw new Error('読めてしまった')
  return r.error
}

const full = {
  term: 'give up',
  kind: 'word',
  context: "don't give up, we can still win",
  source: 'ゲーム',
  meaning: '諦める',
  tone: '',
  accepted: ['あきらめる', '断念する'],
  near_miss: ['負ける'],
  accepted_en: ['give up', 'quit'],
  example_en: 'Never give up.',
  example_ja: '決して諦めるな。',
  note: '',
  cloze: "don't ___ ___, we can still win",
  cloze_answer: 'give up',
}

describe('stripFences', () => {
  it('```json の囲みを外す', () => {
    expect(stripFences('```json\n[{"term":"a"}]\n```')).toBe('[{"term":"a"}]')
  })

  it('言語名の無い囲み・前後の文も外す', () => {
    expect(stripFences('```\n[1]\n```')).toBe('[1]')
    expect(stripFences('こちらです。\n```json\n[1, 2]\n```\n以上です。')).toBe('[1, 2]')
  })

  it('囲みが無ければ前後の空白だけ外す', () => {
    expect(stripFences('  [1]\n')).toBe('[1]')
  })
})

describe('guessKind（3 語以上か、? か ! で終わればフレーズ。仕様書 8-2）', () => {
  it('1〜2 語は単語・熟語', () => {
    expect(guessKind('nerf')).toBe('word')
    expect(guessKind('give up')).toBe('word')
    expect(guessKind('  my   bad ')).toBe('word')
  })

  it('3 語以上はフレーズ', () => {
    expect(guessKind('throw in the towel')).toBe('phrase')
    expect(guessKind('no cap bro')).toBe('phrase')
  })

  it('? か ! で終わればフレーズ', () => {
    expect(guessKind('Do you even wanna win?')).toBe('phrase')
    expect(guessKind('gg!')).toBe('phrase')
    expect(guessKind('wait? ')).toBe('phrase')
  })
})

describe('parseBulk（仕様書 8-3）', () => {
  it('全部の項目がある語は、AI で補ったものとして読む（snake_case を読み、許容訳に意味を足す）', () => {
    const { words, skipped } = ok(JSON.stringify([full]))
    expect(skipped).toBe(0)
    expect(words).toHaveLength(1)
    const w = words[0]
    expect(w).toEqual({
      id: w.id,
      term: 'give up',
      kind: 'word',
      context: "don't give up, we can still win",
      source: 'ゲーム',
      meaning: '諦める',
      accepted: ['あきらめる', '断念する', '諦める'],
      nearMiss: ['負ける'],
      acceptedEn: ['give up', 'quit'],
      exampleEn: 'Never give up.',
      exampleJa: '決して諦めるな。',
      cloze: "don't ___ ___, we can still win",
      clozeAnswer: 'give up',
      needsAi: false,
      createdAt: now,
      updatedAt: now,
    })
    expect(w.id).not.toBe('')
    // 空文字の任意の項目は入れない
    expect('tone' in w).toBe(false)
    expect('note' in w).toBe(false)
  })

  it('accepted が無い語は、8-2 と同じ初めの値で埋め、AI で補う前の印を付ける', () => {
    const { words } = ok(JSON.stringify([{ term: 'nerf', meaning: '弱くする' }]))
    expect(words[0]).toMatchObject({
      term: 'nerf',
      kind: 'word',
      meaning: '弱くする',
      accepted: ['弱くする'],
      nearMiss: [],
      acceptedEn: ['nerf'],
      needsAi: true,
    })
    expect(ok(JSON.stringify([{ term: 'nerf', meaning: '弱くする', accepted: [] }])).words[0].needsAi).toBe(true)
  })

  it('kind が無ければ guessKind で決める', () => {
    const { words } = ok(JSON.stringify([{ term: 'Do you even wanna win?', meaning: '本気で勝つ気あんの' }]))
    expect(words[0].kind).toBe('phrase')
  })

  it('cloze が無い単語・熟語は、出会った英文から 7-5 の決まりで穴埋めを作る', () => {
    const { words } = ok(
      JSON.stringify([
        { term: 'give up', meaning: '諦める', context: "Don't GIVE UP now" },
        { term: 'nerf', meaning: '弱くする', context: 'they nerfed the sniper' },
        { term: 'no cap', meaning: 'マジで', kind: 'phrase', context: 'no cap that was insane' },
      ]),
    )
    expect(words[0]).toMatchObject({ cloze: "Don't ___ ___ now", clozeAnswer: 'GIVE UP' })
    expect('cloze' in words[1]).toBe(false)
    expect('cloze' in words[2]).toBe(false)
  })

  it('フレーズの穴埋めは読まない（日→英のフレーズは全文で答えるため）', () => {
    const { words } = ok(
      JSON.stringify([{ ...full, term: 'my bad', kind: 'phrase', cloze: '___ ___, I missed', cloze_answer: 'my bad' }]),
    )
    expect('cloze' in words[0]).toBe(false)
    expect('clozeAnswer' in words[0]).toBe(false)
  })

  it('```json の囲みが付いていても読む', () => {
    expect(ok('```json\n' + JSON.stringify([full]) + '\n```').words).toHaveLength(1)
  })

  it('既にある語と、配列の中で先に出た語を読み飛ばし、数を返す（英語は normalizeEn、意味は normalizeJa で比べる）', () => {
    const existing: Word[] = [
      {
        id: 'e1',
        term: 'Give up',
        kind: 'word',
        meaning: 'アキラメル',
        accepted: ['アキラメル'],
        nearMiss: [],
        acceptedEn: ['Give up'],
        needsAi: false,
        createdAt: now,
        updatedAt: now,
      },
    ]
    const { words, skipped } = ok(
      JSON.stringify([
        { term: 'give up!', meaning: 'あきらめる。' }, // 既にある
        { term: 'give up', meaning: 'やめる' }, // 意味が違うので読む
        { term: 'nerf', meaning: '弱くする' },
        { term: 'Nerf', meaning: '弱くする' }, // 配列の中で先に出た
      ]),
      existing,
    )
    expect(words.map((w) => [w.term, w.meaning])).toEqual([
      ['give up', 'やめる'],
      ['nerf', '弱くする'],
    ])
    expect(skipped).toBe(2)
  })

  it('読み込んだ語は、貼った順に登録の日時が 1 ミリ秒ずつ新しくなる（最後の語が now。飛ばした語は数えない）', () => {
    const existing: Word[] = [
      {
        id: 'e1',
        term: 'nerf',
        kind: 'word',
        meaning: '弱くする',
        accepted: ['弱くする'],
        nearMiss: [],
        acceptedEn: ['nerf'],
        needsAi: true,
        createdAt: new Date(2026, 9, 1),
        updatedAt: new Date(2026, 9, 1),
      },
    ]
    const { words, skipped } = ok(
      JSON.stringify([
        { term: 'carry', meaning: 'チームを勝たせる' },
        { term: 'nerf', meaning: '弱くする' }, // 既にあるので飛ばす
        { term: 'clutch', meaning: 'ここ一番で決める' },
        { term: 'throw', meaning: 'わざと負ける' },
      ]),
      existing,
    )
    expect(skipped).toBe(1)
    expect(words.map((w) => w.term)).toEqual(['carry', 'clutch', 'throw'])
    const t = now.getTime()
    expect(words.map((w) => w.createdAt.getTime())).toEqual([t - 2, t - 1, t])
    expect(words.map((w) => w.updatedAt.getTime())).toEqual([t - 2, t - 1, t])
    // 登録の古い順に並べると、貼った順になる（新しい問題は登録の古い順に出す）
    const sorted = [...words].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    expect(sorted.map((w) => w.term)).toEqual(['carry', 'clutch', 'throw'])
  })

  it('id は語ごとに違う', () => {
    const { words } = ok(JSON.stringify([{ term: 'a', meaning: 'あ' }, { term: 'b', meaning: 'い' }]))
    expect(words[0].id).not.toBe(words[1].id)
  })

  it('形式が違えば、何番目のどの項目かを返す', () => {
    expect(error('[{ term: ')).toBe('JSON として読めませんでした')
    expect(error('{"term":"a","meaning":"あ"}')).toBe('JSON の配列ではありません（[ ] で囲んだ一覧にしてください）')
    expect(error('[1]')).toBe('1 番目が { } のオブジェクトではありません')
    expect(error(JSON.stringify([full, { meaning: 'あ' }]))).toBe('2 番目の term が空か、文字列ではありません')
    expect(error(JSON.stringify([{ term: 'a', meaning: '  ' }]))).toBe('1 番目の meaning が空か、文字列ではありません')
    expect(error(JSON.stringify([{ ...full, kind: 'noun' }]))).toBe('1 番目の kind が違います（word か phrase）')
    expect(error(JSON.stringify([{ ...full, accepted: '諦める' }]))).toBe('1 番目の accepted が文字列の配列ではありません')
    expect(error(JSON.stringify([{ ...full, context: 3 }]))).toBe('1 番目の context が文字列ではありません')
    expect(error(JSON.stringify([{ ...full, cloze_answer: '' }]))).toBe(
      '1 番目の cloze と cloze_answer は、両方入れるか両方空にしてください',
    )
  })

  it('1 つでも形式に合わない要素があれば、何も読み込まない', () => {
    const r = parseBulk(JSON.stringify([full, { term: 'nerf', meaning: '弱くする' }, { term: 'x' }]), [], now)
    expect(r).toEqual({ ok: false, error: '3 番目の meaning が空か、文字列ではありません' })
  })

  it('null の任意の項目は無いものとして読む', () => {
    const { words } = ok(JSON.stringify([{ ...full, tone: null, near_miss: null }]))
    expect('tone' in words[0]).toBe(false)
    expect(words[0].nearMiss).toEqual([])
  })
})

describe('CLAUDE_PROMPT', () => {
  it('JSON のスキーマの項目名がすべて入っている', () => {
    const keys = [
      'term',
      'kind',
      'context',
      'source',
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
    for (const key of keys) expect(CLAUDE_PROMPT).toContain(key)
  })

  it('頼み方の中の例は、そのまま parseBulk で読める', () => {
    const example = CLAUDE_PROMPT.split('\n').find((line) => line.startsWith('[{'))
    expect(example).toBeDefined()
    const { words } = ok(example ?? '')
    expect(words[0]).toMatchObject({ term: 'give up', needsAi: false, clozeAnswer: 'give up' })
  })
})
