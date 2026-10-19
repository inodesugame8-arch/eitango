// ハッシュと種つきの乱数（今日の並び・並べ替えヒントで、同じ日なら同じ結果にするため）

const encoder = new TextEncoder()

// 32 ビットの FNV-1a（UTF-8 のバイト列に対して計算し、符号なし整数で返す）
export function hashString(text: string): number {
  let h = 0x811c9dc5
  for (const byte of encoder.encode(text)) {
    h ^= byte
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

// 0 以上 1 未満を返す種つきの乱数（mulberry32）
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// hashString(salt + ':' + key) の小さい順。同じ値なら key の文字列順。元の配列は変えない
export function orderByHash<T>(items: readonly T[], key: (item: T) => string, salt: string): T[] {
  return items
    .map((item) => {
      const k = key(item)
      return { item, k, h: hashString(`${salt}:${k}`) }
    })
    .sort((x, y) => x.h - y.h || (x.k < y.k ? -1 : x.k > y.k ? 1 : 0))
    .map((entry) => entry.item)
}
