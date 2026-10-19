// 答えの正規化（仕様書 7-1）。答えと許容訳の両方に同じ正規化をかけてから比べる

// 空白と、仕様書の記号: 。、，．,.!?！？「」『』（）()［］[]【】〜~…・'"’‘“”
const JA_SYMBOLS = /[\s。、，．,.!?！？「」『』（）()［］[\]【】〜~…・'"’‘“”]/gu

// カタカナ（ァ〜ヶ）をひらがなにする。長音の「ー」は範囲の外なので残る
function katakanaToHiragana(text: string): string {
  return text.replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60))
}

export function normalizeJa(text: string): string {
  return katakanaToHiragana(text.normalize('NFKC')).replace(JA_SYMBOLS, '')
}

// 崩した言い方
const SLANG: readonly (readonly [RegExp, string])[] = [
  [/\bwanna\b/g, 'want to'],
  [/\bgonna\b/g, 'going to'],
  [/\bgotta\b/g, 'got to'],
  [/\bgimme\b/g, 'give me'],
  [/\blemme\b/g, 'let me'],
  [/\bkinda\b/g, 'kind of'],
  [/\bsorta\b/g, 'sort of'],
  [/\bdunno\b/g, 'do not know'],
]

// 短縮形（'s は is・has・所有の区別ができないので展開しない）。上から順にかける
const CONTRACTIONS: readonly (readonly [RegExp, string])[] = [
  [/\bcan't\b/g, 'can not'],
  [/\bwon't\b/g, 'will not'],
  [/\bshan't\b/g, 'shall not'],
  [/\bcannot\b/g, 'can not'],
  [/n't\b/g, ' not'],
  [/'m\b/g, ' am'],
  [/'re\b/g, ' are'],
  [/'ve\b/g, ' have'],
  [/'ll\b/g, ' will'],
  [/'d\b/g, ' would'],
]

export function normalizeEn(text: string): string {
  let s = text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
  for (const [re, to] of SLANG) s = s.replace(re, to)
  for (const [re, to] of CONTRACTIONS) s = s.replace(re, to)
  return s
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}
