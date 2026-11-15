import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  Coffee,
  Heart,
  Info,
  Mail,
  ReceiptText,
  ScrollText,
} from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { RevealSection } from "@/components/common/reveal-section";
import { Card, CardContent } from "@/components/ui/card";
import { MarkdownContent } from "@/components/common/markdown-content";
import {
  formatCny,
  reportTotal,
  useSupportReports,
  type FinanceReport,
} from "@/hooks/api/use-support";

export const Route = createFileRoute("/support")({
  component: SupportPage,
});

// 赞助与支持：低可见度入口（页脚次级链接 + 关于页引用），不做弹窗、
// 不进导航、不在内容页插入任何募捐元素。
// 收款方式全部来自环境变量（构建期注入），未配置时只展示文字渠道，
// 不硬编码任何个人收款账户。
const VITE_PREFIX = "VITE_SUPPORT_";

interface SupportChannel {
  key: string;
  label: string;
  hint: string;
}

const CHANNELS: SupportChannel[] = [
  {
    key: "ALIPAY",
    label: "支付宝",
    hint: "打开支付宝扫一扫，或转账到下方账号。",
  },
  { key: "WECHAT", label: "微信", hint: "打开微信扫一扫即可支持。" },
  { key: "BANK", label: "银行转账", hint: "跨行转账请备注「Rubbish 赞助」。" },
];

function env(key: string): string {
  return (
    (import.meta.env[`${VITE_PREFIX}${key}`] as string | undefined)?.trim() ??
    ""
  );
}

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
            本季没有登记的现金收入。
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
              主编公开信
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
          赞助不改变投稿、评审与展示位置。
        </p>
      </CardContent>
    </Card>
  );
}

function SupportPage() {
  const qrcode = env("QRCODE_URL");
  const account = env("ACCOUNT");
  const note = env("NOTE");
  const email = env("EMAIL");
  const configured = Boolean(qrcode || account);
  const reportsQ = useSupportReports();

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        to="/"
        className="mb-4 inline-flex items-center text-sm text-muted-foreground transition-colors hover:text-primary"
      >
        <ArrowLeft className="mr-1 h-4 w-4" />
        返回首页
      </Link>

      <PageHeader
        title="支持本刊"
        description="Rubbish 是无广告、无付费墙的开放获取期刊，服务器与域名靠读者自愿支持维持。"
      />

      <div className="space-y-6">
        <RevealSection>
          <Card>
            <CardContent className="p-6">
              <h2 className="flex items-center gap-2 text-lg font-medium">
                <Heart className="h-5 w-5 text-primary" />
                赞助去向
              </h2>
              <ul className="mt-3 space-y-2.5">
                {[
                  "服务器与对象存储：全部已刊出论文的 PDF 与在线稿托管。",
                  "域名与证书：rubbish.argjiemi.cn 的续费与 HTTPS。",
                  "审稿与出版工具链：排版、DOI 注册与邮件服务的运行成本。",
                  "赞助完全自愿，不与投稿、评审、展示位置挂钩——本刊不卖版面。",
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

        {configured ? (
          <RevealSection>
            <Card>
              <CardContent className="p-6">
                <h2 className="flex items-center gap-2 text-lg font-medium">
                  <Coffee className="h-5 w-5 text-primary" />
                  转账方式
                </h2>
                {qrcode ? (
                  <figure className="mt-4 flex flex-col items-center gap-2">
                    <img
                      src={qrcode}
                      alt="收款二维码"
                      width={220}
                      height={220}
                      loading="lazy"
                      className="rounded-lg border bg-white p-2"
                    />
                    <figcaption className="text-xs text-muted-foreground">
                      扫码支持（请以实际到账为准，本站不显示也不存储任何交易信息）
                    </figcaption>
                  </figure>
                ) : null}
                {account ? (
                  <p className="mt-4 break-all rounded-md bg-muted/50 px-4 py-3 text-sm">
                    {account}
                  </p>
                ) : null}
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  {CHANNELS.map((c) => (
                    <div key={c.key} className="rounded-md border p-3">
                      <p className="text-sm font-medium">{c.label}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {c.hint}
                      </p>
                    </div>
                  ))}
                </div>
                {note ? (
                  <p className="mt-4 text-xs text-muted-foreground">{note}</p>
                ) : null}
              </CardContent>
            </Card>
          </RevealSection>
        ) : (
          <RevealSection>
            <Card>
              <CardContent className="p-6">
                <h2 className="flex items-center gap-2 text-lg font-medium">
                  <Info className="h-5 w-5 text-primary" />
                  转账通道
                </h2>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                  本刊暂未开通电子收款通道。如需支持本刊运行，可通过页脚邮箱与编辑部联系；
                  我们不接受与投稿、评审结果挂钩的任何款项。
                </p>
              </CardContent>
            </Card>
          </RevealSection>
        )}

        {email ? (
          <RevealSection>
            <Card>
              <CardContent className="p-6">
                <h2 className="flex items-center gap-2 text-lg font-medium">
                  <Mail className="h-5 w-5 text-primary" />
                  联系编辑部
                </h2>
                <p className="mt-3 text-sm text-muted-foreground">
                  赞助-related 事务（对账、鸣谢名单、机构赞助）请来信：
                  <a
                    className="ml-1 text-primary hover:underline"
                    href={`mailto:${email}`}
                  >
                    {email}
                  </a>
                </p>
              </CardContent>
            </Card>
          </RevealSection>
        ) : null}
      </div>
    </div>
  );
}
