import { describe, expect, it } from 'vitest'
import type { FillResult } from './gemini/prompts.ts'
import { candidateMeaning, meaningNotice, notesFrom, typoNotice, type AiNotes } from './notice.ts'

// recieve と打って「作る」を押したときの AI の返事
function fill(over: Partial<FillResult> = {}): FillResult {
  return {
    kind: 'word',
    meaning: '受け取る',
    tone: '',
    accepted: ['受け取る'],
    nearMiss: [],
    acceptedEn: ['receive'],
    exampleEn: 'I received it.',
    exampleJa: 'それを受け取った。',
    note: '',
    cloze: '',
    clozeAnswer: '',
    check: { suspect: true, suggestion: 'receive', reason: 'ie と ei が逆' },
    ...over,
  }
}

describe('notesFrom（知らせの材料。語のデータには入れない）', () => {
  it('送った英語と意味は前後の空白を除き、AI の meaning と点検の結果を写す', () => {
    expect(notesFrom({ term: ' recieve ', meaning: ' ' }, fill())).toEqual({
      term: 'recieve',
      meaning: '',
      aiMeaning: '受け取る',
      check: { suspect: true, suggestion: 'receive', reason: 'ie と ei が逆' },
    })
  })

  it('意味を送っていなければ空文字', () => {
    expect(notesFrom({ term: 'recieve' }, fill()).meaning).toBe('')
  })
})

describe('typoNotice（打ち間違いの知らせ。設計書 2026-11-10 の 5-1）', () => {
  const notes = (over: Partial<AiNotes> = {}): AiNotes => ({ ...notesFrom({ term: 'recieve' }, fill()), ...over })

  it('suspect で候補があり、英語の欄が点検した英語のままなら出す', () => {
    expect(typoNotice(notes(), 'recieve')).toEqual({ suggestion: 'receive', reason: 'ie と ei が逆' })
    expect(typoNotice(notes(), ' recieve ')).toEqual({ suggestion: 'receive', reason: 'ie と ei が逆' })
  })

  it('ok・候補が空・材料が無いときは出さない', () => {
    expect(typoNotice(notes({ check: { suspect: false, suggestion: 'receive', reason: '' } }), 'recieve')).toBeNull()
    expect(typoNotice(notes({ check: { suspect: true, suggestion: ' ', reason: 'x' } }), 'recieve')).toBeNull()
    expect(typoNotice(undefined, 'recieve')).toBeNull()
  })

  it('候補が点検した英語と同じ（崩した形・大文字を含む）なら出さない', () => {
    const wanna = notesFrom({ term: 'wanna' }, fill({ check: { suspect: true, suggestion: 'want to', reason: '' } }))
    expect(typoNotice(wanna, 'wanna')).toBeNull()
    const upper = notesFrom({ term: 'GG' }, fill({ check: { suspect: true, suggestion: 'gg', reason: '' } }))
    expect(typoNotice(upper, 'GG')).toBeNull()
  })

  it('英語の欄を書き換えたら出さない（点検したのは書き換える前の英語）', () => {
    expect(typoNotice(notes(), 'receive')).toBeNull()
    expect(typoNotice(notes(), 'recieved')).toBeNull()
  })

  it('候補が英語の形でない（日本語・説明つき）なら出さない（押して英語の欄に入れないため）', () => {
    expect(typoNotice(notes({ check: { suspect: true, suggestion: '受け取る', reason: '' } }), 'recieve')).toBeNull()
    expect(typoNotice(notes({ check: { suspect: true, suggestion: 'receive（受け取る）', reason: '' } }), 'recieve')).toBeNull()
  })

  it('ハイフンと空白の違いだけなら出さない（pay-to-win と pay to win）', () => {
    const pay = notesFrom({ term: 'pay to win' }, fill({ check: { suspect: true, suggestion: 'pay-to-win', reason: '' } }))
    expect(typoNotice(pay, 'pay to win')).toBeNull()
  })

  it('文の候補（アポストロフィ・句読点を含む英語）は出す', () => {
    const sentence = notesFrom(
      { term: 'I has been there' },
      fill({ check: { suspect: true, suggestion: "I've been there, right?", reason: '' } }),
    )
    expect(typoNotice(sentence, 'I has been there')).toEqual({ suggestion: "I've been there, right?", reason: '' })
  })
})

describe('candidateMeaning（「候補で作り直す」で送る意味。設計書 2026-11-10 の 5-1）', () => {
  // loose と打って（出会った英文: you're gonna loose lol）「作る」を押し、AI が「ゆるい」で作った
  const loose = notesFrom(
    { term: 'loose' },
    fill({ meaning: 'ゆるい', check: { suspect: true, suggestion: 'lose', reason: '' } }),
  )

  it('意味の欄が、学習者が入れていない AI の意味のままなら空文字（候補の英語の意味を AI に作り直させる）', () => {
    expect(candidateMeaning(loose, 'ゆるい')).toBe('')
    expect(candidateMeaning(loose, ' ゆるい ')).toBe('')
  })

  it('意味の欄を直していたら、欄のまま', () => {
    expect(candidateMeaning(loose, '負ける')).toBe('負ける')
  })

  it('学習者が意味を入れていたら、欄のまま', () => {
    const mine = notesFrom({ term: 'loose', meaning: '負ける' }, fill({ meaning: '負ける' }))
    expect(candidateMeaning(mine, '負ける')).toBe('負ける')
  })

  it('材料が無ければ、欄のまま', () => {
    expect(candidateMeaning(undefined, 'ゆるい')).toBe('ゆるい')
  })
})

describe('meaningNotice（AI が別の意味で作ったかもしれない知らせ。設計書 2026-11-10 の 4-2 の 3）', () => {
  const salty = (meaning: string, aiMeaning: string): AiNotes =>
    notesFrom(
      { term: 'salty', meaning },
      fill({ meaning: aiMeaning, check: { suspect: false, suggestion: '', reason: '' } }),
    )

  it('入れた意味と AI の meaning が重ならなければ、AI の meaning を返す', () => {
    expect(meaningNotice(salty('塩辛い', 'イライラした'))).toBe('イライラした')
  })

  it('重なれば（日本語の正規化をかけて、どちらかがもう片方を含めば）出さない', () => {
    expect(meaningNotice(salty('塩辛い', '塩辛い'))).toBe('')
    expect(meaningNotice(salty('塩辛い', '塩辛い・しょっぱい'))).toBe('')
    expect(meaningNotice(salty('塩辛い・しょっぱい', '塩辛い'))).toBe('')
    expect(meaningNotice(salty('イライラした', 'いらいらした'))).toBe('')
  })

  it('意味を入れていない・材料が無いときは出さない', () => {
    expect(meaningNotice(salty('', 'イライラした'))).toBe('')
    expect(meaningNotice(undefined)).toBe('')
  })
})
