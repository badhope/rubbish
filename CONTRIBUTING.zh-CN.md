# 贡献指南

**[English](CONTRIBUTING.md) · 简体中文**

谢谢你来帮忙。改动尽量小，把原因说清楚，让仓库比你接手时更好跑。

## 流程

1. Fork 仓库，从 `main` 拉一个分支。
2. 一次只做一件事。代码、测试、文档放在同一个分支里。
3. 跑下面的检查。
4. 提交 Pull Request。写清楚要解决什么问题、改了什么、哪些地方没验证。
5. 维护者审核；合并后删除分支。

分支前缀用 `feat/`、`fix/`、`docs/`、`refactor/`、`chore/`。不要对共享分支强推。

## 检查

```bash
cd apps/backend
uv run ruff check .
uv run mypy app --exclude 'app/domain/submission' --exclude 'app/domain/ingest' \
  --exclude 'app/interfaces/http/submission' --exclude 'app/interfaces/http/review'
uv run pytest -q

cd ../frontend
npm run lint
npm run typecheck
npm run build
```

被排除的后端目录是已停用的编辑流程代码，只保留给档案转换和备份使用，不参与线上产品。

## 提交信息

短句、祈使语气：

```text
feat(forum): 发帖弹窗自动选中默认版块
fix(auth): 刷新 Cookie 保持在 API 域名
docs(deploy): 写清非超级用户数据库角色
```

版本号是 `MAJOR.MINOR.PATCH`。最后一位用于修复，中间一位用于用户可见的新功能。改版本时同时更新 `package.json`、`pyproject.toml`、`app/__init__.py`、`uv.lock` 和 `CHANGELOG.md`。

## Pull Request

一个好的 PR：

- 有能复现的理由，不只是一张截图；
- 修 bug 或加行为时补了测试；
- 不夹带无关的格式化改动；
- 不提交密钥、`.env`、数据库明文导出或明文上传包；
- 写清楚哪些检查通过，哪些跳过。

## 内容与治理

公开文案、版块名称、治理规则的改动，遵循 [docs/POSITIONING.zh-CN.md](docs/POSITIONING.zh-CN.md)。不要把期刊、投稿、审稿那套词重新带回用户页面。

## 许可

提交贡献即表示你同意按仓库的 [PolyForm Noncommercial License 1.0.0](LICENSE) 发布。
