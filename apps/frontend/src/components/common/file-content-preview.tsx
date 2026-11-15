import { useEffect, useState } from "react";
import { AlertCircle, Download, Loader2 } from "lucide-react";
import {
  detectFileViewer,
  parseDelimitedPreview,
  type DelimitedPreview,
  type FileViewerKind,
} from "@/lib/file-preview";
import { Button } from "@/components/ui/button";

export interface FileContentPreviewProps {
  blob: Blob;
  filename: string;
  contentType?: string | null;
}

const TEXT_LIMIT = 40_000;

function isCsvDelimiter(text: string): string {
  const head = text.split(/\r?\n/, 1)[0] ?? "";
  const tabs = (head.match(/\t/g) ?? []).length;
  const commas = (head.match(/,/g) ?? []).length;
  const semicolons = (head.match(/;/g) ?? []).length;
  if (tabs > commas && tabs >= semicolons) return "\t";
  if (semicolons > commas) return ";";
  return ",";
}

function TextPreview({ text }: { text: string }) {
  const clipped = text.length > TEXT_LIMIT;
  return (
    <div className="flex h-full min-h-0 flex-col">
      {clipped && (
        <p className="border-b px-3 py-2 text-xs text-muted-foreground">
          文件较大，仅显示前 {TEXT_LIMIT.toLocaleString()}{" "}
          个字符；完整内容请下载。
        </p>
      )}
      <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words bg-muted/20 p-4 text-xs leading-relaxed">
        {text.slice(0, TEXT_LIMIT)}
      </pre>
    </div>
  );
}

function CsvPreview({ text, delimiter }: { text: string; delimiter: string }) {
  const preview: DelimitedPreview = parseDelimitedPreview(text, delimiter);
  if (!preview.rows.length) {
    return <EmptyState message="CSV 没有可显示的数据行。" />;
  }
  const header = preview.rows[0];
  const body = preview.rows.slice(1);
  return (
    <div className="flex h-full min-h-0 flex-col">
      {(preview.truncated || preview.columns > 20) && (
        <p className="border-b px-3 py-2 text-xs text-muted-foreground">
          仅预览前 {body.length} 行、{Math.min(preview.columns, 20)}{" "}
          列；完整内容请下载。
        </p>
      )}
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="min-w-full border-collapse text-xs">
          <thead className="sticky top-0 bg-muted">
            <tr>
              {header.map((cell, index) => (
                <th
                  key={`h-${index}`}
                  className="border px-2 py-1 text-left font-medium"
                >
                  {cell || `列 ${index + 1}`}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {body.map((row, rowIndex) => (
              <tr
                key={`r-${rowIndex}`}
                className="odd:bg-background even:bg-muted/20"
              >
                {header.map((_, colIndex) => (
                  <td
                    key={`c-${rowIndex}-${colIndex}`}
                    className="max-w-[28rem] border px-2 py-1 align-top"
                  >
                    <span className="line-clamp-3 whitespace-pre-wrap break-words">
                      {row[colIndex] ?? ""}
                    </span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex h-full min-h-[14rem] flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
      <AlertCircle className="h-7 w-7 opacity-50" />
      {message}
    </div>
  );
}

export default function FileContentPreview({
  blob,
  filename,
  contentType,
}: FileContentPreviewProps) {
  const kind: FileViewerKind = detectFileViewer(filename, contentType);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setText(null);
    setError(null);
    let cancelled = false;
    let url: string | null = null;
    if (kind === "image" || kind === "pdf") {
      url = URL.createObjectURL(blob);
      setObjectUrl(url);
    } else {
      setObjectUrl(null);
    }
    if (kind === "csv" || kind === "text") {
      blob
        .text()
        .then((value) => {
          if (!cancelled) setText(value);
        })
        .catch(() => {
          if (!cancelled) setError("读取文件内容失败，请下载后查看。");
        });
    }
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [blob, kind]);

  if (error) return <EmptyState message={error} />;

  if (kind === "image") {
    return (
      <div className="flex h-full min-h-0 items-center justify-center overflow-auto bg-muted/20 p-3">
        {objectUrl ? (
          <img
            src={objectUrl}
            alt={filename}
            className="max-h-full max-w-full object-contain"
          />
        ) : (
          <Loader2 className="h-6 w-6 animate-spin" />
        )}
      </div>
    );
  }

  if (kind === "pdf") {
    return objectUrl ? (
      <iframe
        title={`预览 ${filename}`}
        src={objectUrl}
        className="h-full min-h-[24rem] w-full rounded-md border"
      />
    ) : (
      <EmptyState message="正在生成 PDF 预览…" />
    );
  }

  if (kind === "csv") {
    if (text === null) return <EmptyState message="正在读取表格…" />;
    return <CsvPreview text={text} delimiter={isCsvDelimiter(text)} />;
  }

  if (kind === "text") {
    if (text === null) return <EmptyState message="正在读取文本…" />;
    return <TextPreview text={text} />;
  }

  return (
    <EmptyState
      message={`${filename} 是 Word / Excel / ZIP / SVG 等格式，浏览器不能可靠内联预览。请下载后用本机应用打开，或让提交方补 PDF 版本。`}
    />
  );
}

/** 不支持内联预览时的下载按钮，放在 EmptyState 旁边使用。 */
export function FileDownloadHint({ filename }: { filename: string }) {
  return (
    <Button type="button" variant="outline" size="sm" disabled title={filename}>
      <Download className="h-4 w-4" />
      请从附件列表下载
    </Button>
  );
}
