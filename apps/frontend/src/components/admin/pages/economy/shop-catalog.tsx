import { useRef, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useAdminShopItems, useCreateShopItem, useUpdateShopItem } from '@/hooks/api/use-shop'
import type { AdminShopItem } from '@/hooks/api/use-shop'
import { extractError } from '@/lib/utils'
import { uploadMediaImage } from '@/lib/media'
import { Gift, Pencil, Plus, Power, Upload } from 'lucide-react'
import { toast } from 'sonner'

type ItemForm = {
  name: string
  description: string
  price_coin: string
  stock: string
  effect: 'none' | 'accent_unlock'
  cover_url: string
  sort_order: string
  is_active: boolean
}

const EMPTY_FORM: ItemForm = {
  name: '',
  description: '',
  price_coin: '100',
  stock: '',
  effect: 'none',
  cover_url: '',
  sort_order: '0',
  is_active: true,
}

function toForm(item?: AdminShopItem | null): ItemForm {
  if (!item) return EMPTY_FORM
  return {
    name: item.name,
    description: item.description,
    price_coin: String(item.price_coin),
    stock: item.stock === null ? '' : String(item.stock),
    effect: item.effect,
    cover_url: item.cover_url ?? '',
    sort_order: String(item.sort_order),
    is_active: item.is_active,
  }
}

function stockLabel(stock: number | null): string {
  if (stock === null) return '不限量'
  if (stock <= 0) return '已售罄'
  return `剩 ${stock} 件`
}

function validate(form: ItemForm): string | null {
  if (!form.name.trim()) return '请填写货品名称'
  if (form.name.trim().length > 100) return '货品名称不能超过 100 字'
  if (form.description.length > 1000) return '说明不能超过 1000 字'
  const price = Number(form.price_coin)
  if (!Number.isInteger(price) || price < 1 || price > 100000) {
    return '价格必须是 1–100000 的整数'
  }
  if (form.stock.trim()) {
    const stock = Number(form.stock)
    if (!Number.isInteger(stock) || stock < 0 || stock > 100000) {
      return '库存留空表示不限量；填写时必须是 0–100000 的整数'
    }
  }
  const sortOrder = Number(form.sort_order.trim() || 0)
  if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 1000) {
    return '排序必须是 0–1000 的整数'
  }
  if (form.cover_url.trim().length > 500) return '封面地址不能超过 500 字符'
  return null
}

