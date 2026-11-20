import { createFileRoute } from '@tanstack/react-router'
import { AdminShell } from '@/components/admin/admin-shell'

// 所有 /admin/* 页共用同一个后台壳：总览 + 四个业务域页签 + 当前域子页签。
// 具体表单、权限和审计仍在各子页，避免为了合并 UI 重写业务逻辑。
export const Route = createFileRoute('/admin')({
  component: AdminLayout,
})

function AdminLayout() {
  return <AdminShell />
}
