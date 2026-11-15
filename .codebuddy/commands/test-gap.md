---
description: 找出测试缺口并补齐关键路径测试
argument-hint: [目标模块]
allowed-tools: Read, Edit, Glob, Grep, Bash(git diff:*), Bash(npx vitest:*), Bash(uv run pytest:*)
---
调用 core-test-engineer 子代理。目标模块：$ARGUMENTS
先扫描现有测试覆盖，列出未覆盖的函数/分支（按风险排序），然后为 top 风险项编写测试并运行验证。报告：新增测试数、通过/失败、剩余缺口。
