import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { TanStackRouterVite } from '@tanstack/router-plugin/vite'

// ESM 下没有 __dirname，用 import.meta.url 派生
const __dirname = path.dirname(fileURLToPath(import.meta.url))

// router-plugin 必须先于 react 执行：先扫描 routes/ 生成 routeTree.gen.ts，再让 react 处理 JSX
// vitest 内嵌的 vite(rolldown) 与顶层 vite(rollup) 插件类型互相冲突，按官方示例放宽为 any
const routerPlugin = TanStackRouterVite({
  target: 'react',
  autoCodeSplitting: true,
  routesDirectory: './src/routes',
  generatedRouteTree: './src/routeTree.gen.ts',
}) as any // eslint-disable-line @typescript-eslint/no-explicit-any

export default defineConfig({
  plugins: [
    routerPlugin,
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    // 容器内运行时 localhost 指向容器自身，需用 compose 服务名；本地默认保持 localhost
    host: true,
    proxy: {
      // 开发期把 /api 转发到 backend，避免 CORS 与 cookie 域问题（refresh token cookie path=/api/auth）
      '/api': {
        target: process.env.VITE_PROXY_TARGET ?? 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    css: true,
    // 排除 E2E 测试目录：playwright spec 不应被 vitest 执行。
    // （node_modules / dist / cypress 为 vitest 默认排除，此处显式声明以避免
    // 数组覆盖行为导致默认值丢失）
    exclude: ['**/node_modules/**', '**/dist/**', '**/e2e/**', '**/cypress/**'],
    coverage: {
      provider: 'v8',
      // include 会枚举命中 glob 的**全部**文件（含从未被任何测试导入的），未测文件以 0% 计入。
      // 这样才能暴露 src/routes/**（页面组件，当前 0 测试）这类整片盲区——
      // 只报"被触及文件"时是 69%，真实值只有 ~9%。
      // 注意：vitest 4 已移除 coverage.all，不要再写回该选项（tsc 会报 TS2769）。
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/routeTree.gen.ts', // 自动生成
        'src/vite-env.d.ts',
        'src/**/__tests__/**',
        // shadcn/ui 组件是第三方生成代码，覆盖它没有意义
        'src/components/ui/**',
      ],
      reporter: ['text', 'json-summary'],
    },
  },
  build: {
    rollupOptions: {
      output: {
        // 用函数式而非对象式：node_modules 中可能不存在的包不会触发拼写错误
        // id 在 vite 里统一规范化为 unix 风格，跨平台安全
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (
            id.includes('/node_modules/react/') ||
            id.includes('/node_modules/react-dom/') ||
            id.includes('/node_modules/scheduler/')
          ) {
            return 'react-vendor'
          }
          if (id.includes('@tanstack')) return 'tanstack-vendor'
          if (id.includes('@radix-ui')) return 'radix-vendor'
          if (id.includes('lucide-react')) return 'lucide-vendor'
          if (id.includes('/node_modules/sonner/')) return 'sonner-vendor'
        },
      },
    },
  },
})
