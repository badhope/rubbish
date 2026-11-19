import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  FilePenLine,
  Inbox,
  XCircle,
} from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import {
  useEditorWorkbench,
  useMySubmissions,
  useTriageQueue,
} from "@/hooks/api/use-modules";
import { Card } from "@/components/ui/card";

/** 作者 Today：只提示“要改的、在外审的、刚投的”，不重复投稿列表。 */
function AuthorTodayCard() {
  const { user, isAdmin } = useAuth();
  const roles = user?.roles ?? [];
  const canAuthor =
    isAdmin ||
    roles.some((role) =>
      ["author", "editor", "section_editor", "editor_in_chief"].includes(role),
    );
  const mine = useMySubmissions(undefined, 1, 50, { enabled: canAuthor });
  if (!canAuthor) return null;

  const rows = mine.data?.data ?? [];
  const revisionCount = rows.filter((row) =>
    ["major_revision", "minor_revision", "rework_requested"].includes(
      row.status,
    ),
  ).length;
  const inReviewCount = rows.filter((row) =>
    ["pending", "under_review", "resubmitted"].includes(row.status),
  ).length;
  const latest = rows[0];

  return (
    <Card className="px-4 py-3" data-testid="author-today">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300">
            <FilePenLine className="h-5 w-5" aria-hidden />
          </div>
          <div>
            <p className="text-sm font-medium">今天要改的稿</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {mine.isLoading
                ? "正在读取我的投稿…"
                : revisionCount > 0
                  ? `${revisionCount} 篇待修改 · ${inReviewCount} 篇在审/待处理`
                  : inReviewCount > 0
                    ? `${inReviewCount} 篇在审/待处理，暂无待修改`
                    : "暂无待修改稿件，保持这个节奏。"}
            </p>
          </div>
        </div>
        <Link
          to="/submissions"
          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
        >
          我的投稿 <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Link
          to="/submissions"
          className="flex items-center justify-between rounded-md border border-dashed px-3 py-2 transition-colors hover:border-primary/40 hover:bg-muted/30"
        >
          <span className="text-xs text-muted-foreground">待修改</span>
          <span className="font-semibold tabular-nums">{revisionCount}</span>
        </Link>
        <Link
          to="/submissions"
          className="flex items-center justify-between rounded-md border border-dashed px-3 py-2 transition-colors hover:border-primary/40 hover:bg-muted/30"
        >
          <span className="text-xs text-muted-foreground">在审/待处理</span>
          <span className="font-semibold tabular-nums">{inReviewCount}</span>
        </Link>
      </div>
      {latest ? (
        <p className="mt-2 truncate text-xs text-muted-foreground">
          最近投稿：{latest.title}
        </p>
      ) : null}
    </Card>
  );
}

/** 编辑 Today：把初筛、待指派、待裁决三件事压成一张卡。 */
function EditorTodayCard() {
  const { user, isAdmin } = useAuth();
  const roles = user?.roles ?? [];
  const canEdit =
    isAdmin ||
    roles.some((role) =>
      ["editor", "section_editor", "editor_in_chief"].includes(role),
    );
  const triage = useTriageQueue(1, 1, { enabled: canEdit });
  const workbench = useEditorWorkbench({ enabled: canEdit });
  if (!canEdit) return null;

  const columns = workbench.data?.columns;
  const triageCount = triage.data?.meta.total ?? 0;
  const toAssign = columns?.to_assign.count ?? 0;
  const toDecide = columns?.to_decide.count ?? 0;

  return (
    <Card className="px-4 py-3" data-testid="editor-today">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300">
            <ClipboardList className="h-5 w-5" aria-hidden />
          </div>
          <div>
            <p className="text-sm font-medium">今天要处理的稿</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              初筛 {triageCount} 篇 · 待指派 {toAssign} 篇 · 待裁决 {toDecide}{" "}
              篇
            </p>
          </div>
        </div>
        <Link
          to="/editor/workbench"
          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
        >
          编辑台 <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Link
          to="/editor/triage"
          className="flex items-center justify-between rounded-md border border-dashed px-3 py-2 transition-colors hover:border-primary/40 hover:bg-muted/30"
        >
          <span className="text-xs text-muted-foreground">待初筛</span>
          <span className="font-semibold tabular-nums">{triageCount}</span>
        </Link>
        <Link
          to="/editor/workbench"
          className="flex items-center justify-between rounded-md border border-dashed px-3 py-2 transition-colors hover:border-primary/40 hover:bg-muted/30"
        >
          <span className="text-xs text-muted-foreground">待指派</span>
          <span className="font-semibold tabular-nums">{toAssign}</span>
        </Link>
        <Link
          to="/editor/workbench"
          className="flex items-center justify-between rounded-md border border-dashed px-3 py-2 transition-colors hover:border-primary/40 hover:bg-muted/30"
        >
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Inbox className="h-3.5 w-3.5" aria-hidden />
            待裁决
          </span>
          <span className="font-semibold tabular-nums">{toDecide}</span>
        </Link>
      </div>
    </Card>
  );
}

