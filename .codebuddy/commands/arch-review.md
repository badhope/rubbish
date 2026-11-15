---
description: 让架构师评审当前方案或改动的设计合理性
argument-hint: [方案描述或改动点]
allowed-tools: Read, Glob, Grep, Bash(git diff:*), Bash(git status:*)
---
调用 senior-architect 子代理（zcode 对应 core-architect），以架构师视角评审：$ARGUMENTS
输出：决策合理性评估（通过/有保留/反对+理由）、模块边界与依赖问题、扩展性风险、更优备选方案（如有）。引用具体文件与行号。
