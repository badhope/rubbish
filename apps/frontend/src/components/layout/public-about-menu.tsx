import { Link } from '@tanstack/react-router'
import {
  Accessibility,
  Activity,
  Building2,
  ChevronDown,
  ShieldCheck,
  Tags,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { navLabel, text, useLang } from '@/lib/i18n'

const ABOUT_ITEMS = [
  { to: '/about', label: '关于此处', icon: Building2 },
  { to: '/tags', label: '标签与归档', icon: Tags },
  { to: '/status', label: '站点状态', icon: Activity },
  { to: '/accessibility', label: '可访问性', icon: Accessibility },
  { to: '/privacy', label: '隐私政策', icon: ShieldCheck },
] as const

/** 公开页通用的“关于”小菜单：隐私政策不登录也能找到。 */
export function PublicAboutMenu() {
  const lang = useLang()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="hidden gap-1 px-2 text-xs text-muted-foreground md:inline-flex"
        >
          {text('关于', lang)}
          <ChevronDown className="h-3 w-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {ABOUT_ITEMS.map((item) => {
          const Icon = item.icon
          return (
            <DropdownMenuItem key={item.to} asChild>
              <Link to={item.to} className="flex items-center gap-2">
                <Icon className="h-4 w-4 text-muted-foreground" />
                <span>{navLabel(item.to, item.label, lang)}</span>
              </Link>
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
