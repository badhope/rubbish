import { useMemo, useState } from "react";
import { FilePlus2, Pencil, ReceiptText, Trash2 } from "lucide-react";
import {
  formatCny,
  reportTotal,
  useAdminFinanceReports,
  useDeleteFinanceReport,
  useSaveFinanceReport,
  type FinanceReport,
  type FinanceReportPayload,
  type MoneyItem,
} from "@/hooks/api/use-support";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState, Loading } from "@/components/common/state";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";



interface EditableItem {
  label: string;
  amount: string;
  note: string;
}

interface FormState {
  year: string;
  quarter: string;
  title: string;
  summary_md: string;
  income: EditableItem[];
  expense: EditableItem[];
}

const EMPTY_ITEM: EditableItem = { label: "", amount: "", note: "" };

function currentPeriod(): { year: string; quarter: string } {
  const now = new Date();
  return {
    year: String(now.getFullYear()),
    quarter: String(Math.floor(now.getMonth() / 3) + 1),
  };
}

function emptyForm(): FormState {
  return {
    ...currentPeriod(),
    title: "",
    summary_md: "",
    income: [{ ...EMPTY_ITEM }],
    expense: [{ ...EMPTY_ITEM }],
  };
}

function toEditable(items: MoneyItem[]): EditableItem[] {
  if (!items.length) return [{ ...EMPTY_ITEM }];
  return items.map((item) => ({
    label: item.label,
    amount: (item.amount_cents / 100).toFixed(2),
    note: item.note,
  }));
}

function normalizeItems(items: EditableItem[]): MoneyItem[] {
  return items
    .map((item) => {
      const value = Number.parseFloat(item.amount);
      return {
        label: item.label.trim(),
        amount_cents:
          Number.isFinite(value) && value > 0 ? Math.round(value * 100) : 0,
        note: item.note.trim(),
      };
    })
    .filter((item) => item.label.length > 0);
}

