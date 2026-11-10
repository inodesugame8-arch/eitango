import { describe, expect, it } from 'vitest'
import type { FillResult } from './gemini/prompts.ts'
import { meaningNotice, notesFrom, typoNotice, type AiNotes } from './notice.ts'

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
