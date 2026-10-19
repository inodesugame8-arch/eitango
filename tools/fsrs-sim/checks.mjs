// ts-fsrs の挙動の確認 (a)〜(e)（仕様書 6-2・6-4・6-6・6-7 の検証の元）
// 使い方: node tools/fsrs-sim/checks.mjs
// ts-fsrs は、このプロジェクトの node_modules のもの（package.json で版を固定）を使う
import { createEmptyCard, FSRSVersion, fsrs, Rating, State } from 'ts-fsrs'

console.log('ts-fsrs', FSRSVersion)

const PARAMS = { request_retention: 0.9, learning_steps: ['1m', '10m'], relearning_steps: ['10m'], enable_fuzz: true }
const fOn = fsrs(PARAMS)
const fOff = fsrs({ ...PARAMS, enable_fuzz: false })

const MIN = 60000
const DAY = 86400000
const jst = (d) => new Date(d.getTime() + 9 * 3600000).toISOString().replace('T', ' ').slice(0, 16) + ' JST'
const rn = (r) => Rating[r]
const sn = (s) => State[s]
const brief = (c) =>
  `state=${sn(c.state)} step=${c.learning_steps} due=${jst(c.due)} S=${c.stability.toFixed(4)} D=${c.difficulty.toFixed(4)} sched=${c.scheduled_days} elapsed=${c.elapsed_days} reps=${c.reps} lapses=${c.lapses} last=${c.last_review ? jst(c.last_review) : '-'}`
const FIELDS = ['due', 'stability', 'difficulty', 'elapsed_days', 'scheduled_days', 'learning_steps', 'reps', 'lapses', 'state', 'last_review']
const val = (v) => (v instanceof Date ? v.getTime() : v === undefined ? 'undefined' : v)
function diffCards(a, b) {
  const out = []
  for (const k of FIELDS) if (val(a[k]) !== val(b[k])) out.push(`${k}: ${a[k] instanceof Date ? jst(a[k]) : a[k]} ≠ ${b[k] instanceof Date ? jst(b[k]) : b[k]}`)
  return out
}
const T0 = new Date(Date.UTC(2026, 9, 19, 12, 0, 0)) // 2026-10-19 21:00 JST

// ---------------- (a) 毎回 Good ----------------
console.log('\n=== (a) 新しいカードを毎回 Good（期限ちょうどに解く） ===')
function allGood(f, start, n = 7) {
  let card = createEmptyCard(start)
  let now = start
  const rows = []
  for (let i = 0; i < n; i++) {
    const r = f.next(card, now, Rating.Good)
    rows.push({
      at: jst(now),
      dayFromStart: ((now - start) / DAY).toFixed(3),
      state: sn(r.card.state),
      S: r.card.stability.toFixed(2),
      sched: r.card.scheduled_days,
      dueDayFromStart: ((r.card.due - start) / DAY).toFixed(2),
    })
    card = r.card
    now = r.card.due
  }
  return rows
}
console.log('-- fuzz なし')
console.table(allGood(fOff, T0))
console.log('-- fuzz あり（開始時刻を 1 分ずつずらした 5 本。fuzz の乱数は ts-fsrs 既定の種＝解いた時刻・reps・D×S）')
for (let k = 0; k < 5; k++) {
  const rows = allGood(fOn, new Date(T0.getTime() + k * MIN))
  console.log(`  開始+${k}分: 間隔 ${rows.map((r) => r.sched).join(' → ')} ／ 登録日からの日数 ${rows.map((r) => Math.round(r.dueDayFromStart)).join(', ')}`)
}

// 共通: Review 状態のカードを作る（Good, Good, 2日後 Good）
function makeReview(f) {
  let c = createEmptyCard(T0)
  let r = f.next(c, T0, Rating.Good) // → Learning step1
  r = f.next(r.card, new Date(T0.getTime() + 10 * MIN), Rating.Good) // → Review, 2日後
  r = f.next(r.card, r.card.due, Rating.Good) // 2日後に Good → Review
  return r.card
}