function ItemEditor({
  title,
  hint,
  items,
  onChange,
}: {
  title: string;
  hint: string;
  items: EditableItem[];
  onChange: (items: EditableItem[]) => void;
}) {
  const update = (index: number, patch: Partial<EditableItem>) => {
    onChange(
      items.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    );
  };
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium">{title}</h3>
        <p className="text-[11px] text-muted-foreground">{hint}</p>
      </div>
      <div className="space-y-2">
        {items.map((item, index) => (
          <div
            key={index}
            className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_120px_minmax(0,1fr)_auto]"
          >
            <Input
              value={item.label}
              onChange={(e) => update(index, { label: e.target.value })}
              placeholder="项目，如 VPS"
              aria-label={`${title}项目`}
            />
            <Input
              type="number"
              min="0"
              step="0.01"
              value={item.amount}
              onChange={(e) => update(index, { amount: e.target.value })}
              placeholder="金额（元）"
              aria-label={`${title}金额`}
            />
            <Input
              value={item.note}
              onChange={(e) => update(index, { note: e.target.value })}
              placeholder="备注（可选）"
              aria-label={`${title}备注`}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="删除这一行"
              onClick={() => onChange(items.filter((_, i) => i !== index))}
              disabled={items.length === 1}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="mt-2"
        onClick={() => onChange([...items, { ...EMPTY_ITEM }])}
      >
        <FilePlus2 className="mr-1.5 h-4 w-4" />
        加一行
      </Button>
    </div>
  );
}

export default function FinanceAdminPage() {
  const reports = useAdminFinanceReports();
  const save = useSaveFinanceReport();
  const remove = useDeleteFinanceReport();
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<FinanceReport | null>(null);

  const totals = useMemo(
    () => ({
      income: reportTotal(normalizeItems(form.income)),
      expense: reportTotal(normalizeItems(form.expense)),
    }),
    [form.income, form.expense],
  );

  const startNew = () => {
    setEditingId(null);
    setForm(emptyForm());
    setOpen(true);
  };

  const startEdit = (report: FinanceReport) => {
    setEditingId(report.id);
    setForm({
      year: String(report.year),
      quarter: String(report.quarter),
      title: report.title,
      summary_md: report.summary_md,
      income: toEditable(report.income_items),
      expense: toEditable(report.expense_items),
    });
    setOpen(true);
  };

  const buildPayload = (published: boolean): FinanceReportPayload | null => {
    const title = form.title.trim();
    if (!title) return null;
    return {
      year: Number.parseInt(form.year, 10),
      quarter: Number.parseInt(form.quarter, 10),
      title,
      summary_md: form.summary_md.trim(),
      income_items: normalizeItems(form.income),
      expense_items: normalizeItems(form.expense),
      currency: "CNY",
      published,
    };
  };

  const submit = async (published: boolean) => {
    const payload = buildPayload(published);
    if (!payload) return;
    await save.mutateAsync({ id: editingId ?? undefined, payload });
    setOpen(false);
    setEditingId(null);
    setForm(emptyForm());
  };

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="季度财务公开"
        description="只录真实发生的收入与支出；没有对账单或票据的项目不要发布。公开页只展示已发布版本。"
        actions={
          <Button onClick={startNew}>
            <FilePlus2 className="mr-1.5 h-4 w-4" />
            新建季度账本
          </Button>
        }
      />

      {open ? (
        <Card className="mb-5">
          <CardHeader>
            <CardTitle className="text-base">
              {editingId ? "编辑季度账本" : "新建季度账本"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-4">
              <div>
                <Label htmlFor="finance-year">年份</Label>
                <Input
                  id="finance-year"
                  type="number"
                  min="2020"
                  max="2100"
                  value={form.year}
                  onChange={(e) => setForm({ ...form, year: e.target.value })}
                />
              </div>
              <div>
                <Label>季度</Label>
                <Select
                  value={form.quarter}
                  onValueChange={(value) =>
                    setForm({ ...form, quarter: value })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[1, 2, 3, 4].map((quarter) => (
                      <SelectItem key={quarter} value={String(quarter)}>
                        Q{quarter}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="finance-title">公开信标题</Label>
                <Input
                  id="finance-title"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="如：2026 Q4 账本：钱花在哪"
                />
              </div>
            </div>

            <div>
              <Label htmlFor="finance-summary">
                季度公开信正文（Markdown）
              </Label>
              <Textarea
                id="finance-summary"
                rows={7}
                value={form.summary_md}
                onChange={(e) =>
                  setForm({ ...form, summary_md: e.target.value })
                }
                placeholder="只写可核对的事实：本季发生了什么、为什么这样花钱、下一季准备做什么。"
              />
            </div>

            <div className="grid gap-5 lg:grid-cols-2">
              <ItemEditor
                title="收入"
                hint="赞助、利息等；没有就留空"
                items={form.income}
                onChange={(income) => setForm({ ...form, income })}
              />
              <ItemEditor
                title="支出"
                hint="服务器、域名、存储、邮件等"
                items={form.expense}
                onChange={(expense) => setForm({ ...form, expense })}
              />
            </div>

            <div className="rounded-md bg-muted/40 px-4 py-3 text-sm">
              本季收入{" "}
              <strong className="tabular-nums">
                {formatCny(totals.income)}
              </strong>
              <span className="mx-2 text-muted-foreground">·</span>
              支出{" "}
              <strong className="tabular-nums">
                {formatCny(totals.expense)}
              </strong>
              <span className="mx-2 text-muted-foreground">·</span>
              结余{" "}
              <strong className="tabular-nums">
                {formatCny(totals.income - totals.expense)}
              </strong>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={() => void submit(false)}
                disabled={save.isPending}
              >
                保存草稿
              </Button>
              <Button
                onClick={() => void submit(true)}
                disabled={save.isPending}
              >
                {save.isPending ? "保存中…" : "保存并发布"}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setOpen(false);
                  setEditingId(null);
                  setForm(emptyForm());
                }}
              >
                取消
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ReceiptText className="h-4 w-4" />
            账本记录
          </CardTitle>
        </CardHeader>
        <CardContent>
          {reports.isLoading ? (
            <Loading />
          ) : reports.data?.items.length ? (
            <div className="space-y-3">
              {reports.data.items.map((report) => (
                <div
                  key={report.id}
                  className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">
                        {report.year} Q{report.quarter}
                      </Badge>
                      <Badge
                        variant={report.published ? "secondary" : "outline"}
                      >
                        {report.published ? "已发布" : "草稿"}
                      </Badge>
                      <p className="truncate font-medium">{report.title}</p>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      收入 {formatCny(reportTotal(report.income_items))} · 支出{" "}
                      {formatCny(reportTotal(report.expense_items))} · 更新于{" "}
                      {new Date(report.updated_at).toLocaleDateString("zh-CN")}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => startEdit(report)}
                    >
                      <Pencil className="mr-1.5 h-4 w-4" />
                      编辑
                    </Button>
                    {!report.published ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDeleteTarget(report)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              title="还没有账本"
              description="先建一份草稿。没有真实数字时保持空白，公开页会显示“本期账本尚未发布”。"
            />
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(value) => {
          if (!value) setDeleteTarget(null);
        }}
        title="删除这份草稿？"
        description="删除后无法恢复；已发布账本不能直接删除。"
        confirmText="删除"
        destructive
        onConfirm={() => {
          if (deleteTarget) {
            remove.mutate(deleteTarget.id);
            setDeleteTarget(null);
          }
        }}
      />
    </div>
  );
}
