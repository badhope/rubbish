/** 全站活跃等级阈值；与 backend app/domain/gamification/activity.py 保持一致。 */
export const ACTIVITY_BANDS = [
  { level: 1, floor: 0 },
  { level: 2, floor: 50 },
  { level: 3, floor: 150 },
  { level: 4, floor: 300 },
  { level: 5, floor: 500 },
  { level: 6, floor: 800 },
  { level: 7, floor: 1200 },
  { level: 8, floor: 1700 },
  { level: 9, floor: 2300 },
  { level: 10, floor: 3000 },
] as const

export function levelForXp(xp: number): number {
  let level = 1
  for (const band of ACTIVITY_BANDS) {
    if (xp >= band.floor) level = band.level
    else break
  }
  return level
}

export function nextBand(level: number) {
  return ACTIVITY_BANDS.find((band) => band.level === level + 1) ?? null
}
