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
