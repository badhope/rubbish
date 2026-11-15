import { useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import { Loader2, Mail } from "lucide-react";
import {
  useSubscribeDesk,
  useSupportSubscription,
} from "@/hooks/api/use-support";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

/**
 * Desk email list: double opt-in, no marketing, no per-paper notifications.
 * The count is public but addresses never are.
 */
export function DeskSubscribeCard() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState("");
  const subscribe = useSubscribeDesk();
  const status = useSupportSubscription();

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const value = email.trim();
    if (!value) return;
    const res = await subscribe.mutateAsync({ email: value, source: "desk" });
    setSent(res.message);
    setEmail("");
  };

  return (
    <section className="mt-10">
      <Card className="overflow-hidden">
        <CardContent className="p-5 sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="max-w-xl">
              <h2 className="flex items-center gap-2 font-serif text-lg font-medium">
                <Mail className="h-5 w-5 text-primary" aria-hidden />
                订阅主编桌季度信
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                只发季度成本公开信和编辑部重要更新，不推送每篇论文，不用于赞助或营销。
                邮箱只用于这件事，可随时一键退订。
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                采用双重确认：提交后需要点邮件里的确认链接才算订阅。
                {status.data && status.data.confirmed_count > 0
                  ? ` 已有 ${status.data.confirmed_count} 位读者确认订阅。`
                  : ""}
              </p>
            </div>
            <form onSubmit={onSubmit} className="w-full shrink-0 sm:w-[340px]">
              <div className="flex gap-2">
                <Input
                  type="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="你的邮箱"
                  aria-label="订阅邮箱"
                  autoComplete="email"
                />
                <Button type="submit" disabled={subscribe.isPending}>
                  {subscribe.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  ) : (
                    "订阅"
                  )}
                </Button>
              </div>
              {sent ? (
                <p className="mt-2 text-xs leading-relaxed text-emerald-700 dark:text-emerald-400">
                  {sent}
                </p>
              ) : null}
              {status.data && !status.data.mail_configured ? (
                <p className="mt-2 text-xs leading-relaxed text-amber-700 dark:text-amber-400">
                  邮件通道尚未配置：提交会先进入待确认队列，暂不会发出确认邮件。
                </p>
              ) : null}
              <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                提交即表示同意按
                <Link
                  to="/policies"
                  className="mx-1 text-primary hover:underline"
                >
                  隐私政策
                </Link>
                处理邮箱；不订阅也不会影响投稿或评审。
              </p>
            </form>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
