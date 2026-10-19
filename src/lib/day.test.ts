import { describe, expect, it } from 'vitest'
import { dayDiff, dayOf, endOfDay, formatDateTime, startOfDay } from './day.ts'

// 端末の時計（テストでは Asia/Tokyo）での日時。月は 1 から数える
function at(y: number, mo: number, d: number, h = 0, mi = 0, s = 0, ms = 0): Date {
  return new Date(y, mo - 1, d, h, mi, s, ms)
}

describe('dayOf（アプリの日。朝 4 時で区切る）', () => {
  it('10 月 20 日の 3 時 59 分は 10 月 19 日', () => {
    expect(dayOf(at(2026, 10, 20, 3, 59))).toBe('2026-10-19')
  })

  it('10 月 20 日の 4 時 00 分は 10 月 20 日', () => {
    expect(dayOf(at(2026, 10, 20, 4, 0))).toBe('2026-10-20')
  })

  it('4 時の 1 ミリ秒前までは前の日', () => {
    expect(dayOf(at(2026, 10, 20, 3, 59, 59, 999))).toBe('2026-10-19')
  })

  it('年の変わり目: 1 月 1 日の 3 時は前の年の 12 月 31 日', () => {
    expect(dayOf(at(2027, 1, 1, 3, 0))).toBe('2026-12-31')
  })

  it('月と日は 2 桁にそろえる', () => {
    expect(dayOf(at(2026, 3, 5, 12, 0))).toBe('2026-03-05')
  })

  it('世界標準時の日付（toISOString）ではなく端末の時計の日付を使う', () => {
    // 世界標準時の 10/19 23:30 は日本時間の 10/20 8:30
    const t = new Date('2026-10-19T23:30:00Z')
    expect(t.toISOString().slice(0, 10)).toBe('2026-10-19')
    expect(dayOf(t)).toBe('2026-10-20')
  })
})

describe('startOfDay と endOfDay', () => {
  it('3 時 59 分のアプリの日は、前の日の 4 時に始まり、その日の 4 時に終わる', () => {
    const t = at(2026, 10, 20, 3, 59)
    expect(startOfDay(t).getTime()).toBe(at(2026, 10, 19, 4).getTime())
    expect(endOfDay(t).getTime()).toBe(at(2026, 10, 20, 4).getTime())
  })

  it('4 時 00 分ちょうどは、その時刻に始まり、次の日の 4 時に終わる', () => {
    const t = at(2026, 10, 20, 4, 0)
    expect(startOfDay(t).getTime()).toBe(t.getTime())
    expect(endOfDay(t).getTime()).toBe(at(2026, 10, 21, 4).getTime())
  })

  it('夜 23 時は、その日の 4 時に始まり、次の日の 4 時に終わる', () => {
    const t = at(2026, 10, 20, 23, 0)
    expect(startOfDay(t).getTime()).toBe(at(2026, 10, 20, 4).getTime())
    expect(endOfDay(t).getTime()).toBe(at(2026, 10, 21, 4).getTime())
  })

  it('月末の次の日の 4 時に終わる', () => {
    expect(endOfDay(at(2026, 10, 31, 12)).getTime()).toBe(at(2026, 11, 1, 4).getTime())
  })

  it('始まりと終わりのアプリの日', () => {
    const t = at(2026, 10, 20, 3, 59)
    expect(dayOf(startOfDay(t))).toBe('2026-10-19')
    expect(dayOf(endOfDay(t))).toBe('2026-10-20')
  })
})

describe('dayDiff（YYYY-MM-DD どうしの日数の差 to − from）', () => {
  it('同じ日は 0、次の日は 1、前の日は −1', () => {
    expect(dayDiff('2026-10-19', '2026-10-19')).toBe(0)
    expect(dayDiff('2026-10-19', '2026-10-20')).toBe(1)
    expect(dayDiff('2026-10-20', '2026-10-19')).toBe(-1)
  })

  it('月と年をまたぐ', () => {
    expect(dayDiff('2026-10-31', '2026-11-01')).toBe(1)
    expect(dayDiff('2026-12-31', '2027-01-01')).toBe(1)
    expect(dayDiff('2026-02-01', '2026-03-01')).toBe(28)
    expect(dayDiff('2028-02-01', '2028-03-01')).toBe(29)
  })

  it('7 日（書き出しの知らせの日数）', () => {
    expect(dayDiff('2026-10-13', '2026-10-20')).toBe(7)
  })

  it('形式が違えば Error を投げる', () => {
    expect(() => dayDiff('2026/10/19', '2026-10-20')).toThrow()
  })
})

describe('formatDateTime（設定の版の 1 行と、最後の書き出しの日時。端末の時計で出す）', () => {
  it('端末の時計の YYYY-MM-DD HH:mm（2 桁にそろえる）', () => {
    expect(formatDateTime(new Date(2026, 0, 5, 6, 7))).toBe('2026-01-05 06:07')
  })

  it('世界標準時の ISO 文字列（ビルドの日時）を、日本の時計の日時に直す', () => {
    // 世界標準時の 10 月 18 日 21 時 30 分は、日本では 10 月 19 日 6 時 30 分
    expect(formatDateTime(new Date('2026-10-18T21:30:00.000Z'))).toBe('2026-10-19 06:30')
  })
})
