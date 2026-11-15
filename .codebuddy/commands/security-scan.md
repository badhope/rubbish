---
description: 对当前项目做安全审计
argument-hint: [可选: 聚焦区域]
allowed-tools: Read, Glob, Grep, Bash(git diff:*), Bash(git status:*)
---
调用 core-security-auditor 子代理，对当前代码库执行完整安全审计。$ARGUMENTS
按安全类别输出发现（注入/密钥/授权/SSRF/依赖），每条含 文件:行号、攻击场景、修复方案。结尾附"已检查类别"清单。
