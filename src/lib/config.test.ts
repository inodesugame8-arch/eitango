import { describe, expect, it } from 'vitest'
import { DAY_START_HOUR } from './config.ts'

describe('テストの前提', () => {
  it('時間帯が Asia/Tokyo に固定されている', () => {
    // 日本時間は世界標準時より 9 時間進んでいるので -540 分
    expect(new Date(2026, 0, 1).getTimezoneOffset()).toBe(-540)
  })

  it('DAY_START_HOUR が 4', () => {
    expect(DAY_START_HOUR).toBe(4)
  })
})
