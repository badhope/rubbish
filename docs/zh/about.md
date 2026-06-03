---
title: 关于
aside: true
---

# 关于 ScholarLib

一个精选的、开放获取的计算机科学、经济学与管理学论文库。浏览、搜索、引用 —— 无需付费墙。

## 使命

ScholarLib 致力于解决学术工作中的三个老大难问题：

1. **发现** —— 找到一个领域最重要的论文很困难。Google Scholar 杂音太多，arXiv 未经筛选，大多数期刊网站把论文藏在付费墙后面。
2. **获取** —— 好不容易找到一篇论文，没有机构登录往往拿不到全文。
3. **引用** —— 正确引用论文繁琐又容易出错，缺少字段会搞乱你的参考文献列表。

ScholarLib 提供精选、有序、可下载的开放获取论文 —— 附带即拿即用的 BibTeX 引用。

## 历史

ScholarLib 由一个早期经济与管理项目合并而成：

- **[ScholarLib-EM](https://github.com/badhope/ScholarLib-EM)** —— 经济与管理论文库（18 个领域，2020 – 2026）。2026 年合并。

旧 EM 仓库现已归档。其内容已迁移至统一的目录结构：

```
papers/
├── computer-science/      # 33 个 CS 主题，按 主题 → 年份 组织
└── economics-management/  # 18 个 EM 领域，按 年份 → 领域 组织
```

## 许可证

ScholarLib 基于 [MIT 许可证](https://github.com/badhope/ScholarLib/blob/main/LICENSE) 发布。各篇论文保留各自的许可证 —— 二次分发前请查看论文的元数据。

## 贡献指南

欢迎提交新论文、修复错别字、纠正元数据以及提出主题建议。

**贡献前**请先阅读 [CONTRIBUTING.md](https://github.com/badhope/ScholarLib/blob/main/CONTRIBUTING.md)。

**快速上手：**

1. 将论文添加到 `papers/` 目录下对应的主题文件夹
2. 附带 `.bib` 引用文件和 `metadata.json`（参见模板）
3. 发起 Pull Request

**工具：**

- 使用 [论文提交模板](https://github.com/badhope/ScholarLib/issues/new?template=new_paper.md) 推荐论文
- 使用 [Bug 报告模板](https://github.com/badhope/ScholarLib/issues/new?template=bug_report.md) 反馈链接失效或网站问题
- 使用 [功能请求模板](https://github.com/badhope/ScholarLib/issues/new?template=feature_request.md) 提出新想法

## 维护者

由 [@badhope](https://github.com/badhope) 维护。

## 赞助

如果 ScholarLib 对你的研究有帮助，欢迎支持开发：

- GitHub 赞助者：[@badhope](https://github.com/sponsors/badhope)
- Open Collective：[badhope/scholarlib](https://opencollective.com/scholarlib)

## 技术栈

- **[VitePress 1.6](https://vitepress.dev/)** —— 文档站点生成器
- **[GitHub Actions](https://github.com/features/actions)** —— CI/CD
- **[Lychee](https://github.com/lycheeverse/lychee)** —— 链接检查器
- **[Lighthouse CI](https://github.com/GoogleChrome/lighthouse-ci)** —— 性能、无障碍、SEO 审计
- **[Dependabot](https://github.com/dependabot)** —— 自动依赖更新

## 致谢

- [VitePress](https://vitepress.dev/) 提供了出色的静态站点生成器
- [GitHub Pages](https://pages.github.com/) 提供了免费托管
- 所有论文作者和贡献者，是你们让这个论文库成为可能
