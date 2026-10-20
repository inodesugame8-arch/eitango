// 手で作る穴埋めと並べ替えヒント（仕様書 7-5）
import { hashString, mulberry32 } from './random.ts'

function splitWords(text: string): string[] {
  return text
    .trim()
    .split(/\s+/)
    .filter((w) => w !== '')
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// 英語を出会った英文の中で探し（大文字・小文字は区別しない、語の切れ目で一致、語と語の間の空白の数は問わない）、
// 見つかった所の語をどれも 1 つずつ ___ にした文と、最初に見つかった所の文字のままの答えを返す。見つからなければ null
export function makeCloze(term: string, sentence: string): { cloze: string; answer: string } | null {
  const words = splitWords(term)
  if (words.length === 0 || sentence === '') return null
  // アポストロフィの形（' と ‘ と ’）は区別しない（SNS から貼った英文は ’ になりやすいため）
  const body = words.map((w) => escapeRegExp(w).replace(/['‘’]/g, "['‘’]")).join('\\s+')
  // 語の切れ目: 前と後ろが文字・数字でない
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, 'iu')
  const m = re.exec(sentence)
  if (!m) return null
  // 同じ英語が 2 回以上あれば、どれも ___ にする（2 つ目が残ると答えが見えるため）
  const cloze = sentence.replace(new RegExp(re.source, 'giu'), (f) => f.replace(/\S+/g, '___'))
  return { cloze, answer: m[0] }
}

// 並べ替えヒント。英語を空白で区切り（記号は語に付けたまま）、seedText（アプリの日 + カードの id）を種に混ぜる。
// 混ぜた結果が元の順と同じなら 1 つずらす（2 語なら必ず入れ替わる）。1 語ならそのまま返す
export function scrambleWords(text: string, seedText: string): string[] {
  const words = splitWords(text)
  if (words.length <= 1) return words
  const rand = mulberry32(hashString(seedText))
  const out = [...words]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    const tmp = out[i]
    out[i] = out[j]
    out[j] = tmp
  }
  if (out.every((w, i) => w === words[i])) out.push(out.shift() as string)
  return out
}
