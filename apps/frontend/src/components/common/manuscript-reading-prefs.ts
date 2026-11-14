import { useState } from "react";

/** 阅读偏好：字号/行距/衬线，localStorage 持久化（跨篇生效）。 */
export interface ReadingPrefs {
  fontScale: number;
  lineHeight: number;
  serif: boolean;
}

const READING_PREFS_KEY = "rubbish.reading-prefs";

function loadReadingPrefs(): ReadingPrefs {
  try {
    const raw = localStorage.getItem(READING_PREFS_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<ReadingPrefs>;
      return {
        fontScale: Math.min(1.5, Math.max(0.85, p.fontScale ?? 1)),
        lineHeight: Math.min(2.4, Math.max(1.5, p.lineHeight ?? 1.95)),
        serif: p.serif ?? true,
      };
    }
  } catch {
    /* 忽略损坏数据 */
  }
  return { fontScale: 1, lineHeight: 1.95, serif: true };
}

export function useReadingPrefs() {
  const [prefs, setPrefs] = useState<ReadingPrefs>(loadReadingPrefs);
  const update = (patch: Partial<ReadingPrefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(READING_PREFS_KEY, JSON.stringify(next));
      } catch {
        /* 私密模式忽略 */
      }
      return next;
    });
  };
  return { prefs, update };
}
