import { createFileRoute, Link, useSearch } from "@tanstack/react-router";
import { ArrowLeft, CheckCircle2, Mail, XCircle } from "lucide-react";
import {
  useConfirmSubscription,
  useUnsubscribe,
} from "@/hooks/api/use-support";
import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export const Route = createFileRoute("/desk_/subscribe")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { token?: string; action?: "confirm" | "unsubscribe" } => ({
    token: typeof search.token === "string" ? search.token : undefined,
    action: search.action === "unsubscribe" ? "unsubscribe" : "confirm",
  }),
  component: DeskSubscribePage,
});

function DeskSubscribePage() {
  const { token, action } = useSearch({ from: "/desk_/subscribe" });
  const confirm = useConfirmSubscription();
  const unsubscribe = useUnsubscribe();
  const result = action === "unsubscribe" ? unsubscribe.data : confirm.data;
  const pending =
    action === "unsubscribe" ? unsubscribe.isPending : confirm.isPending;

  const run = () => {
    if (!token) return;
    if (action === "unsubscribe") {
      unsubscribe.mutate(token);
    } else {
      confirm.mutate(token);
    }
  };

  return (
    <div className="mx-auto max-w-xl">
      <Link
        to="/desk"
        className="mb-4 inline-flex items-center text-sm text-muted-foreground transition-colors hover:text-primary"
      >
        <ArrowLeft className="mr-1 h-4 w-4" />
        返回主编桌
      </Link>
      <PageHeader
        title={
          action === "unsubscribe" ? "退订主编桌邮件" : "确认订阅主编桌邮件"
        }
        description="这一步需要你亲自点击，避免邮件安全扫描器替你确认。"
      />

      <Card>
        <CardContent className="p-6">
          {!token ? (
            <div className="flex items-start gap-3">
              <XCircle
                className="mt-0.5 h-5 w-5 text-destructive"
                aria-hidden
              />
              <div>
                <p className="font-medium">链接缺少确认令牌</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  请从确认邮件里的按钮重新打开，或回到主编桌重新提交订阅。
                </p>
              </div>
            </div>
          ) : result ? (
            <div className="flex items-start gap-3">
              {result.ok ? (
                <CheckCircle2
                  className="mt-0.5 h-5 w-5 text-emerald-600"
                  aria-hidden
                />
              ) : (
                <XCircle
                  className="mt-0.5 h-5 w-5 text-destructive"
                  aria-hidden
                />
              )}
              <div>
                <p className="font-medium">
                  {result.ok ? "操作完成" : "链接不可用"}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {result.message}
                </p>
                {result.email_masked ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    邮箱：{result.email_masked}
                  </p>
                ) : null}
                <Link
                  to="/desk"
                  className="mt-3 inline-flex text-sm text-primary hover:underline"
                >
                  返回主编桌
                </Link>
              </div>
            </div>
          ) : (
            <div>
              <div className="flex items-start gap-3">
                <Mail className="mt-0.5 h-5 w-5 text-primary" aria-hidden />
                <div>
                  <p className="font-medium">
                    {action === "unsubscribe"
                      ? "确认不再接收主编桌邮件？"
                      : "确认订阅 Rubbish 主编桌邮件？"}
                  </p>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                    {action === "unsubscribe"
                      ? "退订立即生效；之后不会再收到季度公开信或编辑部重要更新。"
                      : "确认后只会在季度公开信与编辑部重要更新时发信，不推送每篇论文，也不用于营销。"}
                  </p>
                </div>
              </div>
              <Button className="mt-4" onClick={run} disabled={pending}>
                {pending
                  ? "处理中…"
                  : action === "unsubscribe"
                    ? "确认退订"
                    : "确认订阅"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
