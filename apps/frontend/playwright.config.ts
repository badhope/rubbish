import { defineConfig, devices } from '@playwright/test'

// E2E 配置：默认走系统 Chrome（沙箱中 google-chrome-stable 已就绪）。
// 后端走 SQLite + development 模式（见 apps/backend/e2e_run_server.py），
// 前端复用 vite dev server（5173）。两者都已由外部启动时 reuseExistingServer 兜底。
const FRONTEND_URL = process.env.E2E_FRONTEND_URL ?? 'http://localhost:5173'
const BACKEND_URL = process.env.E2E_BACKEND_URL ?? 'http://localhost:8000'

// F7：per-worker DB 分片。E2E_DB_PATH / E2E_PORT 让每个 CI lane 或每个
// worker 持有独立 SQLite 文件与端口，避免共享单库在并发写时的锁竞争。
// 默认保持 workers=1 + 串行（共享单库场景最稳）；需要多 worker 时由 CI
// 显式设置 E2E_WORKERS 并配套 E2E_DB_PATH/E2E_PORT 实现分片。
const E2E_WORKERS = process.env.E2E_WORKERS ? Number(process.env.E2E_WORKERS) : 1

export default defineConfig({
  testDir: './tests/e2e',
  // 共享 SQLite 单库场景下串行更稳；多 worker（E2E_WORKERS>1）需要每个
  // worker 持独立 DB 分片，由 CI 通过 E2E_DB_PATH 配套实现。
  fullyParallel: E2E_WORKERS > 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: E2E_WORKERS,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: FRONTEND_URL,
    locale: 'zh-CN',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // video 关闭：录制需要 ffmpeg，沙箱不一定有；trace + screenshot 已足够定位失败。
    video: 'off',
    // Chromium 的 no-sandbox 参数只挂在 chromium project 上；
    // Firefox/WebKit 不接受 --no-sandbox，不能放进全局 use。
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        locale: 'zh-CN',
        launchOptions: {
          args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
          ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
            ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
            : {}),
        },
      },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'], locale: 'zh-CN' },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'], locale: 'zh-CN' },
    },
  ],
  webServer: [
    {
      // --no-sync：webServer 只负责启动，不同步依赖。CI 的 e2e job 已提前
      // `uv sync --group dev`；若在这里让 uv run 自行同步，会触发一次联网
      // （离线/受限环境下直接启动失败），且拖慢 webServer 的 60s 启动窗口。
      command: 'cd ../backend && uv run --no-sync python e2e_run_server.py',
      url: `${BACKEND_URL}/api/health`,
      // 默认复用外部已起的服务（沙箱已起 backend+vite），仅当 E2E_SPAWN_SERVER=1 时才自启。
      reuseExistingServer: process.env.E2E_SPAWN_SERVER !== '1',
      timeout: 60_000,
    },
    {
      command: 'npm run dev -- --strictPort=false',
      url: FRONTEND_URL,
      reuseExistingServer: process.env.E2E_SPAWN_SERVER !== '1',
      timeout: 60_000,
    },
  ],
})
