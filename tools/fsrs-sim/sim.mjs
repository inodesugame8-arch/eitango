// 英単語アプリの 1 日の問題数の試算（ts-fsrs で再現。仕様書 6-8 の表の元）
// 使い方: npm run sim -- --seeds 3（種の数。既定 3）[--variants 0,1（既定 すべて）] [--json]
// ts-fsrs は、このプロジェクトの node_modules のもの（package.json で版を固定）を使う
import { createEmptyCard, dateDiffInDays, FSRSVersion, fsrs, Rating, State } from 'ts-fsrs'

const TS_VERSION = FSRSVersion // 例: v5.4.2 using FSRS-6.0（package.json は exports に無いので読めない）

// ---- 乱数（種を固定した自前の乱数。ts-fsrs の fuzz は ts-fsrs 自身の仕組みに任せる）----
function mulberry32(a) {
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const t = arr[i]
    arr[i] = arr[j]
    arr[j] = t
  }
  return arr
}

// ---- 時刻 ----
const DAY = 86400000
const JST = 9 * 3600000 // 日本時間 = UTC+9
const CUTOFF = 4 * 3600000 // 1 日の区切り = 朝 4 時
// アプリの「日」: 日本時間の朝 4 時で区切った日番号
const appDay = (ms) => Math.floor((ms + JST - CUTOFF) / DAY)
// 毎日 21:00（日本時間）に学習を始める = 12:00 UTC
const START = Date.UTC(2026, 9, 19, 12, 0, 0)
const DAY0 = appDay(START)
const SEC_PER_Q = 20

