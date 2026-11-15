/** 编辑器版本快照：只存本机 localStorage，按文档 key 隔离。 */

export interface EditorSnapshot {
  id: string;
  at: number;
  content: string;
}

export interface DiffLine {
  type: "same" | "add" | "remove";
  text: string;
  oldLine?: number;
  newLine?: number;
}

const PREFIX = "rubbish-editor-snapshots:v1:";
export const MAX_SNAPSHOTS = 8;

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function keyFor(docKey: string): string {
  return `${PREFIX}${docKey}`;
}

export function loadEditorSnapshots(docKey: string): EditorSnapshot[] {
  const store = storage();
  if (!store) return [];
  try {
    const raw = store.getItem(keyFor(docKey));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is EditorSnapshot =>
          typeof item === "object" &&
          item !== null &&
          typeof (item as EditorSnapshot).id === "string" &&
          typeof (item as EditorSnapshot).at === "number" &&
          typeof (item as EditorSnapshot).content === "string",
      )
      .sort((a, b) => b.at - a.at)
      .slice(0, MAX_SNAPSHOTS);
  } catch {
    return [];
  }
}

function persist(docKey: string, snapshots: EditorSnapshot[]): void {
  const store = storage();
  if (!store) return;
  try {
    if (snapshots.length === 0) store.removeItem(keyFor(docKey));
    else
      store.setItem(
        keyFor(docKey),
        JSON.stringify(snapshots.slice(0, MAX_SNAPSHOTS)),
      );
  } catch {
    // 存储满或隐私模式：调用方决定是否提示，这里不抛出。
  }
}

export function saveEditorSnapshot(
  docKey: string,
  content: string,
): EditorSnapshot {
  if (!content.trim()) throw new Error("正文为空，没有可保存的版本");
  const existing = loadEditorSnapshots(docKey);
  const latest = existing[0];
  if (latest && latest.content === content) return latest;
  const snapshot: EditorSnapshot = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: Date.now(),
    content,
  };
  persist(docKey, [snapshot, ...existing].slice(0, MAX_SNAPSHOTS));
  return snapshot;
}

export function deleteEditorSnapshot(
  docKey: string,
  id: string,
): EditorSnapshot[] {
  const next = loadEditorSnapshots(docKey).filter((item) => item.id !== id);
  persist(docKey, next);
  return next;
}

function fallbackDiff(before: string[], after: string[]): DiffLine[] {
  let prefix = 0;
  while (
    prefix < before.length &&
    prefix < after.length &&
    before[prefix] === after[prefix]
  ) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  const rows: DiffLine[] = [];
  for (let i = 0; i < prefix; i += 1) {
    rows.push({
      type: "same",
      text: before[i],
      oldLine: i + 1,
      newLine: i + 1,
    });
  }
  for (let i = prefix; i < before.length - suffix; i += 1) {
    rows.push({ type: "remove", text: before[i], oldLine: i + 1 });
  }
  for (let i = prefix; i < after.length - suffix; i += 1) {
    rows.push({ type: "add", text: after[i], newLine: i + 1 });
  }
  for (let i = 0; i < suffix; i += 1) {
    const oldIndex = before.length - suffix + i;
    const newIndex = after.length - suffix + i;
    rows.push({
      type: "same",
      text: before[oldIndex],
      oldLine: oldIndex + 1,
      newLine: newIndex + 1,
    });
  }
  return rows;
}

/** 行级 LCS 对比；超大文本退化为“公共前后缀 + 中间全删全增”，避免卡死浏览器。 */
export function diffEditorLines(
  beforeText: string,
  afterText: string,
): DiffLine[] {
  const before = beforeText.split("\n");
  const after = afterText.split("\n");
  if (before.length * after.length > 4_000_000)
    return fallbackDiff(before, after);

  const rows = before.length + 1;
  const cols = after.length + 1;
  const dp: Uint32Array[] = Array.from(
    { length: rows },
    () => new Uint32Array(cols),
  );
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      dp[i][j] =
        before[i - 1] === after[j - 1]
          ? dp[i - 1][j - 1] + 1
          : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  const reversed: DiffLine[] = [];
  let i = before.length;
  let j = after.length;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && before[i - 1] === after[j - 1]) {
      reversed.push({
        type: "same",
        text: before[i - 1],
        oldLine: i,
        newLine: j,
      });
      i -= 1;
      j -= 1;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      reversed.push({ type: "add", text: after[j - 1], newLine: j });
      j -= 1;
    } else {
      reversed.push({ type: "remove", text: before[i - 1], oldLine: i });
      i -= 1;
    }
  }
  return reversed.reverse();
}
