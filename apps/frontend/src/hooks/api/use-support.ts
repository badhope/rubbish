import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { extractError } from "@/lib/utils";
import { toast } from "sonner";

export interface MoneyItem {
  label: string;
  amount_cents: number;
  note: string;
}

export interface FinanceReport {
  id: number;
  year: number;
  quarter: number;
  title: string;
  summary_md: string;
  income_items: MoneyItem[];
  expense_items: MoneyItem[];
  currency: string;
  published: boolean;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  created_by: number | null;
}

export interface FinanceReportPayload {
  year: number;
  quarter: number;
  title: string;
  summary_md: string;
  income_items: MoneyItem[];
  expense_items: MoneyItem[];
  currency: "CNY";
  published: boolean;
}

export interface FinanceReportList {
  items: FinanceReport[];
  total: number;
}

export interface SubscriptionStatus {
  mail_configured: boolean;
  confirmed_count: number;
  pending_count: number;
}

export interface TokenResult {
  ok: boolean;
  status: "confirmed" | "unsubscribed" | "invalid" | "expired";
  email_masked: string | null;
  message: string;
}

export interface DeskSubscriber {
  id: number;
  email: string;
  status: string;
  source: string;
  created_at: string;
  confirmed_at: string | null;
  unsubscribed_at: string | null;
}

export interface SubscriberList {
  items: DeskSubscriber[];
  total: number;
}

const supportKeys = {
  reports: ["support", "reports"] as const,
  subscription: ["support", "subscription"] as const,
  adminReports: ["admin", "finance-reports"] as const,
  subscribers: (status?: string) =>
    ["admin", "desk-subscribers", status ?? "all"] as const,
};

export function useSupportReports(limit = 8) {
  return useQuery<FinanceReportList>({
    queryKey: [...supportKeys.reports, limit],
    queryFn: async () =>
      (
        await api.get<FinanceReportList>("/support/reports", {
          params: { limit },
        })
      ).data,
    staleTime: 60_000,
  });
}

export function useSupportSubscription() {
  return useQuery<SubscriptionStatus>({
    queryKey: supportKeys.subscription,
    queryFn: async () =>
      (await api.get<SubscriptionStatus>("/support/subscription")).data,
    staleTime: 60_000,
  });
}

export function useSubscribeDesk() {
  return useMutation({
    mutationFn: async (payload: { email: string; source?: string }) =>
      (
        await api.post<{ ok: boolean; message: string }>(
          "/support/subscribe",
          payload,
        )
      ).data,
    onError: (err) => toast.error(extractError(err, "订阅失败，请稍后再试")),
  });
}

export function useConfirmSubscription() {
  return useMutation({
    mutationFn: async (token: string) =>
      (await api.post<TokenResult>("/support/confirm", { token })).data,
  });
}

export function useUnsubscribe() {
  return useMutation({
    mutationFn: async (token: string) =>
      (await api.post<TokenResult>("/support/unsubscribe", { token })).data,
  });
}

export function useAdminFinanceReports() {
  return useQuery<FinanceReportList>({
    queryKey: supportKeys.adminReports,
    queryFn: async () =>
      (await api.get<FinanceReportList>("/admin/finance/reports")).data,
  });
}

export function useAdminDeskSubscribers(status?: string) {
  return useQuery<SubscriberList>({
    queryKey: supportKeys.subscribers(status),
    queryFn: async () =>
      (
        await api.get<SubscriberList>("/admin/desk/subscribers", {
          params: { status, limit: 200 },
        })
      ).data,
  });
}

export function useSaveFinanceReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      payload,
    }: {
      id?: number;
      payload: FinanceReportPayload;
    }) => {
      if (id) {
        return (
          await api.patch<FinanceReport>(
            `/admin/finance/reports/${id}`,
            payload,
          )
        ).data;
      }
      return (await api.post<FinanceReport>("/admin/finance/reports", payload))
        .data;
    },
    onSuccess: () => {
      toast.success("季度账本已保存");
      void qc.invalidateQueries({ queryKey: supportKeys.adminReports });
      void qc.invalidateQueries({ queryKey: supportKeys.reports });
    },
    onError: (err) => toast.error(extractError(err, "保存失败")),
  });
}

export function useDeleteFinanceReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) =>
      (await api.delete(`/admin/finance/reports/${id}`)).data,
    onSuccess: () => {
      toast.success("草稿已删除");
      void qc.invalidateQueries({ queryKey: supportKeys.adminReports });
      void qc.invalidateQueries({ queryKey: supportKeys.reports });
    },
    onError: (err) => toast.error(extractError(err, "删除失败")),
  });
}

export function formatCny(cents: number): string {
  return `¥${(cents / 100).toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function reportTotal(items: MoneyItem[]): number {
  return items.reduce((sum, item) => sum + item.amount_cents, 0);
}