export function ShopCatalogCard() {
  const items = useAdminShopItems()
  const createItem = useCreateShopItem()
  const updateItem = useUpdateShopItem()
  const [editor, setEditor] = useState<{ item: AdminShopItem | null } | null>(null)
  const [form, setForm] = useState<ItemForm>(EMPTY_FORM)
  const [coverUploading, setCoverUploading] = useState(false)
  const coverInputRef = useRef<HTMLInputElement>(null)

  const editing = editor?.item ?? null
  const saving = createItem.isPending || updateItem.isPending

  const set = <K extends keyof ItemForm>(key: K, value: ItemForm[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const openCreate = () => {
    setForm(EMPTY_FORM)
    setEditor({ item: null })
  }

  const openEdit = (item: AdminShopItem) => {
    setForm(toForm(item))
    setEditor({ item })
  }

  const save = async () => {
    const error = validate(form)
    if (error) {
      toast.error(error)
      return
    }
    const payload = {
      name: form.name.trim(),
      description: form.description.trim(),
      price_coin: Number(form.price_coin),
      stock: form.stock.trim() === '' ? null : Number(form.stock),
      is_active: form.is_active,
      effect: form.effect,
      cover_url: form.cover_url.trim() || null,
      sort_order: Number(form.sort_order.trim() || 0),
    }
    try {
      if (editing) {
        await updateItem.mutateAsync({
          id: editing.id,
          ...payload,
          is_active: form.is_active,
        })
        toast.success('货品已更新')
      } else {
        await createItem.mutateAsync(payload)
        toast.success('货品已上架')
      }
      setEditor(null)
    } catch (err) {
      toast.error(extractError(err, '保存失败'))
    }
  }

  const uploadCover = async (file: File | undefined) => {
    if (!file) return
    if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.type)) {
      toast.error('只支持 PNG / JPEG / GIF / WebP 图片')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('封面不能超过 5MB')
      return
    }
    setCoverUploading(true)
    try {
      const url = await uploadMediaImage(file, 'shop')
      set('cover_url', url)
      toast.success('封面已上传')
    } catch (err) {
      toast.error(extractError(err, '封面上传失败'))
    } finally {
      setCoverUploading(false)
    }
  }

  const toggleActive = async (item: AdminShopItem) => {
    const action = item.is_active ? '下架' : '重新上架'
    if (!window.confirm(`确认${action}「${item.name}」？`)) return
    try {
      await updateItem.mutateAsync({ id: item.id, is_active: !item.is_active })
      toast.success(item.is_active ? '已下架' : '已重新上架')
    } catch (err) {
      toast.error(extractError(err, '操作失败'))
    }
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Gift className="h-4 w-4" /> 货品目录
              </CardTitle>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                上架后会员能在积分商店看到并兑换。库存留空表示不限量；“自动生效”目前仅支持主题色解锁，其余货品进入下方人工履约队列。
              </p>
            </div>
            <Button size="sm" onClick={openCreate}>
              <Plus className="h-4 w-4" /> 新增货品
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {items.isLoading ? <p className="text-sm text-muted-foreground">加载中…</p> : null}
          {items.isError ? (
            <div className="flex items-center justify-between gap-3 border-y py-4 text-sm">
              <span className="text-muted-foreground">货品目录加载失败。</span>
              <Button size="sm" variant="outline" onClick={() => void items.refetch()}>
                重试
              </Button>
            </div>
          ) : null}
          {!items.isLoading && !items.isError && (items.data?.length ?? 0) === 0 ? (
            <p className="border-y py-5 text-sm text-muted-foreground">
              还没有货品。新增一件，会员就能在积分商店兑换。
            </p>
          ) : null}
          {(items.data?.length ?? 0) > 0 ? (
            <div className="divide-y border-y">
              {items.data?.map((item) => (
                <div
                  key={item.id}
                  className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex min-w-0 items-start gap-3">
                    {item.cover_url ? (
                      <img
                        src={item.cover_url}
                        alt=""
                        className="h-12 w-12 shrink-0 border object-cover"
                      />
                    ) : (
                      <span className="flex h-12 w-12 shrink-0 items-center justify-center border bg-muted/25 text-muted-foreground">
                        <Gift className="h-4 w-4" />
                      </span>
                    )}
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium">{item.name}</p>
                        <Badge variant={item.is_active ? 'default' : 'outline'}>
                          {item.is_active ? '已上架' : '已下架'}
                        </Badge>
                        <span className="text-[10px] text-muted-foreground">
                          {item.effect === 'accent_unlock' ? '自动生效' : '人工发货'}
                        </span>
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                        {item.description || '暂无说明'}
                      </p>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        #{item.id} · {item.price_coin} 积分 · {stockLabel(item.stock)} · 排序{' '}
                        {item.sort_order}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button size="sm" variant="outline" onClick={() => openEdit(item)}>
                      <Pencil className="h-3.5 w-3.5" /> 编辑
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={updateItem.isPending}
                      onClick={() => void toggleActive(item)}
                    >
                      <Power className="h-3.5 w-3.5" /> {item.is_active ? '下架' : '上架'}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Dialog
        open={editor !== null}
        onOpenChange={(open) => {
          if (!open) setEditor(null)
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{editing ? '编辑货品' : '新增货品'}</DialogTitle>
            <DialogDescription>
              价格和库存按积分记账；下架后会员立即看不到，但已兑换的订单仍会在履约队列里。
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="shop-item-name">货品名称</Label>
              <Input
                id="shop-item-name"
                value={form.name}
                maxLength={100}
                placeholder="如：自定义主题色"
                onChange={(e) => set('name', e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="shop-item-description">说明</Label>
              <Textarea
                id="shop-item-description"
                value={form.description}
                maxLength={1000}
                rows={3}
                placeholder="会员兑换前会看到这段说明；写清权益范围和发放方式。"
                onChange={(e) => set('description', e.target.value)}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="shop-item-price">价格（积分）</Label>
                <Input
                  id="shop-item-price"
                  type="number"
                  min={1}
                  max={100000}
                  value={form.price_coin}
                  onChange={(e) => set('price_coin', e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="shop-item-stock">库存（留空 = 不限量）</Label>
                <Input
                  id="shop-item-stock"
                  type="number"
                  min={0}
                  max={100000}
                  value={form.stock}
                  placeholder="不限量"
                  onChange={(e) => set('stock', e.target.value)}
                />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>生效方式</Label>
                <Select
                  value={form.effect}
                  onValueChange={(value) => set('effect', value as ItemForm['effect'])}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">人工发货</SelectItem>
                    <SelectItem value="accent_unlock">自动解锁主题色</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">
                  只有主题色会自动生效；其他权益兑换后进入人工履约队列。
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="shop-item-sort">排序（越小越靠前）</Label>
                <Input
                  id="shop-item-sort"
                  type="number"
                  min={0}
                  max={1000}
                  value={form.sort_order}
                  onChange={(e) => set('sort_order', e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="shop-item-cover">封面图（选填）</Label>
              <div className="flex gap-2">
                <Input
                  id="shop-item-cover"
                  value={form.cover_url}
                  maxLength={500}
                  placeholder="上传图片，或直接贴外部地址"
                  onChange={(e) => set('cover_url', e.target.value)}
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={coverUploading}
                  onClick={() => coverInputRef.current?.click()}
                >
                  <Upload className="h-4 w-4" />
                  {coverUploading ? '上传中…' : '上传'}
                </Button>
              </div>
              <input
                ref={coverInputRef}
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp"
                className="hidden"
                onChange={(e) => {
                  void uploadCover(e.target.files?.[0])
                  e.target.value = ''
                }}
              />
              <p className="text-[11px] text-muted-foreground">
                支持 PNG / JPEG / GIF / WebP，单张不超过 5MB；留空则显示默认礼物图标。
              </p>
              {form.cover_url ? (
                <div className="space-y-2">
                  <img
                    src={form.cover_url}
                    alt="货品封面预览"
                    className="h-32 w-full border object-cover"
                  />
                  <Button type="button" size="sm" variant="ghost" onClick={() => set('cover_url', '')}>
                    移除封面
                  </Button>
                </div>
              ) : null}
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4 accent-[#2f5d46]"
                checked={form.is_active}
                onChange={(e) => set('is_active', e.target.checked)}
              />
              保存后立即上架
            </label>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditor(null)} disabled={saving}>
              取消
            </Button>
            <Button onClick={() => void save()} disabled={saving}>
              {saving ? '保存中…' : editing ? '保存修改' : '创建货品'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