// ---------------- (b) 期限前の再挑戦 ----------------
console.log('\n=== (b) 期限前にもう一度解いて next を呼ぶ ===')
{
  const f = fOff // 比較しやすいよう fuzz なし（fuzz ありでも例外の有無は同じ）
  const rev = makeReview(f)
  const T = rev.due // 期限ちょうど
  console.log('復習カード（解く前）:', brief(rev))

  // b1: Again → 1 分後 Good
  const a = f.next(rev, T, Rating.Again)
  console.log('b1 Again 直後          :', brief(a.card))
  let b1
  try {
    b1 = f.next(a.card, new Date(T.getTime() + 1 * MIN), Rating.Good)
    console.log('b1 1分後(期限前)に Good:', brief(b1.card))
  } catch (e) {
    console.log('b1 例外:', e.name, e.message)
  }
  const b1ref = f.next(a.card, new Date(T.getTime() + 10 * MIN), Rating.Good)
  console.log('b1 参考: 10分後(期限どおり)に Good:', brief(b1ref.card))
  const goodOnly = f.next(rev, T, Rating.Good)
  console.log('b1 参考: 最初から Good だけ      :', brief(goodOnly.card))

  // b2: Hard → 1 分後 Good
  const h = f.next(rev, T, Rating.Hard)
  console.log('b2 Hard 直後           :', brief(h.card))
  try {
    const b2 = f.next(h.card, new Date(T.getTime() + 1 * MIN), Rating.Good)
    console.log('b2 1分後(期限前)に Good:', brief(b2.card))
    console.log('b2 1分後(期限前)に Hard:', brief(f.next(h.card, new Date(T.getTime() + 1 * MIN), Rating.Hard).card))
    console.log('b2 1分後(期限前)に Again:', brief(f.next(h.card, new Date(T.getTime() + 1 * MIN), Rating.Again).card))
  } catch (e) {
    console.log('b2 例外:', e.name, e.message)
  }

  // b3: 新しいカード Again → 1 分後 Good（ちょうど期限）、30 秒後 Good（期限前）
  const n0 = createEmptyCard(T0)
  const na = f.next(n0, T0, Rating.Again)
  console.log('b3 新カード Again 直後  :', brief(na.card))
  const n30 = f.next(na.card, new Date(T0.getTime() + 30000), Rating.Good)
  console.log('b3 30秒後(期限前)に Good:', brief(n30.card))
  const n60 = f.next(na.card, new Date(T0.getTime() + 60000), Rating.Good)
  console.log('b3 1分後(期限)に Good   :', brief(n60.card))
  const n60b = f.next(n60.card, new Date(T0.getTime() + 2 * MIN), Rating.Good)
  console.log('b3 さらに1分後(10分の期限前)に Good:', brief(n60b.card))

  // b4: 日本時間 9:00（UTC の日付の変わり目）をまたぐと「別の日」扱いになるか
  console.log('-- b4: Again と Good の間に日本時間 9:00 をはさむ場合（同じ 1.5 分の差）')
  const morning = makeReview(f)
  const evening = makeReview(f)
  const at = (base, h, m, s = 0) => new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), h, m, s))
  // morning: 8:59:00 JST = 23:59 UTC 前日、 9:00:30 JST = 00:00:30 UTC
  const dueDay = new Date(morning.due.getTime())
  const m1 = at(dueDay, 23, 59, 0)
  const m2 = new Date(m1.getTime() + 90000)
  const e1 = at(dueDay, 12, 0, 0)
  const e2 = new Date(e1.getTime() + 90000)
  const ma = f.next(morning, m1, Rating.Again)
  const mg = f.next(ma.card, m2, Rating.Good)
  const ea = f.next(evening, e1, Rating.Again)
  const eg = f.next(ea.card, e2, Rating.Good)
  console.log(`  ${jst(m1)} Again → ${jst(m2)} Good:`, brief(mg.card), ' log.elapsed_days=', mg.log.elapsed_days)
  console.log(`  ${jst(e1)} Again → ${jst(e2)} Good:`, brief(eg.card), ' log.elapsed_days=', eg.log.elapsed_days)

  // b5: now が last_review より前（日付が前）だと？
  try {
    const back = f.next(rev, new Date(rev.last_review.getTime() - DAY), Rating.Good)
    console.log('b5 last_review より 1 日前の now: 例外なし', brief(back.card))
  } catch (e) {
    console.log('b5 last_review より 1 日前の now:', e.name, e.message)
  }
}

