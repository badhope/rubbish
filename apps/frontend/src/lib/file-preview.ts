/** 文件查看器分流与轻量 CSV 预览。
 *
 * 不引入第三方解析库：只做浏览器内可确定的部分。
 * - 图片/PDF 用 object URL 直接渲染；
 * - CSV/TSV 解析前 100 行、20 列；
 * - 代码/纯文本用 <pre>，HTML 不当 HTML 渲染；
 * - Word/Excel/ZIP 明确走下载兜底，不假装能预览。
 */

export type FileViewerKind = "image" | "pdf" | "csv" | "text" | "unsupported";

const IMAGE_EXT = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "avif",
  "svg",
]);
const TEXT_EXT = new Set([
  "txt",
  "md",
  "markdown",
  "json",
  "yaml",
  "yml",
  "toml",
  "ini",
  "log",
  "py",
  "js",
  "jsx",
  "ts",
  "tsx",
  "css",
  "scss",
  "html",
  "htm",
  "xml",
  "sh",
  "bash",
  "sql",
  "java",
  "c",
  "h",
  "cpp",
  "go",
  "rs",
  "rb",
  "php",
]);
const CSV_EXT = new Set(["csv", "tsv"]);

function extension(filename: string): string {
  const name = filename.split(/[\\/]/).pop() ?? "";
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function detectFileViewer(
  filename: string,
  contentType?: string | null,
): FileViewerKind {
  const ext = extension(filename);
  const mime = (contentType ?? "").toLowerCase().split(";")[0].trim();
  if (IMAGE_EXT.has(ext) || mime.startsWith("image/")) return "image";
  if (ext === "pdf" || mime === "application/pdf") return "pdf";
  if (
    CSV_EXT.has(ext) ||
    mime.includes("csv") ||
    mime.includes("tab-separated-values")
  )
    return "csv";
  if (
    TEXT_EXT.has(ext) ||
    mime.startsWith("text/") ||
    mime === "application/json" ||
    mime === "application/xml"
  ) {
    return "text";
  }
  // docx/doc/xlsx/xls/zip 等二进制格式浏览器无法内联预览；fallback 必须给下载入口。
  return "unsupported";
}

export interface DelimitedPreview {
  rows: string[][];
  totalRows: number;
  truncated: boolean;
  columns: number;
}

/** 解析 CSV/TSV 文本；支持双引号包裹、换行与转义双引号。 */
export function parseDelimitedPreview(
  text: string,
  delimiter = ",",
  maxRows = 100,
  maxColumns = 20,
): DelimitedPreview {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let totalRows = 0;

  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    if (row.some((cell) => cell.trim() !== "")) {
      totalRows += 1;
      if (rows.length < maxRows) rows.push(row.slice(0, maxColumns));
    }
    row = [];
  };

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      pushField();
    } else if (ch === "\n") {
      if (field.endsWith("\r")) field = field.slice(0, -1);
      pushRow();
    } else {
      field += ch;
    }
  }
  if (field || row.length) pushRow();

  const columns = rows.reduce(
    (max, current) => Math.max(max, current.length),
    0,
  );
  return {
    rows,
    totalRows,
    truncated: totalRows > rows.length,
    columns,
  };
}
