import { beforeEach, describe, expect, it } from "vitest";
import {
  deleteEditorSnapshot,
  diffEditorLines,
  loadEditorSnapshots,
  saveEditorSnapshot,
} from "@/lib/editor-snapshots";

beforeEach(() => localStorage.clear());

describe("editor snapshots", () => {
  it("saves, dedupes and deletes snapshots per document key", () => {
    const first = saveEditorSnapshot("doc-a", "第一版");
    expect(loadEditorSnapshots("doc-a")).toHaveLength(1);
    expect(saveEditorSnapshot("doc-a", "第一版").id).toBe(first.id);
    const second = saveEditorSnapshot("doc-a", "第二版");
    expect(loadEditorSnapshots("doc-a").map((item) => item.id)).toEqual([
      second.id,
      first.id,
    ]);
    deleteEditorSnapshot("doc-a", first.id);
    expect(loadEditorSnapshots("doc-a")).toHaveLength(1);
    expect(loadEditorSnapshots("doc-b")).toEqual([]);
  });

  it("refuses an empty snapshot and caps history at eight", () => {
    expect(() => saveEditorSnapshot("doc", "   ")).toThrow("正文为空");
    for (let i = 0; i < 10; i += 1) saveEditorSnapshot("doc", `版本 ${i}`);
    expect(loadEditorSnapshots("doc")).toHaveLength(8);
  });
});

describe("line diff", () => {
  it("marks changed lines as removed and added", () => {
    const rows = diffEditorLines("标题\n旧正文\n结束", "标题\n新正文\n结束");
    expect(rows.map((row) => `${row.type}:${row.text}`)).toEqual([
      "same:标题",
      "remove:旧正文",
      "add:新正文",
      "same:结束",
    ]);
  });

  it("handles insertions and deletions", () => {
    const added = diffEditorLines("a\nb", "a\nx\nb");
    expect(added.filter((row) => row.type === "add")).toHaveLength(1);
    const removed = diffEditorLines("a\nx\nb", "a\nb");
    expect(removed.filter((row) => row.type === "remove")).toHaveLength(1);
  });
});