// ---------------- (c) 評価を後から直す ----------------
console.log('\n=== (c) 直前の評価を取り消して付け直す ===')
{
  const f = fOn // fuzz ありで確認（種が同じになるか）
  const scenarios = []
  // 新カード
  scenarios.push({ name: '新カード', card: createEmptyCard(T0), now: T0 })
  // 学習中（step1）
  scenarios.push({ name: '学習中', card: f.next(createEmptyCard(T0), T0, Rating.Good).card, now: new Date(T0.getTime() + 10 * MIN) })
  // 復習
  const rev = makeReview(f)
  scenarios.push({ name: '復習', card: rev, now: rev.due })
  // 再学習
  const relearn = f.next(rev, rev.due, Rating.Again).card
  scenarios.push({ name: '再学習', card: relearn, now: new Date(rev.due.getTime() + 10 * MIN) })
  // 復習カードで 12 日遅れ
  scenarios.push({ name: '復習(12日遅れ)', card: rev, now: new Date(rev.due.getTime() + 12 * DAY) })

  const pairs = [
    [Rating.Hard, Rating.Good],
    [Rating.Again, Rating.Good],
    [Rating.Good, Rating.Again],
    [Rating.Easy, Rating.Hard],
  ]
  for (const s of scenarios) {
    const before = JSON.stringify(s.card)
    for (const [wrong, right] of pairs) {
      const r1 = f.next(s.card, s.now, wrong)
      const back = f.rollback(r1.card, r1.log)
      const redo = f.next(back, s.now, right)
      const direct = f.next(s.card, s.now, right)
      const dRedo = diffCards(redo.card, direct.card)
      const dBack = diffCards(back, s.card)
      // 評価前のカードを保存しておいてやり直す方法
      const fromSnapshot = f.next(s.card, s.now, right)
      const dSnap = diffCards(fromSnapshot.card, direct.card)
      // 時刻を 5 分ずらしてやり直した場合
      const late = f.next(back, new Date(s.now.getTime() + 5 * MIN), right)
      const dLate = diffCards(late.card, direct.card)
      console.log(
        `${s.name}: ${rn(wrong)}→取消→${rn(right)} | rollback→next と最初から ${rn(right)}: ${dRedo.length ? '不一致 ' + dRedo.join('; ') : '一致'} | 保存カードでやり直し: ${dSnap.length ? '不一致' : '一致'} | rollback 後のカードと元のカードの差: ${dBack.length ? dBack.join('; ') : 'なし'} | 5分後にやり直すと: ${dLate.length ? dLate.join('; ') : '一致'}`,
      )
    }
    if (JSON.stringify(s.card) !== before) console.log(`  ※ ${s.name}: next() が入力カードを書き換えた`)
  }
}