function simulate(opt) {
  const {
    newPerDay,
    both, // true: 英→日と日→英の 2 枚 / false: 英→日のみ
    retention = 0.9,
    threshold = 80, // その日の復習（開始時の期限到来カード数）がこれ以上なら新しい語を足さない
    seed = 1,
    days = 90,
    rMode = 'calendar', // 'calendar': スケジューラが内部で使うのと同じ日数（UTC の暦日差）で R / 'api': get_retrievability()
    firstP = 0.7,
    hardShare = 0.15,
    // 以下は下調べとの違いの原因を探るための切り替え（main では既定値）
    jeTiming = 'nextDay', // 'nextDay': 日→英は英→日を初めて解いた翌日から / 'sameDay': 登録日に 2 枚とも出す
    sibling = true, // 同じ語の 2 枚を同じ日に出さない
    learningP = 'R', // 'R': 2 回目以降は想起確率 / 'firstP': Learning 中（初日の学習ステップ）も firstP
    hardReshow = false, // true: 復習カードで △(Hard) のとき、その日のうちにもう 1 問出す（FSRS には渡さない＝評価は Hard のまま。問題数だけ足す）
  } = opt

  const f = fsrs({
    request_retention: retention,
    learning_steps: ['1m', '10m'],
    relearning_steps: ['10m'],
    enable_fuzz: true,
  })
  const rng = mulberry32(seed)

  const words = []
  let nextId = 0
  const makeWord = (d) => {
    const w = { id: nextId++, createdDay: d, ejFirstDay: null }
    w.ej = { word: w, dir: 'EJ', card: createEmptyCard(new Date(START + d * DAY)) }
    w.je = both ? { word: w, dir: 'JE', card: createEmptyCard(new Date(START + d * DAY)) } : null
    words.push(w)
    return w
  }

  const R = (c, nowMs) => {
    if (rMode === 'api') return f.get_retrievability(c, new Date(nowMs), false)
    const t = dateDiffInDays(c.last_review, new Date(nowMs))
    return f.forgetting_curve(t, c.stability)
  }

  const perDay = []
  const dueAtStart = []
  const newCardsPerDay = []
  const stats = {
    reviewAnswers: 0, // 開始時に Review 状態だったカードへの解答（日をまたいだ復習）
    reviewCorrect: 0,
    blockedDays: 0,
    siblingDeferred: 0,
    newEJ: 0,
    newJE: 0,
    maxQ: 0,
  }

  for (let d = 0; d < days; d++) {
    let now = START + d * DAY
    const today = DAY0 + d

    // 1) 期限が来たカード（日単位で判定。朝 4 時区切り）
    const dueEJ = []
    const dueJE = []
    const ejDueSet = new Set()
    for (const w of words) {
      const ej = w.ej.card
      if (ej.state !== State.New && appDay(ej.due.getTime()) <= today) {
        dueEJ.push(w.ej)
        ejDueSet.add(w.id)
      }
      if (w.je) {
        const je = w.je.card
        if (je.state !== State.New && appDay(je.due.getTime()) <= today) {
          if (sibling && ejDueSet.has(w.id)) stats.siblingDeferred++ // 同じ語の 2 枚は同じ日に出さない → 日→英を翌日へ
          else dueJE.push(w.je)
        }
      }
    }
    const reviewCount = dueEJ.length + dueJE.length

    // 2) 新しいカード（復習が threshold 未満のときだけ）
    const newEJ = []
    const newJE = []
    if (reviewCount < threshold) {
      if (both && jeTiming === 'nextDay') {
        // 日→英は、英→日を初めて解いた翌日から。英→日が今日出る語は除く（同じ日に出さない）
        const cands = words.filter(
          (w) =>
            w.je.card.state === State.New &&
            w.ejFirstDay !== null &&
            w.ejFirstDay < d &&
            !(sibling && ejDueSet.has(w.id)),
        )
        cands.sort((a, b) => a.ejFirstDay - b.ejFirstDay || a.id - b.id)
        for (const w of cands.slice(0, newPerDay)) newJE.push(w.je)
      }
      for (let i = 0; i < newPerDay; i++) {
        const w = makeWord(d)
        newEJ.push(w.ej)
        if (both && jeTiming === 'sameDay') newJE.push(w.je)
      }
    } else {
      stats.blockedDays++
    }
    stats.newEJ += newEJ.length
    stats.newJE += newJE.length

    // 3) 並び: 英→日をまとめて先に、日→英を後に。それぞれの中はシャッフル
    const queue = [...shuffle([...dueEJ, ...newEJ], rng), ...shuffle([...dueJE, ...newJE], rng)]
    const startedAsReview = new Set(queue.filter((it) => it.card.state === State.Review))

    // 4) 解く。学習ステップでその日のうちに期限が来たカードもその日の問題として数える
    let count = 0
    const learn = [] // {item, due}
    let qi = 0
    while (qi < queue.length || learn.length) {
      learn.sort((a, b) => a.due - b.due)
      let item
      if (learn.length && learn[0].due <= now) item = learn.shift().item
      else if (qi < queue.length) item = queue[qi++]
      else {
        const l = learn.shift()
        now = Math.max(now, l.due) // 他に出す問題が無ければ、学習ステップの時刻まで待つ
        item = l.item
      }
      const c = item.card
      const p =
        c.state === State.New || (learningP === 'firstP' && c.state === State.Learning) ? firstP : R(c, now)
      const correct = rng() < p
      const rating = correct ? (rng() < hardShare ? Rating.Hard : Rating.Good) : Rating.Again
      if (startedAsReview.has(item)) {
        stats.reviewAnswers++
        if (correct) stats.reviewCorrect++
        startedAsReview.delete(item) // その日の最初の 1 回だけ数える
      }
      const res = f.next(c, new Date(now), rating)
      item.card = res.card
      if (item.dir === 'EJ' && item.word.ejFirstDay === null) item.word.ejFirstDay = d
      count++
      now += SEC_PER_Q * 1000
      if (hardReshow && c.state === State.Review && rating === Rating.Hard) {
        count++ // △ の再出題（練習のみ。時間も 20 秒足す）
        now += SEC_PER_Q * 1000
      }
      if (appDay(res.card.due.getTime()) <= today) learn.push({ item, due: res.card.due.getTime() })
    }
    perDay.push(count)
    dueAtStart.push(reviewCount)
    newCardsPerDay.push(newEJ.length + newJE.length)
    stats.maxQ = Math.max(stats.maxQ, count)
  }
  return { perDay, dueAtStart, newCardsPerDay, stats, words: words.length }
}

const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length
const win = (arr, from, to) => arr.slice(from - 1, to) // 1 始まりの日番号

function runCondition(cond, seeds = [1, 2, 3]) {
  const runs = seeds.map((seed) => simulate({ ...cond, seed }))
  const avgPerDay = runs[0].perDay.map((_, i) => mean(runs.map((r) => r.perDay[i])))
  const w1 = mean(runs.map((r) => mean(win(r.perDay, 1, 7))))
  const w4 = mean(runs.map((r) => mean(win(r.perDay, 24, 30))))
  const w9 = mean(runs.map((r) => mean(win(r.perDay, 61, 90))))
  const agg = (k) => mean(runs.map((r) => r.stats[k]))
  return {
    cond,
    days1to7: w1,
    days24to30: w4,
    days61to90: w9,
    minutesPerDay61to90: (w9 * SEC_PER_Q) / 60,
    perSeed61to90: runs.map((r) => mean(win(r.perDay, 61, 90))),
    reviewRetention: agg('reviewCorrect') / agg('reviewAnswers'),
    blockedDays: agg('blockedDays'),
    siblingDeferred: agg('siblingDeferred'),
    newEJ: agg('newEJ'),
    newJE: agg('newJE'),
    maxQ: Math.max(...runs.map((r) => r.stats.maxQ)),
    dueAtStart61to90: mean(runs.map((r) => mean(win(r.dueAtStart, 61, 90)))),
    newCards61to90: mean(runs.map((r) => mean(win(r.newCardsPerDay, 61, 90)))),
    first10: avgPerDay.slice(0, 10).map((x) => +x.toFixed(1)),
    avgPerDay,
  }
}

