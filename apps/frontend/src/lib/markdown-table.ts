/** Markdown 表格的纯文本操作：找表、插行/列、删行/列、列对齐。
 *
 * 只处理标准 GFM 管道表；不支持嵌套表（Markdown 本身也没有）。
 * 所有操作都返回新全文和表格起点，调用方负责恢复光标。
 */

export type TableOperation =
  | "rowAbove"
  | "rowBelow"
  | "deleteRow"
  | "colLeft"
  | "colRight"
  | "deleteCol"
  | "alignLeft"
  | "alignCenter"
  | "alignRight"
  | "allLeft"
  | "allCenter"
  | "allRight";

export class TableEditError extends Error {}

interface TableBlock {
  startLine: number;
  endLine: number;
  rows: string[][];
  rowIndex: number;
  cellIndex: number;
}

const COLUMN_SEPARATOR = /^:?-{3,}:?$/i;

function isTableLine(line: string): boolean {
  const text = line.trim();
  if (!text.startsWith("|") && !text.endsWith("|")) return false;
  return text.split("|").length >= 2;
}

/** 按未转义的 `|` 切分一行；`\|` 视作单元格内的字面竖线。 */
export function splitTableRow(line: string): string[] {
  let text = line.trim();
  if (text.startsWith("|")) text = text.slice(1);
  if (text.endsWith("|")) text = text.slice(0, -1);
  const cells: string[] = [];
  let current = "";
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === "\\" && text[i + 1] === "|") {
      current += "\\|";
      i += 1;
    } else if (char === "|") {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

function isSeparatorRow(row: string[]): boolean {
  return (
    row.length > 0 && row.every((cell) => COLUMN_SEPARATOR.test(cell.trim()))
  );
}

function serializeRow(cells: string[]): string {
  return `| ${cells.join(" | ")} |`;
}

function normalizeRows(rows: string[][]): { rows: string[][]; width: number } {
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
  return {
    rows: rows.map((row) => [...row, ...Array(width - row.length).fill("")]),
    width,
  };
}

function lineStartOffset(value: string, line: number): number {
  if (line === 0) return 0;
  const lines = value.split("\n");
  return lines.slice(0, line).join("\n").length + 1;
}

function cursorCellIndex(
  value: string,
  cursor: number,
): { rowIndex: number; cellIndex: number } {
  const before = value.slice(0, cursor);
  const lineIndex = before.split("\n").length - 1;
  const lineStart = before.lastIndexOf("\n") + 1;
  const currentLine = value.split("\n")[lineIndex] ?? "";
  const linePrefixLength = currentLine.length - currentLine.trimStart().length;
  const column = Math.max(0, cursor - lineStart - linePrefixLength);
  const trimmed = currentLine.trim();
  const prefix = trimmed.slice(0, column);
  const pipeCount = prefix.split("|").length - 1;
  const leading = trimmed.startsWith("|");
  return {
    rowIndex: lineIndex,
    cellIndex: Math.max(0, leading ? pipeCount - 1 : pipeCount),
  };
}

export function findMarkdownTable(
  value: string,
  cursor: number,
): TableBlock | null {
  const lines = value.split("\n");
  const { rowIndex: cursorLine } = cursorCellIndex(value, cursor);
  if (!isTableLine(lines[cursorLine] ?? "")) return null;

  let startLine = cursorLine;
  while (startLine > 0 && isTableLine(lines[startLine - 1] ?? ""))
    startLine -= 1;
  let endLine = cursorLine;
  while (endLine < lines.length - 1 && isTableLine(lines[endLine + 1] ?? ""))
    endLine += 1;

  const tableLines = lines.slice(startLine, endLine + 1);
  if (tableLines.length === 0) return null;
  const rows = normalizeRows(tableLines.map(splitTableRow));
  const { cellIndex } = cursorCellIndex(value, cursor);
  return {
    startLine,
    endLine,
    rows: rows.rows,
    rowIndex: cursorLine - startLine,
    cellIndex: Math.min(cellIndex, rows.width - 1),
  };
}

function ensureSeparator(rows: string[][]): {
  rows: string[][];
  inserted: boolean;
} {
  if (rows.length >= 2 && isSeparatorRow(rows[1]))
    return { rows, inserted: false };
  const width = rows[0].length;
  const withSeparator = rows
    .slice(0, 1)
    .concat([Array(width).fill("---")], rows.slice(1));
  return { rows: withSeparator, inserted: true };
}

function alignmentCell(alignment: string): string {
  if (alignment === "left") return ":---";
  if (alignment === "center") return ":---:";
  return "---:";
}

export function editMarkdownTable(
  value: string,
  cursor: number,
  operation: TableOperation,
): { value: string; selectionStart: number } {
  const table = findMarkdownTable(value, cursor);
  if (!table) throw new TableEditError("请先把光标放进 Markdown 表格");

  let rows = table.rows;
  let rowIndex = table.rowIndex;
  const cellIndex = table.cellIndex;

  if (
    operation === "rowAbove" ||
    operation === "rowBelow" ||
    operation === "deleteRow"
  ) {
    const ensured = ensureSeparator(rows);
    rows = ensured.rows;
    if (ensured.inserted && rowIndex >= 2) rowIndex += 1;
    const width = rows[0].length;

    if (operation === "deleteRow") {
      if (rowIndex < 2) throw new TableEditError("表头行和分隔行不能删除");
      rows.splice(rowIndex, 1);
    } else {
      const target =
        operation === "rowAbove"
          ? Math.max(2, rowIndex)
          : Math.max(2, rowIndex + 1);
      rows.splice(target, 0, Array(width).fill(""));
    }
  } else if (
    operation === "colLeft" ||
    operation === "colRight" ||
    operation === "deleteCol"
  ) {
    const ensured = ensureSeparator(rows);
    rows = ensured.rows;
    const width = rows[0].length;
    if (operation === "deleteCol") {
      if (width <= 1) throw new TableEditError("只剩一列，不能再删");
      rows = rows.map((row) => row.filter((_, index) => index !== cellIndex));
    } else {
      const target = operation === "colLeft" ? cellIndex : cellIndex + 1;
      rows = rows.map((row, index) => {
        const next = [...row];
        next.splice(target, 0, index === 1 ? "---" : "");
        return next;
      });
    }
  } else {
    const ensured = ensureSeparator(rows);
    rows = ensured.rows;
    const alignment =
      operation === "alignLeft" || operation === "allLeft"
        ? "left"
        : operation === "alignCenter" || operation === "allCenter"
          ? "center"
          : "right";
    const targets = operation.startsWith("all")
      ? rows[1].map((_, index) => index)
      : [cellIndex];
    rows[1] = rows[1].map((cell, index) =>
      targets.includes(index) ? alignmentCell(alignment) : cell,
    );
  }

  const normalized = normalizeRows(rows).rows;
  const before = value.slice(0, lineStartOffset(value, table.startLine));
  const after = value.slice(lineStartOffset(value, table.endLine + 1));
  const tableText = normalized.map(serializeRow).join("\n");
  return {
    value: `${before}${tableText}${after}`,
    selectionStart: before.length,
  };
}
