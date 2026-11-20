# zcode 合规对照表（Rubbish）

> 目的：让本仓库最大程度遵守 zcode 的「规则 / 钩子 / 程序」标准，并逐条记录实现状态。
> 生成日期：2026-10-23。状态图例：✅ 已具备 ｜ 🔧 本轮落地 ｜ ⚠️ 仅运行时生效（由 zcode 客户端承载，本仓以规则/文档等价承载）｜ ❌ 不适用。
> 源标准：`~/.zcode/AGENTS.md`（12 节）、`~/.zcode/hooks/`（9 钩子）、`~/.zcode/commands/`（4 程序）、`.aqg/`（AQG 已接入）。

## 1. 规则（AGENTS 纪律）

| zcode 元素 | Rubbish 对应实现 | 状态 |
| --- | --- | --- |
| 一、输出纪律（直接结果 / 文件:行号 / 不写注释 / 无 emoji） | `AGENTS.md §一` | 🔧 本轮落地 |
| 二、工作流程（读懂 / 跟随约定 / 最小改动 / 验证 / 不主动 commit） | `AGENTS.md §二` + 既有 `CONTRIBUTING.md` | 🔧 本轮落地 |
| 三、诚实反幻觉（不谎报 / 可溯源） | `AGENTS.md §三` | 🔧 本轮落地 |
| 四、安全（密钥不进代码/日志/提交） | `AGENTS.md §四` + `.gitleaks.toml` + `.gitignore`(`.env`/`*.log`/`*.bak`) | ✅ 已具备 |
| 五、边界与风险（破坏性先确认） | `AGENTS.md §五` | 🔧 本轮落地 |
| 六、效率（并行 / 批量 / 精简） | `AGENTS.md §六` | 🔧 本轮落地 |
| 七、技术选型（离线优先 / 成熟库） | `AGENTS.md §七` | 🔧 本轮落地 |
| 八、AQG 工程纪律 | `AGENTS.md §八` + `.aqg/code-construction/` | ✅ 已接入 |
| skill-first（先查技能再开工） | `AGENTS.md §九`；`skill-router` 为 zcode 本地工具，本仓未复制 | ⚠️ 规则承载 / 工具未装 |
| 本机凭据库（accounts_cli） | 本仓用 `.env`（gitignore）+ 服务器密钥管理，而非 zcode `secrets/accounts.json` | ❌ 不适用（替代方案） |
| 九、用户提示词润色 | `AGENTS.md §十一`（注入行为由 zcode 客户端做） | 🔧 规则落地 / ⚠️ 注入运行时 |
| 十、上下文记忆文件 | `AGENTS.md §十二`；本仓沉淀到 `.aqg/` 与 `docs/`，非 zcode `memory.js` | ⚠️ 形式不同（等价） |
| 十一、任务完成度纪律（禁止半途而废） | `AGENTS.md §十三`（stop-guard 阻断由 zcode 客户端做） | 🔧 规则落地 / ⚠️ 阻断运行时 |
| 十二、收尾检查（清临时文件 / 更新文档） | `AGENTS.md §十四` + `no-junk-files` 钩子 | ✅ 已具备 + 🔧 本轮增强 |

## 2. 钩子（zcode 9 钩子 → 本仓承载方式）

| zcode 钩子 | 作用 | 本仓承载 | 状态 |
| --- | --- | --- | --- |
| `session-start.js` | 注入记忆路径 + 标题索引 | `AGENTS.md` + `docs/` 约定 | ⚠️ 仅运行时（客户端注入） |
| `user-prompt.js` | 提示词润色 + 记忆定位 | `AGENTS.md §十一` | ⚠️ 仅运行时（客户端注入） |
| `guard-write.js` | 敏感路径 deny / 登记改动 | `no-secret-files` pre-commit 钩子 + `.gitignore` | 🔧 本轮落地（git 层等效） |
| `guard-bash.js` | 危险命令 ask（14 条） | `AGENTS.md §五/§十五` 文档化；CI 不跑危险 bash | ⚠️ 仅运行时（客户端拦截） |
| `plan-sync.js` | 计划同步记忆 | 任务清单 / `AGENTS.md` 计划区块 | ⚠️ 仅运行时 |
| `track-verify.js` | 验证结果记录 / 解除门禁 | `AGENTS.md §八/§十四` 验证命令 | ⚠️ 仅运行时 |
| `stop-guard.js` | 未完成待办 / 未验证改动阻断 | `AGENTS.md §十三` 完成度纪律 | ⚠️ 仅运行时（客户端阻断） |
| `cleanup-check.js` | 临时文件 / 待更新文档检查 | `no-junk-files` pre-commit 钩子 | 🔧 本轮落地（git 层等效） |
| `selftest.js` | 13 用例自检钩子 schema | 无对应（检验 zcode 钩子自身） | ❌ 不适用 |

