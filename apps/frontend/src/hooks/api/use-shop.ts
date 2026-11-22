import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

export interface ShopItem {
  id: number
  name: string
  description: string
  price_coin: number
  stock: number | null
  is_active: boolean
  effect: 'none' | 'accent_unlock'
  cover_url: string | null
  sort_order: number
}

export interface ShopPurchase {
  id: number
  item_name: string
  price_coin: number
  status: string
  note: string
  created_at: string
}

export function useShopItems() {
  return useQuery({
    queryKey: ['gamification', 'shop', 'items'],
    queryFn: async () => (await api.get<{ data: ShopItem[] }>('/gamification/shop/items')).data.data,
  })
}

export function useMyPurchases() {
  return useQuery({
    queryKey: ['gamification', 'shop', 'purchases'],
    queryFn: async () => (await api.get<{ data: ShopPurchase[] }>('/gamification/shop/purchases')).data.data,
  })
}

export function usePurchaseItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (itemId: number) =>
      (await api.post(`/gamification/shop/items/${itemId}/purchase`)).data as { note?: string; status: string },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['gamification', 'wallet'] })
      void qc.invalidateQueries({ queryKey: ['gamification', 'shop'] })
    },
  })
}

export type AdminShopItem = ShopItem

export interface ShopItemInput {
  name: string
  description: string
  price_coin: number
  stock: number | null
  effect: 'none' | 'accent_unlock'
  cover_url: string | null
  sort_order: number
}

export interface ShopItemPatch extends Partial<ShopItemInput> {
  is_active?: boolean
}

function invalidateShopItems(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: ['gamification', 'admin', 'shop', 'items'] })
  void qc.invalidateQueries({ queryKey: ['gamification', 'shop', 'items'] })
}

export function useAdminShopItems() {
  return useQuery({
    queryKey: ['gamification', 'admin', 'shop', 'items'],
    queryFn: async () =>
      (await api.get<{ data: AdminShopItem[] }>('/gamification/admin/shop/items')).data.data,
  })
}

export function useCreateShopItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (payload: ShopItemInput) =>
      (await api.post<AdminShopItem>('/gamification/admin/shop/items', payload)).data,
    onSuccess: () => invalidateShopItems(qc),
  })
}

export function useUpdateShopItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...payload }: ShopItemPatch & { id: number }) =>
      (await api.patch<AdminShopItem>(`/gamification/admin/shop/items/${id}`, payload)).data,
    onSuccess: () => invalidateShopItems(qc),
  })
}

export interface AdminShopPurchase {
  id: number
  item_id: number
  item_name: string
  price_coin: number
  status: 'paid' | 'fulfilled' | 'rejected'
  note: string | null
  created_at: string
  user: { id: number; username: string; display_name: string | null }
}

export function useAdminShopPurchases(status: 'paid' | 'fulfilled' | 'rejected' = 'paid') {
  return useQuery({
    queryKey: ['gamification', 'admin', 'shop', 'purchases', status],
    queryFn: async () =>
      (
        await api.get<{ data: AdminShopPurchase[] }>('/gamification/admin/shop/purchases', {
          params: { status_filter: status },
        })
      ).data.data,
  })
}

export function useDecideShopPurchase() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (payload: { id: number; status: 'fulfilled' | 'rejected'; note?: string }) =>
      (
        await api.patch(`/gamification/admin/shop/purchases/${payload.id}`, {
          status: payload.status,
          note: payload.note ?? '',
        })
      ).data as { id: number; status: string; note: string },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['gamification', 'admin', 'shop'] })
    },
  })
}