// ---------------- (d) JSON の往復 ----------------
console.log('\n=== (d) JSON.stringify → JSON.parse で戻したカード ===')
{
  const f = fOn
  const rev = makeReview(f)
  const now = new Date(rev.due.getTime() + 3 * DAY)
  const json = JSON.parse(JSON.stringify(rev))
  console.log('戻した型: due', typeof json.due, json.due, '/ last_review', typeof json.last_review)
  const fromJson = f.next(json, now, Rating.Good)
  const fromDate = f.next(rev, now, Rating.Good)
  console.log('next(JSONのカード) 例外なし。結果の due の型:', fromJson.card.due instanceof Date ? 'Date' : typeof fromJson.card.due)
  console.log('Date のカードと結果の差:', diffCards(fromJson.card, fromDate.card).join('; ') || 'なし')
  console.log('入力の JSON カードは書き換えられたか:', typeof json.due === 'string' ? 'いいえ（文字列のまま）' : 'はい')
  console.log('get_retrievability(JSON):', f.get_retrievability(json, now, false), ' Date:', f.get_retrievability(rev, now, false))
  const rep = f.repeat(json, now)
  console.log('repeat(JSON) の Good:', brief(rep[Rating.Good].card))
  // ログも JSON で戻して rollback
  const logJson = JSON.parse(JSON.stringify(fromDate.log))
  const cardJson2 = JSON.parse(JSON.stringify(fromDate.card))
  const back = f.rollback(cardJson2, logJson)
  console.log('rollback(JSON のカード, JSON のログ):', back.due instanceof Date ? '例外なし・due は Date' : typeof back.due, '/ 元との差:', diffCards(back, rev).join('; ') || 'なし')
  // 新カード（last_review が undefined → JSON で消える）
  const nj = JSON.parse(JSON.stringify(createEmptyCard(T0)))
  console.log('新カードの JSON のキー:', Object.keys(nj).join(','))
  console.log('next(新カードの JSON):', brief(f.next(nj, T0, Rating.Good).card))
  // last_review: null
  const nn = { ...nj, last_review: null }
  console.log('next(last_review:null):', brief(f.next(nn, T0, Rating.Good).card))
  // state が文字列
  const sj = { ...json, state: 'Review' }
  console.log('next(state:"Review"):', diffCards(f.next(sj, now, Rating.Good).card, fromDate.card).join('; ') || '一致')
  // アプリ側で文字列のまま比べると
  console.log('アプリ側の比較 json.due <= new Date():', json.due <= new Date(), '（文字列と Date の比較は常に false になる）')
  // IndexedDB と同じ structured clone なら Date のまま
  console.log('structuredClone で due は Date のまま:', structuredClone(rev).due instanceof Date)
  // 余計なキー（アプリ独自の id など）を持たせても動くか
  const extra = { ...json, id: 'w1-ej', wordId: 'w1', dir: 'EJ' }
  const ex = f.next(extra, now, Rating.Good)
  console.log('独自キー付き JSON で next: 例外なし。結果に独自キーが残るか:', 'id' in ex.card ? `残る（id=${ex.card.id}）` : '残らない')
}

// ---------------- (e) 日の区切り: ts-fsrs は UTC の日付で日数を数える ----------------
console.log('\n=== (e) 日の区切り（ts-fsrs 5.4.2 は UTC の暦日差 = 日本時間 9:00 で日が変わる） ===')
{
  const f = fOff
  const SHIFT = 5 * 3600000 // 日本時間(+9h) − 朝4時(4h) = +5h。t+5h の UTC の日付 = アプリの日（朝4時区切り）
  const sh = (d, s) => (d == null ? d : new Date(new Date(d).getTime() + s))
  const toF = (c) => ({ ...c, due: sh(c.due, SHIFT), last_review: sh(c.last_review, SHIFT) })
  const fromF = (c) => ({ ...c, due: sh(c.due, -SHIFT), last_review: sh(c.last_review, -SHIFT) })
  const nextShifted = (card, now, rating) => {
    const r = f.next(toF(card), sh(now, SHIFT), rating)
    return { card: fromF(r.card), log: r.log }
  }
  const base = makeReview(f) // S≈11 の復習カード
  const jstAt = (y, mo, d, h, mi) => new Date(Date.UTC(y, mo - 1, d, h - 9, mi)) // 日本時間で指定
  const cases = [
    ['夜23:00 → 翌朝7:00（アプリでは別の日）', jstAt(2026, 11, 1, 23, 0), jstAt(2026, 11, 2, 7, 0)],
    ['朝8:59 → 朝9:01（アプリでは同じ日）', jstAt(2026, 11, 2, 8, 59), jstAt(2026, 11, 2, 9, 1)],
    ['夜中3:59 → 朝4:01（アプリでは別の日）', jstAt(2026, 11, 2, 3, 59), jstAt(2026, 11, 2, 4, 1)],
  ]
  for (const [label, t1, t2] of cases) {
    const a1 = f.next(base, t1, Rating.Good)
    const a2 = f.next(a1.card, t2, Rating.Good)
    const b1 = nextShifted(base, t1, Rating.Good)
    const b2 = nextShifted(b1.card, t2, Rating.Good)
    console.log(
      `${label}: そのまま elapsed=${a2.log.elapsed_days} S ${a1.card.stability.toFixed(2)}→${a2.card.stability.toFixed(2)} 間隔${a2.card.scheduled_days}日 ／ +5h ずらし elapsed=${b2.log.elapsed_days} S ${b1.card.stability.toFixed(2)}→${b2.card.stability.toFixed(2)} 間隔${b2.card.scheduled_days}日`,
    )
  }
}
