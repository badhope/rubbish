# Rubbish MCP

Rubbish 的个人 Token 接入层。远程和本地共用同一套工具清单，底层调用站内现有接口，不复制权限逻辑。

## 能做什么

- 作者：查规范、确认规范、干跑检查、投稿（正文直接进 v1 快照）、改题录、保存正文、修回重投、逐条回应、撤稿。
- 互评：看任务与匿名稿、接受/拒绝邀请、提交五维（荒诞刊为六维）报告。
- 编辑：看四栏工作台、基础检查队列、候选人、基础检查、指派、时间线、互评报告。
- 终审：通过 / 小改 / 大改 / 不通过；必须带 `expected_status` 与 `expected_latest_version`，角色不够会被拒。

## 严格闸门

- Token 只存 SHA-256，明文只返回一次；作用域不能超过账号真实角色，调用时角色还会再验一次。
- 投稿必须 `confirm=true`、`idempotency_key` 和正文（或文件/外链），并先确认当前规范版本；敏感词、站内相似度、v1 快照与积分照常执行。
- 互评报告每维必须有评分理由和正文证据；编辑决定必须防陈旧，返修直接录用与低于 40 分破例仍走原有硬门槛。
- 所有关键写操作写审计；MCP 不是绕过站内规则的后门。

## 远程接入（推荐）

在站点 `设置 → AI 接入` 创建 Token，作用域按身份勾选。客户端配置：

```json
{
  "mcpServers": {
    "rubbish": {
      "type": "http",
      "url": "https://rubbish.argjiemi.cn/api/mcp",
      "headers": { "Authorization": "Bearer rbk_..." }
    }
  }
}
```

也支持 `X-API-Key: rbk_...`。端点说 JSON-RPC 2.0，`initialize` / `tools/list` / `tools/call` / `ping` 可用；暂不提供 SSE。

## 本地 stdio

```json
{
  "mcpServers": {
    "rubbish": {
      "command": "python3",
      "args": ["/abs/path/tools/rubbish-mcp/server.py"],
      "env": {
        "RUBBISH_API_TOKEN": "rbk_...",
        "RUBBISH_BASE_URL": "https://rubbish.argjiemi.cn"
      }
    }
  }
}
```

stdio 服务只做代理：工具清单从 `/api/ai/tools` 拉取，调用转发到 `/api/ai/tools/call`，客户端不需要跟着后端 schema 漂移。

## 推荐顺序

1. `get_context` 看角色、Token 作用域、规范确认状态。
2. `get_editorial_rules`；必要时 `acknowledge_rules`（必须用户明确授权代确认）。
3. 作者：`preflight_submission` → `submit_paper` → `list_my_submissions`。
4. 互评：`list_my_review_assignments` → `get_review_task` → `accept_review_assignment` → `submit_review_report`。
5. 编辑：`get_editor_workbench` / `list_triage_queue` → `triage_submission` / `assign_reviewer` → `get_submission_reports` → `decide_submission`。

## 故障排查

- 401：Token 撤销/过期，或请求没带 `Authorization` / `X-API-Key`。
- 403 `missing_scope`：到设置页给这个 Token 加作用域，或按角色新建。
- 403 `role_required`：账号真实角色不够，Token 作用域不能替代角色。
- 409 `stale_decision`：作品状态或版本变了，重新读时间线/报告再决定。
