---
description: 对当前 git 改动做结构化代码评审
argument-hint: [可选: 指定文件或关注点]
allowed-tools: Read, Glob, Grep, Bash(git diff:*), Bash(git status:*), Bash(git log:*)
---
调用 core-code-reviewer 子代理，评审当前的 git diff 改动（未提交部分）。$ARGUMENTS
按严重级别分组输出：critical / major / minor，每条含 文件:行号、问题描述、失败场景、最小修复。最后给出一段总体结论。
