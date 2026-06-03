# 贡献指南

感谢你对 ScholarLib 的关注！🎉
本文档将帮助你快速了解如何为本项目做出贡献。

## 目录

- [行为准则](#行为准则)
- [我能贡献什么？](#我能贡献什么)
- [快速上手](#快速上手)
- [添加论文](#添加论文)
- [修正或改进论文条目](#修正或改进论文条目)
- [添加新主题](#添加新主题)
- [改进文档站点](#改进文档站点)
- [添加新语言](#添加新语言)
- [提交代码变更](#提交代码变更)
- [PR 检查清单](#pr-检查清单)
- [代码风格](#代码风格)

## 行为准则

本项目遵守[贡献者公约](CODE_OF_CONDUCT.md)。
参与即表示你同意遵守其原则。如遇不当行为，请通过
[SECURITY.md](SECURITY.md) 报告。

## 我能贡献什么？

| 类型                  | 难度        | 位置                      |
| --------------------- | ----------- | ------------------------- |
| 添加论文              | ⭐ 简单     | `papers/<section>/...`    |
| 修复错别字 / 失效链接 | ⭐ 简单     | `papers/` 任意位置        |
| 改进元数据            | ⭐ 简单     | `papers/**/metadata.json` |
| 翻译页面              | ⭐⭐ 中等   | `docs/<locale>/`          |
| 添加新主题            | ⭐⭐ 中等   | 新建文件夹 + 更新配置     |
| 添加新脚本            | ⭐⭐⭐ 困难 | `scripts/` + 测试 + 文档  |
| CI / 构建改进         | ⭐⭐⭐ 困难 | `.github/workflows/`      |

## 快速上手

### 1. Fork 和克隆

```bash
# 在 GitHub 上点击 "Fork"，然后：
git clone https://github.com/YOUR-USERNAME/ScholarLib.git
cd ScholarLib
```

### 2. 安装依赖

```bash
make init        # 安装 npm + 提示可选的 pip 包
# 或：npm install
```

可选的 Python 包（用于完整功能）：

```bash
pip install requests beautifulsoup4 pillow cairosvg anthropic
```

### 3. 启动开发服务器

```bash
make dev
# 打开 http://localhost:5173 ，支持热更新
```

### 4. 创建分支

```bash
git checkout -b add/papers-ml-2025-attention-is-all-you-need
```

前缀建议：`add/`、`fix/`、`docs/`、`refactor/`、`ci/`、`i18n/`。

## 添加论文

> **重要：** 仅提交你有权利分发的论文。
> 所有论文必须是 **开放获取** 或有明确再分发许可（如 arXiv 预印本、CC-BY 期刊文章）。

### 第 1 步：确定路径

路径布局取决于论文所属板块：

**计算机科学**（`papers/computer-science/`）：

```
papers/computer-science/<主题>/<年份>/<论文-kebab-名称>/
```

例如：

```
papers/computer-science/Machine-Learning/2017/Vaswani-2017-AttentionIsAllYouNeed/
```

**经济与管理**（`papers/economics-management/`）：

```
papers/economics-management/<年份>/<领域>/<主题>/<期刊级别>/<方法>/<场景>/<论文-kebab-名称>/
```

例如：

```
papers/economics-management/2025/finance/asset-pricing/FT50-UTD24/empirical/cross-country/fama-french-five-factor/
```

完整分类见 `.scholarlib.yaml`。

### 第 2 步：复制模板

```bash
cp -r templates/paper-template papers/<your-path>
```

### 第 3 步：填写文件

#### `metadata.json`（必需）

```json
{
  "title": "Attention Is All You Need",
  "authors": ["Vaswani, Ashish", "Shazeer, Noam"],
  "year": 2017,
  "journal": "NeurIPS",
  "doi": "10.5555/3295222.3295349",
  "url": "https://papers.nips.cc/paper/7181-attention-is-all-you-need",
  "abstract": "我们提出了一种新的简单网络架构——Transformer……",
  "keywords": ["transformer", "attention", "neural networks"],
  "category": "machine-learning",
  "submitted_by": "你的-github-用户名",
  "date_added": "2026-06-02"
}
```

#### `<论文名>.bib`（必需）

```bibtex
@inproceedings{vaswani2017attention,
  title   = {{Attention Is All You Need}},
  author  = {Vaswani, Ashish and Shazeer, Noam and Parmar, Niki},
  booktitle = {NeurIPS},
  year    = {2017},
  doi     = {10.5555/3295222.3295349},
  url     = {https://papers.nips.cc/paper/7181-attention-is-all-you-need}
}
```

#### `paper.pdf`（必需）

将全文 PDF 放入同一目录。如果 PDF 较大（>5 MB），`.gitattributes` 中
已配置 Git LFS，会自动处理。

### 第 4 步：验证

```bash
make validate
```

这会检查 schema、kebab-case 文件夹名、缺失文件等。

### 第 5 步：更新主题页（仅 CS）

对于 CS 论文，请在 `docs/papers/computer-science/<topic>.md` 中添加
条目，使论文出现在侧边栏表格中：

```markdown
| 标题                                                    | 年份 | 作者       | 链接                                                                                                 |
| ------------------------------------------------------- | ---: | ---------- | ---------------------------------------------------------------------------------------------------- |
| [Attention Is All You Need](https://papers.nips.cc/...) | 2017 | Vaswani 等 | [PDF](../papers/computer-science/Machine-Learning/2017/Vaswani-2017-AttentionIsAllYouNeed/paper.pdf) |
```

EM 论文的索引页是自动生成的，但你可以手动更新
`docs/papers/economics-management/` 中的年份/领域索引。

### 第 6 步：提交并推送

```bash
git add papers/ docs/
git commit -m "papers: add Vaswani 2017 Attention Is All You Need"
git push origin add/papers-ml-2017-attention
```

## 修正或改进论文条目

小修改无需开 issue，直接发 PR 即可：

- **标题或摘要错别字** → 编辑 `.md` 或 `metadata.json`
- **缺失 DOI** → 在 `metadata.json` 和 `.bib` 中都加上
- **错误的年份** → 修正 metadata 和 `.bib`
- **缺失 PDF** → 添加 PDF（或运行 `python3 scripts/recover_pdfs.py`）

## 添加新主题

CS 主题由 `build_sidebar.py` 自动发现。添加步骤：

1. 创建 `papers/computer-science/<新主题>/`（使用 Title-Case-With-Dashes）
2. 在 `build_sidebar.py` 的 `CS_PRETTY` 中添加 pretty name
3. 在 `.scholarlib.yaml` 的 `computer_science_topics` 中添加
4. 创建 `docs/papers/computer-science/<新主题>.md`（使用 kebab-case slug）
5. 运行 `make sidebar` 重新生成侧边栏
6. 发起 PR

EM 领域也会自动发现，但你仍应将其添加到 `.scholarlib.yaml` 的
`economics_management_fields`，并添加 `docs/papers/economics-management/<领域>.md` 概览。

## 改进文档站点

站点使用 VitePress 1.6 构建。所有内容在 `docs/` 中。

- **首页** — `docs/index.md`（使用 `layout: home`）
- **关于** — `docs/about.md`
- **主题页** — `docs/papers/computer-science/<主题>.md`
- **引用图谱** — `docs/citation-graph.md`（自动生成）
- **404** — `docs/404.md`
- **架构** — `docs/architecture.md`

添加新文档时，请遵循现有风格：简洁引言、论文表格（如适用）、"如何贡献"章节。

## 添加新语言

我们欢迎翻译！目前支持英语（根）和 简体中文。要添加新语言：

1. 创建 `docs/<lang>/`（使用 [BCP 47](https://tools.ietf.org/html/bcp47) 标签）
2. 翻译：
   - `docs/index.md` → `docs/<lang>/index.md`
   - `docs/about.md` → `docs/<lang>/about.md`
   - 论文概览页（参考英文版本）
3. 更新 `docs/.vitepress/config.ts`：
   ```ts
   locales: {
     ...
     <lang>: {
       label: '你的语言',
       lang: '<bcp47>',
       description: '...',
       themeConfig: { nav: [...] },
     },
   }
   ```
4. 构建并视觉验证：`make build && make preview`
5. 发起 PR

注：我们不翻译每篇具体论文页——论文内容在各种语言中基本一致，
且贡献者应能阅读英文摘要。仅翻译站点的界面文字。

## 提交代码变更

对于非内容变更（脚本、CI、主题）：

1. **先讨论** — 大改动请先开 issue 或 discussion
2. **添加测试** — `scripts/` 中每个 Python 脚本都应在 `tests/` 中有测试
3. **本地运行 `make ci`** 再推送
4. **更新 CHANGELOG.md** 的 `[Unreleased]` 部分

## PR 检查清单

发起 PR 前请确认：

- [ ] `make ci` 本地通过
- [ ] `make validate` 无错误（警告可接受）
- [ ] 新论文条目所有必需字段齐全
- [ ] 文件夹名使用 kebab-case（`my-paper-name`）
- [ ] `.bib` 的 cite key 与文件夹名一致
- [ ] PR 标题遵循 [Conventional Commits](https://www.conventionalcommits.org/)：
  ```
  papers: add Vaswani 2017 Attention
  fix: broken link in CS index
  docs: clarify contributing guide
  ci: add python 3.13 to test matrix
  i18n: add Spanish translation
  ```
- [ ] CHANGELOG.md `[Unreleased]` 已更新
- [ ] 如添加了脚本，已在 `tests/` 中添加测试
- [ ] 如改了侧边栏/结构，已运行 `make sidebar` 和 `make build`

## 代码风格

### Markdown

- ATX 风格标题（`#`、`##` ...）
- 段落之间空一行
- 使用 `[link text](url)` 而非 `<a href>`
- 表格首尾带 `|`
- 论文引用使用 `[Author Year]` → 链接到本地 `paper.pdf`

### Python

- Python 3.10+ 语法
- 优先用 `pathlib.Path`
- 必要时使用类型提示
- 公共函数有 docstring
- 顶层定义之间空一行
- 导入位于顶部，按 stdlib → 第三方 → 本地排序

### TypeScript

- 严格模式（`tsconfig.json` 强制）
- 类型导入使用 `import type`
- 2 空格缩进
- 除非绝对必要，避免 `any`

### 提交

- 每次提交一个逻辑变更
- 命令式语气："add feature" 而非 "added feature"
- 提交说明解释 **为什么**，不是 **做了什么**（diff 自带做了什么）

## 获取帮助

- **一般问题** — [GitHub Discussions](https://github.com/badhope/ScholarLib/discussions)
- **Bug 报告** — [Bug 报告模板](.github/ISSUE_TEMPLATE/bug_report.md)
- **功能请求** — [功能请求模板](.github/ISSUE_TEMPLATE/feature_request.md)
- **论文提交** — [论文提交模板](.github/ISSUE_TEMPLATE/new_paper.md)
- **安全问题** — 见 [SECURITY.md](SECURITY.md)（请勿公开提 issue）

## 致谢

贡献者会列在 GitHub 贡献者图中，并在发布说明中致谢。重要贡献者
可能会被邀请成为协作者。

---

感谢你帮助让学术研究更加开放！📚