type HealthCheck = {
  key: string;
  label: string;
  status: "ok" | "warn" | "fail";
  detail: string;
};

type EditorToday = {
  status: "ok" | "warn" | "fail";
  version: string;
  checks: HealthCheck[];
  counts: Record<string, number>;
  disk_used_pct: number | null;
  db_latency_ms: number | null;
};

function CheckIcon({ status }: { status: HealthCheck["status"] }) {
  if (status === "ok")
    return (
      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" aria-hidden />
    );
  if (status === "warn")
    return <AlertTriangle className="h-3.5 w-3.5 text-amber-600" aria-hidden />;
  return <XCircle className="h-3.5 w-3.5 text-destructive" aria-hidden />;
}

/** 主编 Today：先把“今天系统有没有事”放在工作台前面。 */
function ChiefTodayCard() {
  const { user, isAdmin } = useAuth();
  const roles = user?.roles ?? [];
  const canChief =
    isAdmin ||
    roles.some((role) => ["editor_in_chief", "deputy_editor"].includes(role));
  const query = useQuery<EditorToday>({
    queryKey: ["editor", "today"],
    queryFn: async () =>
      (await api.get<EditorToday>("/admin/editor/today")).data,
    enabled: canChief,
    staleTime: 60_000,
  });

  if (!canChief) return null;

  const data = query.data;
  const important = ["backup", "migration", "disk", "email", "anomaly"];
  const checks = (data?.checks ?? []).filter((check) =>
    important.includes(check.key),
  );
  const statusLabel =
    data?.status === "ok"
      ? "系统正常"
      : data?.status === "fail"
        ? "系统故障"
        : "需要关注";

  return (
    <Card className="px-4 py-3 lg:col-span-2" data-testid="chief-today">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div
            className={
              data?.status === "fail"
                ? "flex h-9 w-9 items-center justify-center rounded-full bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300"
                : "flex h-9 w-9 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
            }
          >
            <Activity className="h-5 w-5" aria-hidden />
          </div>
          <div>
            <p className="text-sm font-medium">主编 Today · 系统与备份</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {query.isLoading
                ? "正在读取系统健康…"
                : query.isError
                  ? "健康数据暂时读不到，请稍后在后台核对"
                  : `${statusLabel} · 版本 ${data?.version ?? "—"} · 数据库 ${
                      data?.db_latency_ms ?? "—"
                    } ms`}
            </p>
          </div>
        </div>
        {isAdmin ? (
          <Link
            to="/admin/system"
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            完整体检 <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        ) : null}
      </div>

      {data ? (
        <>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {checks.map((check) => (
              <div
                key={check.key}
                className="flex items-start gap-2 rounded-md border border-dashed px-3 py-2"
              >
                <CheckIcon status={check.status} />
                <div className="min-w-0">
                  <p className="text-xs font-medium">{check.label}</p>
                  <p className="mt-0.5 break-words text-[11px] leading-relaxed text-muted-foreground">
                    {check.detail}
                  </p>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            24h 新用户 {data.counts.new_users_24h ?? "—"} · 发放 R 币{" "}
            {data.counts.coin_issued_24h ?? "—"}
            {data.disk_used_pct != null ? ` · 磁盘 ${data.disk_used_pct}%` : ""}
          </p>
        </>
      ) : null}
    </Card>
  );
}

export function RoleTodayCards() {
  return (
    <div className="mt-3 grid gap-3 lg:grid-cols-2">
      <AuthorTodayCard />
      <EditorTodayCard />
      <ChiefTodayCard />
    </div>
  );
}
