import { useRef, useState } from "react";
import { Download, Eye, Loader2, Paperclip, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { downloadBlob, extractError } from "@/lib/utils";
import { useUploadReviewAttachment } from "@/hooks/api/use-modules";
import type { ReviewAttachment } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import FileContentPreview from "@/components/common/file-content-preview";

const ACCEPT = ".pdf,.docx,.doc,.md,.txt,.zip,.png,.jpg,.jpeg,.xlsx,.csv";

/** 提交互评意见前：先选好要一起交的批注件/补充材料。 */
export function ReviewAttachmentPicker({
  files,
  onChange,
  disabled,
}: {
  files: File[];
  onChange: (files: File[]) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  const addFiles = (list: FileList | null) => {
    if (!list?.length) return;
    const incoming = Array.from(list);
    const tooBig = incoming.find((f) => f.size > 50 * 1024 * 1024);
    if (tooBig) {
      toast.error(`${tooBig.name} 超过 50 MB，未加入`);
      return;
    }
    const next = [...files];
    for (const file of incoming) {
      if (!next.some((f) => f.name === file.name && f.size === file.size))
        next.push(file);
    }
    onChange(next.slice(0, 5));
  };

  return (
    <div className="space-y-2 rounded-lg border border-dashed p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <Label className="flex items-center gap-1.5">
            <Paperclip className="h-4 w-4" />
            互评附件（可选）
          </Label>
          <p className="mt-0.5 text-xs text-muted-foreground">
            带批注的 PDF / Word、补充数据、截图都可以。单个 ≤ 50 MB，最多 5 个。
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
        >
          <Paperclip className="h-4 w-4" />
          选择附件
        </Button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>
      {files.length > 0 && (
        <ul className="space-y-1">
          {files.map((file) => (
            <li
              key={`${file.name}-${file.size}`}
              className="flex items-center gap-2 rounded bg-muted/50 px-2 py-1 text-xs"
            >
              <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{file.name}</span>
              <span className="shrink-0 text-muted-foreground">
                {(file.size / 1024).toFixed(0)} KB
              </span>
              <button
                type="button"
                className="text-muted-foreground hover:text-destructive"
                onClick={() => onChange(files.filter((f) => f !== file))}
                aria-label={`移除 ${file.name}`}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** 已提交报告后展示附件，并支持补传——这是“批注完才发现没地方交”的兜底入口。 */
export function ReviewAttachmentLinks({
  reportId,
  attachments,
}: {
  reportId: number;
  attachments?: ReviewAttachment[];
}) {
  const [preview, setPreview] = useState<{
    blob: Blob;
    filename: string;
    contentType: string | null;
  } | null>(null);
  const [previewing, setPreviewing] = useState<number | null>(null);

  const openPreview = async (index: number, filename: string) => {
    setPreviewing(index);
    try {
      const response = await api.get<Blob>(
        `/review/reports/${reportId}/attachments/${index}`,
        {
          responseType: "blob",
          timeout: 120_000,
        },
      );
      setPreview({
        blob: response.data,
        filename,
        contentType:
          (response.headers["content-type"] as string | undefined) ?? null,
      });
    } catch (err) {
      toast.error(extractError(err, "附件预览失败"));
    } finally {
      setPreviewing(null);
    }
  };

  if (!attachments?.length) return null;
  return (
    <>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {attachments.map((item, index) => (
          <div
            key={`${item.path}-${index}`}
            className="inline-flex max-w-full items-center rounded border bg-background text-xs"
          >
            <button
              type="button"
              className="inline-flex min-w-0 items-center gap-1 px-2 py-1 text-primary hover:bg-muted"
              onClick={() => void openPreview(index, item.filename)}
              aria-label={`预览 ${item.filename}`}
            >
              {previewing === index ? (
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
              ) : (
                <Eye className="h-3.5 w-3.5 shrink-0" />
              )}
              <span className="truncate">{item.filename}</span>
            </button>
            <button
              type="button"
              className="border-l px-1.5 py-1 text-muted-foreground hover:bg-muted hover:text-primary"
              onClick={() =>
                void downloadAttachment(reportId, index, item.filename)
              }
              aria-label={`下载 ${item.filename}`}
            >
              <Download className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>

      <Dialog
        open={Boolean(preview)}
        onOpenChange={(open) => !open && setPreview(null)}
      >
        <DialogContent className="flex h-[86dvh] w-[min(96vw,72rem)] max-w-none flex-col gap-3 overflow-hidden">
          <DialogHeader>
            <DialogTitle className="truncate text-sm">
              附件预览 · {preview?.filename ?? ""}
            </DialogTitle>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-hidden">
            {preview ? (
              <FileContentPreview
                blob={preview.blob}
                filename={preview.filename}
                contentType={preview.contentType}
              />
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function ReviewAttachmentUploadButton({
  reportId,
  onUploaded,
}: {
  reportId: number;
  onUploaded?: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const uploadMut = useUploadReviewAttachment();
  const [busy, setBusy] = useState(false);

  const upload = async (list: FileList | null) => {
    if (!list?.length) return;
    setBusy(true);
    try {
      for (const file of Array.from(list)) {
        await uploadMut.mutateAsync({ reportId, file });
      }
      toast.success("互评附件已上传");
      onUploaded?.();
    } catch (err) {
      toast.error(extractError(err, "附件上传失败"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
      >
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Paperclip className="h-4 w-4" />
        )}
        补传批注附件
      </Button>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => {
          void upload(e.target.files);
          e.target.value = "";
        }}
      />
    </>
  );
}

async function downloadAttachment(
  reportId: number,
  index: number,
  filename: string,
) {
  try {
    const response = await api.get<Blob>(
      `/review/reports/${reportId}/attachments/${index}`,
      { responseType: "blob", timeout: 120_000 },
    );
    downloadBlob(
      response.data,
      (response.headers["content-disposition"] as string | undefined) ?? "",
      filename,
    );
  } catch (err) {
    toast.error(extractError(err, "附件下载失败"));
  }
}
