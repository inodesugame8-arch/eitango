// id の生成。crypto.randomUUID は安全なページ（https）でだけ使えるので、
// LAN の http で確認するときのために、無いときの作り方も用意する（仕様書 4-4）
export function newId(): string {
  const c: Crypto | undefined = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  // Date.now() の 16 進（12 文字）と Math.random() の 16 進（20 文字）で 32 文字
  let id = Date.now().toString(16).padStart(12, '0').slice(-12)
  while (id.length < 32) id += Math.floor(Math.random() * 16).toString(16)
  return id
}
