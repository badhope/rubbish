
import { ReceiptText, ScrollText, ShieldCheck } from "lucide-react";
import { RevealSection } from "@/components/common/reveal-section";
import { Card, CardContent } from "@/components/ui/card";
import { MarkdownContent } from "@/components/common/markdown-content";
import {
  formatCny,
  reportTotal,
  useSupportReports,
  type FinanceReport,
} from "@/hooks/api/use-support";

function CostTable({ report }: { report: FinanceReport }) {
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div>
        <h3 className="mb-2 text-sm font-medium">收入</h3>
        {report.income_items.length ? (
          <div className="overflow-hidden rounded-md border">
            <table className="w-full table-fixed text-sm">
              <colgroup>
                <col style={{ width: "48%" }} />
                <col style={{ width: "24%" }} />
                <col style={{ width: "28%" }} />
              </colgroup>
              <thead className="bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">项目</th>
                  <th className="px-3 py-2 text-right font-medium">金额</th>
                  <th className="px-3 py-2 text-left font-medium">备注</th>
                </tr>
              </thead>
              <tbody>
                {report.income_items.map((item, index) => (
                  <tr key={`${item.label}-${index}`} className="border-t">
                    <td className="px-3 py-2">{item.label}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatCny(item.amount_cents)}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {item.note || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="rounded-md border border-dashed px-3 py-4 text-sm text-muted-foreground">
            本季没有登记的其他收入。
          </p>
        )}
      </div>
      <div>
        <h3 className="mb-2 text-sm font-medium">支出</h3>
        {report.expense_items.length ? (
          <div className="overflow-hidden rounded-md border">
            <table className="w-full table-fixed text-sm">
              <colgroup>
                <col style={{ width: "48%" }} />
                <col style={{ width: "24%" }} />
                <col style={{ width: "28%" }} />
              </colgroup>
              <thead className="bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">项目</th>
                  <th className="px-3 py-2 text-right font-medium">金额</th>
                  <th className="px-3 py-2 text-left font-medium">备注</th>
                </tr>
              </thead>
              <tbody>
                {report.expense_items.map((item, index) => (
                  <tr key={`${item.label}-${index}`} className="border-t">
                    <td className="px-3 py-2">{item.label}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatCny(item.amount_cents)}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {item.note || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="rounded-md border border-dashed px-3 py-4 text-sm text-muted-foreground">
            本季没有登记的现金支出。
          </p>
        )}
      </div>
    </div>
  );
}

function FinanceSection({
  reports,
  loading,
}: {
  reports: FinanceReport[];
  loading: boolean;
}) {
  if (loading) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">
          正在读取账本…
        </CardContent>
      </Card>
    );
  }
  if (!reports.length) {
    return (
      <Card>
        <CardContent className="p-6">
          <h2 className="flex items-center gap-2 text-lg font-medium">
            <ReceiptText className="h-5 w-5 text-primary" />
            季度成本账本
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            本期账本尚未发布。成本数字要等实际对账单核对完成后再公开，本站不会用估算数字填表。
            已发布的往期账本会保留在本页，不因季度更替删除。
          </p>
        </CardContent>
      </Card>
    );
  }
  const [latest, ...older] = reports;
  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-medium">
              <ReceiptText className="h-5 w-5 text-primary" />
              {latest.year} 年 Q{latest.quarter} 账本
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">{latest.title}</p>
          </div>
          <p className="text-xs text-muted-foreground">
            发布于{" "}
            {latest.published_at
              ? new Date(latest.published_at).toLocaleDateString("zh-CN")
              : "—"}
          </p>
        </div>

        {latest.summary_md ? (
          <div className="mt-4 rounded-md bg-muted/25 px-4 py-3">
            <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <ScrollText className="h-3.5 w-3.5" />
              季度说明
            </div>
            <MarkdownContent
              text={latest.summary_md}
              className="text-sm leading-relaxed"
            />
          </div>
        ) : null}

        <div className="mt-5">
          <CostTable report={latest} />
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          <div className="rounded-md border px-3 py-2">
            <p className="text-xs text-muted-foreground">收入合计</p>
            <p className="mt-1 font-semibold tabular-nums">
              {formatCny(reportTotal(latest.income_items))}
            </p>
          </div>
          <div className="rounded-md border px-3 py-2">
            <p className="text-xs text-muted-foreground">支出合计</p>
            <p className="mt-1 font-semibold tabular-nums">
              {formatCny(reportTotal(latest.expense_items))}
            </p>
          </div>
          <div className="rounded-md border px-3 py-2">
            <p className="text-xs text-muted-foreground">本期结余</p>
            <p className="mt-1 font-semibold tabular-nums">
              {formatCny(
                reportTotal(latest.income_items) -
                  reportTotal(latest.expense_items),
              )}
            </p>
          </div>
        </div>

        {older.length ? (
          <div className="mt-5">
            <h3 className="text-sm font-medium">往期账本</h3>
            <div className="mt-2 space-y-2">
              {older.map((report) => (
                <details
                  key={report.id}
                  className="rounded-md border px-3 py-2"
                >
                  <summary className="cursor-pointer text-sm">
                    {report.year} Q{report.quarter} · {report.title}
                  </summary>
                  <div className="mt-3">
                    {report.summary_md ? (
                      <MarkdownContent
                        text={report.summary_md}
                        className="text-sm leading-relaxed"
                      />
                    ) : null}
                    <div className="mt-3">
                      <CostTable report={report} />
                    </div>
                  </div>
                </details>
              ))}
            </div>
          </div>
        ) : null}

        <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
          金额单位均为人民币元；只登记实际到账与实际支出，不用估算数字凑表。
          账本仅用于成本公开，不构成任何投资、募捐或回报承诺。
        </p>
      </CardContent>
    </Card>
  );
}

export function SupportPage() {
  const reportsQ = useSupportReports();

  return (
    <div className="space-y-6">
      <div className="border-b pb-4">
        <p className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground">COST LEDGER</p>
        <h1 className="mt-1 font-serif text-2xl tracking-tight">成本公开</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          本站无广告、无付费墙。这里只公开服务器、域名与工具链的实际成本，不提供任何收款方式。
        </p>
      </div>

        <RevealSection>
          <Card>
            <CardContent className="p-6">
              <h2 className="flex items-center gap-2 text-lg font-medium">
                <ShieldCheck className="h-5 w-5 text-primary" />
                成本去向
              </h2>
              <ul className="mt-3 space-y-2.5">
                {[
                  "服务器与对象存储：作品、帖子、图片与备份托管。",
                  "域名与证书：站点域名续费与 HTTPS。",
                  "论坛工具链：搜索、邮件、备份与内容审核的运行成本。",
                  "本页只做成本公开，不开放赞助、募捐、充值或任何收款入口。",
                ].map((para) => (
                  <li
                    key={para}
                    className="flex gap-2.5 text-sm leading-relaxed text-muted-foreground"
                  >
                    <span
                      aria-hidden
                      className="mt-2 h-1 w-1 shrink-0 rounded-full bg-primary/50"
                    />
                    {para}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </RevealSection>

        <RevealSection>
          <FinanceSection
            reports={reportsQ.data?.items ?? []}
            loading={reportsQ.isLoading}
          />
        </RevealSection>

        <RevealSection>
          <Card>
            <CardContent className="p-6">
              <h2 className="flex items-center gap-2 text-lg font-medium">
                <ShieldCheck className="h-5 w-5 text-primary" />
                收款说明
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                本页不展示二维码、银行账号、支付链接或转账方式，也不接受任何与发帖、加精、置顶或展示位置挂钩的款项。
                如未来恢复成本分摊，会先确认运营主体、税务与合规依据，再单独公告。
              </p>
            </CardContent>
          </Card>
        </RevealSection>
    </div>
  );
}
