import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Send,
  Upload,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { getAuthState } from "@/lib/auth";
import {
  useCreateSubmissionsBatch,
  useFetchIngest,
  useParseIngest,
} from "@/hooks/api/use-modules";
import type {
  FetchSource,
  IngestResource,
  ParseFormat,
  ParseRequest,
  SubmissionBatchResponse,
} from "@/lib/types";
import { PageHeader } from "@/components/common/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { extractError } from "@/lib/utils";
import {
  CSV_FIELD_OPTIONS,
  CSV_IGNORE_TARGET,
  buildColumnMap,
  guessColumnMap,
  ingestToSubmission,
  mergeDuplicateIngestResources,
  parseCsvHeader,
} from "@/lib/ingest";

export const Route = createFileRoute("/ingest/")({
  beforeLoad: () => {
    if (!getAuthState().isAuthenticated) throw redirect({ to: '/login', search: { redirect: '/ingest' } });
  },
  component: IngestPage,
});

const FORMAT_OPTIONS: { value: ParseFormat; label: string }[] = [
  { value: "bibtex", label: "BibTeX" },
  { value: "ris", label: "RIS" },
  { value: "csv", label: "CSV" },
  { value: "json", label: "JSON" },
];

const SOURCE_OPTIONS: { value: FetchSource; label: string; hint: string }[] = [
  { value: "crossref", label: "Crossref", hint: "DOI，例如 10.1000/xyz123" },
  { value: "arxiv", label: "arXiv", hint: "arXiv ID，例如 2401.00001" },
  { value: "pubmed", label: "PubMed", hint: "PMID，例如 12345678" },
  {
    value: "openalex",
    label: "OpenAlex",
    hint: "DOI 或 OpenAlex ID，例如 W2741809807",
  },
  {
    value: "semantic_scholar",
    label: "Semantic Scholar",
    hint: "DOI 或 S2 paper ID",
  },
];

const FILE_FORMATS: Record<string, ParseFormat> = {
  bib: "bibtex",
  bibtex: "bibtex",
  ris: "ris",
  csv: "csv",
  json: "json",
};

function formatFromFilename(name: string): ParseFormat | null {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return FILE_FORMATS[ext] ?? null;
}

