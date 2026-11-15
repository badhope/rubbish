import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Download, Mail } from "lucide-react";
import {
  useAdminDeskSubscribers,
  type DeskSubscriber,
} from "@/hooks/api/use-support";
import { requireAdminGuard } from "@/lib/route-guards";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState, Loading } from "@/components/common/state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/admin/desk-subscribers")({
  beforeLoad: () => requireAdminGuard(),
  component: DeskSubscribersAdminPage,
});

const STATUS_LABELS: Record<string, string> = {
  pending: "待确认",
  confirmed: "已确认",
  unsubscribed: "已退订",
};

function csvEscape(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function exportCsv(rows: DeskSubscriber[]) {
  const header =
    "email,status,source,created_at,confirmed_at,unsubscribed_at\n";
  const body = rows
    .map((row) =>
      [
        row.email,
        row.status,
        row.source,
        row.created_at,
        row.confirmed_at ?? "",
        row.unsubscribed_at ?? "",
      ]
        .map((value) => csvEscape(String(value)))
        .join(","),
    )
    .join("\n");
  const blob = new Blob([`\uFEFF${header}${body}`], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "rubbish-desk-subscribers.csv";
  link.click();
  URL.revokeObjectURL(url);
}

function DeskSubscribersAdminPage() {
  const [status, setStatus] = useState<string>("confirmed");
  const subscribers = useAdminDeskSubscribers(
    status === "all" ? undefined : status,
  );
  const rows = subscribers.data?.items ?? [];

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="主编桌邮件订阅"
        description="只展示邮箱与状态，不保存确认令牌明文。导出前请确认用途符合隐私政策。"
        actions={
          <div className="flex flex-wrap gap-2">
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-[130px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部</SelectItem>
                <SelectItem value="confirmed">已确认</SelectItem>
                <SelectItem value="pending">待确认</SelectItem>
                <SelectItem value="unsubscribed">已退订</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              onClick={() => exportCsv(rows)}
              disabled={!rows.length}
            >
              <Download className="mr-1.5 h-4 w-4" />
              导出 CSV
            </Button>
          </div>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Mail className="h-4 w-4" />
            {STATUS_LABELS[status] ?? "全部订阅人"}
            <Badge variant="outline" className="ml-1">
              {subscribers.data?.total ?? 0}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {subscribers.isLoading ? (
            <Loading />
          ) : rows.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] text-sm">
                <thead className="text-xs text-muted-foreground">
                  <tr className="border-b">
                    <th className="px-2 py-2 text-left font-medium">邮箱</th>
                    <th className="px-2 py-2 text-left font-medium">状态</th>
                    <th className="px-2 py-2 text-left font-medium">来源</th>
                    <th className="px-2 py-2 text-left font-medium">
                      提交时间
                    </th>
                    <th className="px-2 py-2 text-left font-medium">
                      确认时间
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="border-b last:border-0">
                      <td className="px-2 py-2">{row.email}</td>
                      <td className="px-2 py-2">
                        <Badge
                          variant={
                            row.status === "confirmed" ? "secondary" : "outline"
                          }
                        >
                          {STATUS_LABELS[row.status] ?? row.status}
                        </Badge>
                      </td>
                      <td className="px-2 py-2 text-muted-foreground">
                        {row.source}
                      </td>
                      <td className="px-2 py-2 text-muted-foreground">
                        {new Date(row.created_at).toLocaleDateString("zh-CN")}
                      </td>
                      <td className="px-2 py-2 text-muted-foreground">
                        {row.confirmed_at
                          ? new Date(row.confirmed_at).toLocaleDateString(
                              "zh-CN",
                            )
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              title="还没有订阅人"
              description="主编桌的订阅表单会先进入待确认，用户点邮件里的确认链接后才转为已确认。"
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
