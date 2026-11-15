# 获取帮助

Rubbish 仍处于 pre-alpha 阶段,以下是获取帮助与反馈问题的几种途径,请按顺序尝试。

## 1. 先读文档

| 想了解 | 看这里 |
|---|---|
| 项目定位、模块、快速开始 | [README](README.md) |
| 架构契约、租户隔离、模块依赖 | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| 邮件后端 / OIDC SSO 接入 | [docs/integrations.md](docs/integrations.md) |
| 配置项完整列表 | [`apps/backend/app/core/config.py`](apps/backend/app/core/config.py) |
| 贡献流程 | [CONTRIBUTING.md](CONTRIBUTING.md) |
| 安全策略 | [SECURITY.md](SECURITY.md) |

## 2. 搜索已有 issue

提问前请先在 GitHub 的 issue 列表搜索关键词,可能已经有人问过同样的问题。

## 3. 提 issue

如果文档没解答你的问题,请按下面的类型选择对应的入口:

- **Bug 报告 / 功能请求** → 使用仓库的 issue 模板
- **安全漏洞** → 不要公开提 issue,见 [SECURITY.md](SECURITY.md) 私密上报流程
- **使用疑问 / 设计讨论** → issue 加 `question` 标签

提 issue 时请尽量提供:

- 复现步骤(尽量小而清晰)
- 期望行为 / 实际行为
- 环境(OS、Python / Node 版本、Docker 版本、是否生产部署)
- 相关日志或截图

## 4. 授权与商用

本仓库采用 [MIT License](LICENSE),允许商业与非商业用途,无需单独授权。
