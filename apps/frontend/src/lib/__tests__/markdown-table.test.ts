import { describe, expect, it } from "vitest";
import {
  TableEditError,
  editMarkdownTable,
  findMarkdownTable,
  splitTableRow,
} from "@/lib/markdown-table";

const TABLE = [
  "| 项目 | 数值 |",
  "| --- | --- |",
  "| 甲 | 1 |",
  "| 乙 | 2 |",
].join("\n");
const cursorInRow = (text: string, needle: string, delta = 0) =>
  text.indexOf(needle) + delta;

describe("markdown table parsing", () => {
  it("splits rows with escaped pipes and finds the block", () => {
    expect(splitTableRow("| a | b \\| c |")).toEqual(["a", "b \\| c"]);
    const block = findMarkdownTable(
      `前言\n${TABLE}\n后记`,
      cursorInRow(TABLE, "甲"),
    );
    expect(block?.rows).toEqual([
      ["项目", "数值"],
      ["---", "---"],
      ["甲", "1"],
      ["乙", "2"],
    ]);
  });

  it("rejects a cursor outside a table", () => {
    expect(findMarkdownTable("普通段落\n没有表格", 2)).toBeNull();
  });
});

describe("markdown table edits", () => {
  const edit = (
    op: Parameters<typeof editMarkdownTable>[2],
    cursor = cursorInRow(TABLE, "甲"),
  ) => editMarkdownTable(TABLE, cursor, op).value;

  it("adds and deletes rows around the current data row", () => {
    expect(edit("rowBelow")).toContain("| 甲 | 1 |\n|  |  |\n| 乙 | 2 |");
    expect(edit("rowAbove")).toContain("|  |  |\n| 甲 | 1 |");
    expect(edit("deleteRow")).not.toContain("| 甲 | 1 |");
  });

  it("adds and deletes columns", () => {
    expect(edit("colRight")).toContain("| 项目 |  | 数值 |");
    expect(edit("colLeft")).toContain("|  | 项目 | 数值 |");
    expect(edit("deleteCol")).toContain("| 数值 |");
    expect(() =>
      editMarkdownTable("| a |\n| --- |\n| 1 |", 2, "deleteCol"),
    ).toThrow(TableEditError);
  });

  it("aligns one column or the whole table", () => {
    const right = edit("alignRight", cursorInRow(TABLE, "1", 0));
    expect(right).toContain("| --- | ---: |");
    const centerAll = edit("allCenter");
    expect(centerAll).toContain("| :---: | :---: |");
    const left = edit("allLeft");
    expect(left).toContain("| :--- | :--- |");
  });
});