> 说明：zcode 的 `PreToolUse`/`PostToolUse`/`Stop`/`SessionStart` 钩子是绑定 `~/.zcode/cli` 运行时的代理机制，无法作为 git 钩子在本仓直接运行。本仓采用「能在 git/CI 层强制的（密钥文件、临时文件）落到 pre-commit；其余以 `AGENTS.md` 规则等价承载」的策略，做到最大可落地合规。

## 3. 程序（zcode 4 命令 → 本仓命令）

| zcode 程序 | 本仓落地 | 子代理映射（本仓可用能力） | 状态 |
| --- | --- | --- | --- |
| `arch-review` | `.codebuddy/commands/arch-review.md` | `senior-architect`（zcode 为 `core-architect`） | 🔧 本轮落地 |
| `review` | `.codebuddy/commands/review.md` | `core-code-reviewer` | 🔧 本轮落地 |
| `security-scan` | `.codebuddy/commands/security-scan.md` | `core-security-auditor` | 🔧 本轮落地 |
| `test-gap` | `.codebuddy/commands/test-gap.md` | `core-test-engineer` | 🔧 本轮落地 |

## 4. 既有合规资产（确认已具备，未改动）

| 资产 | 路径 | 说明 |
| --- | --- | --- |
| 密钥扫描 | `.gitleaks.toml` + `.pre-commit-config.yaml`(gitleaks) | 已针对本栈调优 |
| 基础 pre-commit | `.pre-commit-config.yaml` | check-yaml/json/toml/merge-conflict/case-conflict/eof/trailing-whitespace/line-ending/private-key + eslint |
| CI 门禁 | `.github/workflows/ci.yml` | backend(ruff/mypy/pytest+coverage/migrations) + frontend + `pre-commit/action@v3.0.1`(已跑全部钩子) |
| AQG | `.aqg/code-construction/` | 已接入代码施工六步 |
| 版本/本地 CI | `scripts/check-version.sh` `scripts/ci_local.sh` `scripts/smoke.sh` `scripts/doctor.sh` | 既有验证入口 |

## 5. 本轮新增/改动文件清单

| 文件 | 类型 | 说明 |
| --- | --- | --- |
| `AGENTS.md` | 新增（本地） | 12+ 节纪律适配本栈；按 `.gitignore:87` 既有约定不入库，仅本机生效 |
| `.codebuddy/commands/arch-review.md` | 新增 | 架构评审命令 |
| `.codebuddy/commands/review.md` | 新增 | 代码评审命令 |
| `.codebuddy/commands/security-scan.md` | 新增 | 安全审计命令 |
| `.codebuddy/commands/test-gap.md` | 新增 | 测试缺口命令 |
| `scripts/hooks/no_junk_files.py` | 新增 | cleanup-check 等效守卫 |
| `scripts/hooks/no_secret_files.py` | 新增 | guard-write 等效守卫 |
| `.pre-commit-config.yaml` | 改动 | 追加 `no-junk-files` + `no-secret-files` 本地钩子 |
| `docs/zcode-compliance.md` | 新增 | 本对照表 |

## 6. 仍待补齐（已知差距，非本轮范围）

- `skill-router` 技能未装入本仓（依赖 zcode 本地路径）；如需本仓内路由可单独立项。
- 纯代理运行时能力（记忆注入、stop-guard 阻断、prompt-polish 注入）需运行 zcode 客户端的会话才生效；本仓已用 `AGENTS.md` 规则承载其等价要求。
- 危险命令拦截（`guard-bash` 的 14 条）目前仅以文档约束，未做 CI 层机械拦截（CI 不执行危险 bash，风险低）。