// 解析结果与查询结果共用同一种卡片渲染；批量勾选只在解析结果里出现。
function ResourceCard({
  resource,
  onSend,
  selectable = false,
  selected = false,
  onSelect,
}: {
  resource: IngestResource;
  onSend: (r: IngestResource) => void;
  selectable?: boolean;
  selected?: boolean;
  onSelect?: () => void;
}) {
  return (
    <Card className={selected ? "border-primary/60 bg-primary/5" : undefined}>
      <CardContent className="space-y-2">
        <div className="flex items-start gap-3">
          {selectable && (
            <input
              type="checkbox"
              checked={selected}
              onChange={() => onSelect?.()}
              aria-label={`选择 ${resource.title}`}
              className="mt-1 size-4 shrink-0 accent-primary"
            />
          )}
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex items-start justify-between gap-3">
              <h3 className="min-w-0 break-words font-medium">
                {resource.title}
              </h3>
              <Button size="sm" onClick={() => onSend(resource)}>
                完善并投稿
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="outline">{resource.type}</Badge>
              {resource.year && <span>{resource.year}</span>}
              <span>{resource.discipline}</span>
              {resource.doi && <span>{resource.doi}</span>}
            </div>
            {resource.authors.length > 0 && (
              <p className="text-sm text-muted-foreground">
                {/* 解析结果常是 "Last, First" 形式：先规范成 "First Last" 再用顿号连接，
                    否则 "Kingma, Diederik P, Ba, Jimmy" 看着像四个作者 */}
                {resource.authors
                  .map((a) => {
                    const parts = a
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean);
                    return parts.length >= 2
                      ? `${parts.slice(1).join(" ")} ${parts[0]}`
                      : a;
                  })
                  .join("、")}
              </p>
            )}
            {resource.abstract && (
              <p className="line-clamp-3 text-sm">{resource.abstract}</p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function resourceKey(resource: IngestResource, index: number): string {
  return `${index}:${resource.doi ?? resource.title}`;
}

function IngestPage() {
  const navigate = useNavigate();
  const parseMut = useParseIngest();
  const fetchMut = useFetchIngest();
  const batchMut = useCreateSubmissionsBatch();

  const [activeTab, setActiveTab] = useState<"parse" | "fetch">("parse");
  const [fetchedResources, setFetchedResources] = useState<IngestResource[]>([]);
  const [format, setFormat] = useState<ParseFormat>("bibtex");
  const [content, setContent] = useState("");
  const [source, setSource] = useState<FetchSource>("crossref");
  const [id, setId] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [mergeDuplicates, setMergeDuplicates] = useState(true);
  const [columnMapEdits, setColumnMapEdits] = useState<Record<string, string>>(
    {},
  );
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchDiscipline, setBatchDiscipline] = useState("");
  const [batchYear, setBatchYear] = useState("");
  const [batchResult, setBatchResult] = useState<SubmissionBatchResponse | null>(
    null,
  );
  const fileRef = useRef<HTMLInputElement | null>(null);

  const csvHeaders = useMemo(
    () => (format === "csv" ? parseCsvHeader(content) : []),
    [content, format],
  );
  const defaultColumnMap = useMemo(
    () => guessColumnMap(csvHeaders),
    [csvHeaders],
  );
  const effectiveColumnMap = useMemo(
    () =>
      Object.fromEntries(
        csvHeaders.map((header) => [
          header,
          columnMapEdits[header] ??
            defaultColumnMap[header] ??
            CSV_IGNORE_TARGET,
        ]),
      ) as Record<string, string>,
    [columnMapEdits, csvHeaders, defaultColumnMap],
  );
  const parsedPreview = useMemo(
    () =>
      parseMut.data ? mergeDuplicateIngestResources(parseMut.data.data) : null,
    [parseMut.data],
  );
  const displayedResources = useMemo(() => {
    if (!parseMut.data) return [];
    return mergeDuplicates
      ? (parsedPreview?.data ?? parseMut.data.data)
      : parseMut.data.data;
  }, [mergeDuplicates, parsedPreview, parseMut.data]);

  useEffect(() => {
    setSelectedKeys(new Set());
    setBatchResult(null);
  }, [parseMut.data, mergeDuplicates]);

  // 文献 ID 查询一次查一条，但结果进入待投稿队列后可累积、勾选、批量提交，
  // 不再逼用户查一条就立刻投一条。同一 DOI / 标题不重复入队。
  useEffect(() => {
    if (!fetchMut.data) return;
    const incoming = fetchMut.data;
    setFetchedResources((current) => {
      const duplicate = current.some((row) =>
        incoming.doi
          ? row.doi === incoming.doi
          : row.title.trim() === incoming.title.trim(),
      );
      return duplicate ? current : [...current, incoming];
    });
  }, [fetchMut.data]);

  const activeResources = activeTab === "parse" ? displayedResources : fetchedResources;

  const selectedEntries = useMemo(
    () =>
      activeResources
        .map((resource, index) => ({
          resource,
          key: resourceKey(resource, index),
        }))
        .filter(({ key }) => selectedKeys.has(key)),
    [activeResources, selectedKeys],
  );

  const batchYearValue = batchYear.trim() === "" ? null : Number(batchYear);
  const validBatchYear =
    batchYearValue !== null &&
    Number.isInteger(batchYearValue) &&
    batchYearValue >= -3000 &&
    batchYearValue <= 2100
      ? batchYearValue
      : null;
  const batchPreflight = useMemo(
    () =>
      selectedEntries.map((entry) => ({
        ...entry,
        ...ingestToSubmission(entry.resource, {
          discipline: batchDiscipline.trim() || undefined,
          year: validBatchYear,
        }),
      })),
    [selectedEntries, batchDiscipline, validBatchYear],
  );
  const completeBatch = batchPreflight.filter((entry) => entry.payload);
  const incompleteBatch = batchPreflight.filter((entry) => !entry.payload);

  const toggleSelected = (key: string) => {
    setSelectedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const selectAllActive = () => {
    setSelectedKeys(
      new Set(activeResources.map((resource, index) => resourceKey(resource, index))),
    );
  };

  const openBatchDialog = () => {
    setBatchResult(null);
    setBatchOpen(true);
  };

  const submitBatch = async () => {
    const items = completeBatch.flatMap((entry) =>
      entry.payload ? [entry.payload] : [],
    );
    if (items.length === 0) return;
    try {
      const result = await batchMut.mutateAsync({ items });
      setBatchResult(result);
      const successKeys = result.results
        .filter((item) => item.status === "created")
        .map((item) => completeBatch[item.index]?.key)
        .filter((key): key is string => Boolean(key));
      setSelectedKeys((current) => {
        const next = new Set(current);
        for (const key of successKeys) next.delete(key);
        return next;
      });
      if (result.failed_count === 0) {
        if (incompleteBatch.length === 0) {
          toast.success(`已提交 ${result.created_count} 条投稿，进入编辑评审队列`);
          setBatchOpen(false);
        } else {
          toast.warning(
            `已提交 ${result.created_count} 条；另有 ${incompleteBatch.length} 条缺字段，需补全后再投`,
          );
        }
      } else {
        toast.warning(
          `已提交 ${result.created_count} 条，${result.failed_count} 条未通过，失败项保留可重试`,
        );
      }
    } catch (err) {
      toast.error(extractError(err, "批量提交失败"));
    }
  };

  const loadFile = async (file?: File | null) => {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      toast.error("文件不能超过 2MB");
      return;
    }
    try {
      const text = await file.text();
      if (!text.trim()) {
        toast.error("文件是空的");
        return;
      }
      setContent(text);
      setFileName(file.name);
      const detected = formatFromFilename(file.name);
      if (detected) setFormat(detected);
      toast.success(
        `已读取 ${file.name}${detected ? `，按 ${detected.toUpperCase()} 解析` : ""}`,
      );
    } catch {
      toast.error("读取文件失败，请确认文件编码为 UTF-8");
    }
  };

  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    await loadFile(file);
  };

  const sendToSubmissions = (r: IngestResource) => {
    void navigate({ to: "/submissions/new", state: { preset: r } });
  };

  const onParse = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const body: ParseRequest = { format, content };
      if (format === "csv" && csvHeaders.length > 0) {
        body.column_map = buildColumnMap(csvHeaders, effectiveColumnMap);
      }
      const res = await parseMut.mutateAsync(body);
      const mergedCount = mergeDuplicateIngestResources(res.data).merged;
      toast.success(
        `解析完成，成功 ${res.count} 条${mergeDuplicates && mergedCount > 0 ? `，合并重复 ${mergedCount} 条` : ""}`,
      );
    } catch (err) {
      toast.error(extractError(err, "解析失败"));
    }
  };

  const onFetch = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await fetchMut.mutateAsync({ source, id });
    } catch (err) {
      toast.error(extractError(err, "查询失败"));
    }
  };

  return (
    <div>
      <PageHeader
        title="从文献导入"
        description="这是投稿的一种创建方式：读取 BibTeX / RIS / CSV / JSON，或按 DOI、PubMed、arXiv、OpenAlex、Semantic Scholar 查询，解析后可勾选多条进入投稿向导。"
        actions={
          <Button variant="outline" asChild>
            <Link to="/submissions">
              <ArrowLeft className="h-4 w-4" />
              返回我的提交
            </Link>
          </Button>
        }
      />

      <Tabs
        value={activeTab}
        onValueChange={(value) => {
          setActiveTab(value as "parse" | "fetch");
          setSelectedKeys(new Set());
          setBatchResult(null);
        }}
      >
        <TabsList>
          <TabsTrigger value="parse">解析文件</TabsTrigger>
          <TabsTrigger value="fetch">文献 ID 查询</TabsTrigger>
        </TabsList>

        <TabsContent value="parse" className="mt-4 space-y-4">
          <Card>
            <CardContent>
              <form onSubmit={onParse} className="space-y-4">
                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground">格式</label>
                  <Select
                    value={format}
                    onValueChange={(v) => setFormat(v as ParseFormat)}
                  >
                    <SelectTrigger className="w-40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FORMAT_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label className="text-xs text-muted-foreground">
                      内容
                    </label>
                    <div className="flex items-center gap-2">
                      {fileName && (
                        <span
                          className="max-w-48 truncate text-xs text-muted-foreground"
                          title={fileName}
                        >
                          {fileName}
                        </span>
                      )}
                      <input
                        ref={fileRef}
                        type="file"
                        accept=".bib,.bibtex,.ris,.csv,.json,application/json,text/plain"
                        className="hidden"
                        onChange={onPickFile}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => fileRef.current?.click()}
                      >
                        <Upload className="mr-1 h-3.5 w-3.5" />
                        读取文件
                      </Button>
                      {content && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setContent("");
                            setFileName(null);
                          }}
                        >
                          清空
                        </Button>
                      )}
                    </div>
                  </div>
                  <Textarea
                    value={content}
                    onChange={(e) => {
                      setContent(e.target.value);
                      setFileName(null);
                    }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      const file = e.dataTransfer.files?.[0];
                      if (file) void loadFile(file);
                    }}
                    rows={12}
                    placeholder="粘贴 BibTeX / RIS / CSV 内容…"
                    required
                  />
                  <p className="text-xs text-muted-foreground">
                    支持 UTF-8 的 .bib / .bibtex / .ris / .csv / .json，最大
                    2MB；读取后仍可手工修改再解析。
                  </p>
                </div>
                <Button type="submit" disabled={parseMut.isPending || !content}>
                  {parseMut.isPending ? "解析中…" : "解析"}
                </Button>
              </form>
            </CardContent>
          </Card>

          {format === "csv" && csvHeaders.length > 0 && (
            <Card>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-medium">CSV 字段映射</h3>
                    <Badge variant="outline">{csvHeaders.length} 列</Badge>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setColumnMapEdits({})}
                  >
                    恢复自动识别
                  </Button>
                </div>
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                  {csvHeaders.map((header) => (
                    <div
                      key={header}
                      className="grid grid-cols-[minmax(0,1fr)_11rem] items-center gap-2"
                    >
                      <span
                        className="truncate text-xs text-muted-foreground"
                        title={header}
                      >
                        {header || "（空表头）"}
                      </span>
                      <Select
                        value={effectiveColumnMap[header] ?? CSV_IGNORE_TARGET}
                        onValueChange={(value) =>
                          setColumnMapEdits((current) => ({
                            ...current,
                            [header]: value,
                          }))
                        }
                      >
                        <SelectTrigger className="h-8 w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {CSV_FIELD_OPTIONS.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  未识别的列默认“忽略此列”。显式忽略会压住后端别名自动识别，避免把备注、索引等杂列偷偷导入。
                </p>
              </CardContent>
            </Card>
          )}

          {parseMut.data && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  {parseMut.data.count > 0 && (
                    <p className="text-sm text-muted-foreground">
                      成功解析 {parseMut.data.count} 条
                      {parsedPreview &&
                      parsedPreview.merged > 0 &&
                      mergeDuplicates
                        ? `，合并重复 ${parsedPreview.merged} 条，展示 ${parsedPreview.data.length} 条`
                        : ""}
                    </p>
                  )}
                  {selectedEntries.length > 0 && (
                    <Badge variant="secondary">
                      已选 {selectedEntries.length} 条
                    </Badge>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {parseMut.data.data.length > 1 && (
                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={mergeDuplicates}
                        onChange={(event) =>
                          setMergeDuplicates(event.target.checked)
                        }
                      />
                      合并重复 DOI / 标题
                    </label>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={selectAllActive}
                    disabled={displayedResources.length === 0}
                  >
                    全选当前
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedKeys(new Set())}
                    disabled={selectedEntries.length === 0}
                  >
                    清空选择
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    onClick={openBatchDialog}
                    disabled={selectedEntries.length === 0}
                  >
                    <Send className="mr-1 h-3.5 w-3.5" />
                    批量提交（{selectedEntries.length}）
                  </Button>
                </div>
              </div>
              {displayedResources.map((r, i) => {
                const key = resourceKey(r, i);
                return (
                  <ResourceCard
                    key={key}
                    resource={r}
                    onSend={sendToSubmissions}
                    selectable
                    selected={selectedKeys.has(key)}
                    onSelect={() => toggleSelected(key)}
                  />
                );
              })}
              {parseMut.data.errors.length > 0 && (
                <div className="space-y-2 rounded-md border border-destructive/30 bg-destructive/5 p-3">
                  <div className="flex items-center gap-2 text-sm font-medium text-destructive">
                    <AlertCircle className="h-4 w-4" />
                    {parseMut.data.errors.length} 条错误
                  </div>
                  <ul className="space-y-1 text-xs">
                    {parseMut.data.errors.map((er, i) => (
                      <li key={i} className="text-muted-foreground">
                        第 {er.line} 行：{er.error}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </TabsContent>

        <TabsContent value="fetch" className="mt-4 space-y-4">
          <Card>
            <CardContent>
              <form onSubmit={onFetch} className="space-y-4">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <label className="text-xs text-muted-foreground">
                      来源
                    </label>
                    <Select
                      value={source}
                      onValueChange={(v) => setSource(v as FetchSource)}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {SOURCE_OPTIONS.map((o) => (
                          <SelectItem key={o.value} value={o.value}>
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs text-muted-foreground">ID</label>
                    <Input
                      value={id}
                      onChange={(e) => setId(e.target.value)}
                      placeholder={
                        SOURCE_OPTIONS.find((o) => o.value === source)?.hint
                      }
                      required
                    />
                  </div>
                </div>
                <Button type="submit" disabled={fetchMut.isPending || !id}>
                  {fetchMut.isPending ? "查询中…" : "查询"}
                </Button>
              </form>
            </CardContent>
          </Card>

          {fetchedResources.length > 0 && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm text-muted-foreground">
                    待投稿队列 {fetchedResources.length} 条
                  </p>
                  {selectedEntries.length > 0 && (
                    <Badge variant="secondary">已选 {selectedEntries.length} 条</Badge>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={selectAllActive}>
                    全选队列
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedKeys(new Set())}
                    disabled={selectedEntries.length === 0}
                  >
                    清空选择
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setFetchedResources([]);
                      setSelectedKeys(new Set());
                    }}
                  >
                    清空队列
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    onClick={openBatchDialog}
                    disabled={selectedEntries.length === 0}
                  >
                    <Send className="mr-1 h-3.5 w-3.5" />
                    批量提交（{selectedEntries.length}）
                  </Button>
                </div>
              </div>
              {fetchedResources.map((r, i) => {
                const key = resourceKey(r, i);
                return (
                  <ResourceCard
                    key={key}
                    resource={r}
                    onSend={sendToSubmissions}
                    selectable
                    selected={selectedKeys.has(key)}
                    onSelect={() => toggleSelected(key)}
                  />
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <Dialog
        open={batchOpen}
        onOpenChange={(open) => {
          if (!batchMut.isPending) setBatchOpen(open);
        }}
      >
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>批量提交投稿</DialogTitle>
            <DialogDescription>
              选中的记录会创建为投稿并进入编辑评审队列，不会直接发布到目录。
              缺字段的记录不会被偷偷提交。
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="batch-discipline">统一补充学科</Label>
                <Input
                  id="batch-discipline"
                  value={batchDiscipline}
                  onChange={(event) => setBatchDiscipline(event.target.value)}
                  placeholder="例如：计算机科学"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="batch-year">统一补充年份</Label>
                <Input
                  id="batch-year"
                  type="number"
                  min={-3000}
                  max={2100}
                  value={batchYear}
                  onChange={(event) => setBatchYear(event.target.value)}
                  placeholder="例如：2024"
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              只补缺失字段，不覆盖记录已有值；期刊 / 预印本 / 学位论文按论文类型投稿。
            </p>

            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">已选 {selectedEntries.length} 条</Badge>
              <Badge variant="outline">可提交 {completeBatch.length} 条</Badge>
              {incompleteBatch.length > 0 && (
                <Badge variant="outline" className="text-destructive">
                  需补全 {incompleteBatch.length} 条
                </Badge>
              )}
            </div>

            {incompleteBatch.length > 0 && (
              <div className="max-h-56 space-y-2 overflow-y-auto rounded-md border border-destructive/30 bg-destructive/5 p-2">
                {incompleteBatch.map((entry) => (
                  <div
                    key={entry.key}
                    className="flex items-start justify-between gap-2 rounded-md bg-background/70 p-2"
                  >
                    <div className="min-w-0 space-y-1">
                      <p className="truncate text-sm font-medium">
                        {entry.resource.title}
                      </p>
                      <p className="text-xs text-destructive">
                        {entry.errors.join("；")}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setBatchOpen(false);
                        sendToSubmissions(entry.resource);
                      }}
                    >
                      单独补全
                    </Button>
                  </div>
                ))}
              </div>
            )}

            {batchResult && (
              <div className="space-y-2 rounded-md border bg-muted/30 p-3">
                <p className="text-sm font-medium">
                  本次结果：成功 {batchResult.created_count} 条，失败{" "}
                  {batchResult.failed_count} 条
                </p>
                {batchResult.results
                  .filter((item) => item.status === "failed")
                  .map((item) => (
                    <div
                      key={`${item.index}-${item.title}`}
                      className="flex items-start gap-2 text-xs text-destructive"
                    >
                      <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span className="min-w-0 break-words">
                        {item.title}：{item.error ?? "提交失败"}
                      </span>
                    </div>
                  ))}
                {batchResult.created_count > 0 && (
                  <p className="flex items-center gap-1 text-xs text-muted-foreground">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    成功项已从选择中移除；失败项保留，可修正后重试。
                  </p>
                )}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setBatchOpen(false)}
              disabled={batchMut.isPending}
            >
              取消
            </Button>
            <Button
              type="button"
              onClick={() => void submitBatch()}
              disabled={
                completeBatch.length === 0 || batchMut.isPending
              }
            >
              {batchMut.isPending
                ? "提交中…"
                : `提交 ${completeBatch.length} 条`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
