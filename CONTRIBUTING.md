# 🤝 贡献指南

感谢你对 ScholarLib-CS 的关注！本文档将帮助你快速了解如何为本仓库贡献论文。

## 📋 贡献前必读

- 请确保上传的论文具有 **合法的分发权限**（优先选择开放获取论文）
- 请勿上传受严格版权保护的付费论文全文
- 每次提交请控制在 **合理范围内**（建议每次 PR 不超过 20 篇论文）

## 📝 论文命名规范

所有论文 PDF 文件名遵循以下格式：

```
FirstAuthor-YYYY-ShortTitle.pdf
```

| 部分 | 说明 | 示例 |
|------|------|------|
| FirstAuthor | 第一作者姓氏 | Vaswani |
| YYYY | 发表年份 | 2017 |
| ShortTitle | 论文标题简写（首字母大写，无空格） | AttentionIsAllYouNeed |

**完整示例：**
- ✅ `Vaswani-2017-AttentionIsAllYouNeed.pdf`
- ✅ `He-2016-DeepResidualLearning.pdf`
- ✅ `Devlin-2019-BERT.pdf`
- ❌ `attention is all you need.pdf`
- ❌ `paper1.pdf`
- ❌ `2017_transformer.pdf`

## 📂 文件放置规则

1. 确定论文所属的 **主题目录**（如 `Deep-Learning/`）
2. 确定论文的 **发表年份**（如 `2024/`）
3. 将 PDF 放入对应路径：`Deep-Learning/2024/`
4. 更新该年份目录下的 `README.md`

## 🔄 PR 提交流程

1. **Fork** 本仓库
2. 创建分支：`git checkout -b add/papers-topic-year`
3. 添加论文 PDF 到对应目录
4. 更新目录下的 `README.md` 论文列表
5. 提交：`git commit -m "docs: add X papers to Topic/Year"`
6. 推送：`git push origin add/papers-topic-year`
7. 创建 **Pull Request**

## ❓ 常见问题

**Q: 我不确定论文属于哪个主题？**
A: 选择最相关的主题即可。如果确实难以归类，可以提交 Issue 讨论。

**Q: 论文是 2018 年的，应该放在哪里？**
A: 放在对应主题的 `2019-and-earlier/` 目录下。

**Q: 我只有论文链接没有 PDF，怎么办？**
A: 可以在对应年份的 README.md 中添加链接，格式为：
```
- [论文标题](链接) — 作者, 发表于 *会议/期刊*
```

---

感谢你的贡献！每一篇论文的添加都在帮助更多的 CS 研究者！🎉