const conditions = [
  { label: '3語 両方向 0.9', newPerDay: 3, both: true, retention: 0.9 },
  { label: '5語 両方向 0.9', newPerDay: 5, both: true, retention: 0.9 },
  { label: '7語 両方向 0.9', newPerDay: 7, both: true, retention: 0.9 },
  { label: '10語 英→日のみ 0.9', newPerDay: 10, both: false, retention: 0.9 },
  { label: '10語 両方向 0.9', newPerDay: 10, both: true, retention: 0.9 },
  { label: '5語 両方向 0.85', newPerDay: 5, both: true, retention: 0.85 },
]

const variants = [
  { name: 'main（80問ルールあり・R=暦日差）', extra: { threshold: 80, rMode: 'calendar' } },
  { name: '80問ルールなし（下調べの試算に合わせた感度分析）', extra: { threshold: Infinity, rMode: 'calendar' } },
  { name: '80問ルールあり・R=get_retrievability()（24時間単位の切り捨て）', extra: { threshold: 80, rMode: 'api' } },
  // ここから下は、下調べの 1〜7 日目が多い原因を探るための仮説の検証
  {
    name: '仮説A: ルールなし・2枚とも登録日に出す・兄弟の先送りなし',
    extra: { threshold: Infinity, jeTiming: 'sameDay', sibling: false },
  },
  { name: '仮説B: ルールなし・初日の学習ステップ中も正答率0.7', extra: { threshold: Infinity, learningP: 'firstP' } },
  {
    name: '仮説A+B',
    extra: { threshold: Infinity, jeTiming: 'sameDay', sibling: false, learningP: 'firstP' },
  },
  // 6章の「△の語は少し後にもう一度出す」を問題数に足した場合（main の条件＋△の再出題）
  { name: 'main＋△の再出題（復習カードの Hard を同じ日にもう 1 問）', extra: { threshold: 80, rMode: 'calendar', hardReshow: true } },
]

const research = {
  '3語 両方向 0.9': [24, 41, 57],
  '5語 両方向 0.9': [40, 68, 93],
  '7語 両方向 0.9': [53, 95, 129],
  '10語 英→日のみ 0.9': [40, 69, 94],
  '10語 両方向 0.9': [79, 143, 189],
  '5語 両方向 0.85': [null, null, 77],
}

// 引数: --seeds N（既定 3 = 種 1,2,3）、--variants 0,1（既定 すべて）
const argVal = (k) => {
  const i = process.argv.indexOf(k)
  return i >= 0 ? process.argv[i + 1] : null
}
const nSeeds = Number(argVal('--seeds') ?? 3)
const SEEDS = Array.from({ length: nSeeds }, (_, i) => i + 1)
const pick = argVal('--variants')
const chosen = pick ? pick.split(',').map(Number).map((i) => variants[i]) : variants

const out = { tsFsrsVersion: TS_VERSION, seeds: SEEDS, variants: [] }
for (const v of chosen) {
  const rows = conditions.map((c) => runCondition({ ...c, ...v.extra }, SEEDS))
  out.variants.push({ name: v.name, rows })
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(out, null, 1))
} else {
  console.log(`ts-fsrs ${TS_VERSION}`)
  for (const v of out.variants) {
    console.log(`\n## ${v.name}`)
    console.log('条件 | 1-7日 | 24-30日 | 61-90日 | 分/日(61-90) | 下調べ | 種ごとの61-90 | 復習の正答率 | 新語を止めた日 | 兄弟の先送り | 新規EJ/JE | 最大/日')
    for (const r of v.rows) {
      const rs = research[r.cond.label]
      console.log(
        [
          r.cond.label,
          r.days1to7.toFixed(1),
          r.days24to30.toFixed(1),
          r.days61to90.toFixed(1),
          r.minutesPerDay61to90.toFixed(1),
          rs.map((x) => (x == null ? '-' : x)).join('/'),
          r.perSeed61to90.map((x) => x.toFixed(1)).join(','),
          (r.reviewRetention * 100).toFixed(1) + '%',
          r.blockedDays.toFixed(1),
          r.siblingDeferred.toFixed(1),
          `${r.newEJ.toFixed(0)}/${r.newJE.toFixed(0)}`,
          r.maxQ,
          `開始時の期限カード(61-90) ${r.dueAtStart61to90.toFixed(1)}`,
          `新カード/日(61-90) ${r.newCards61to90.toFixed(1)}`,
        ].join(' | '),
      )
    }
    console.log('1〜10日目の問題数（3種の平均）')
    for (const r of v.rows) console.log(`  ${r.cond.label}: ${r.first10.join(', ')}`)
  }
}
