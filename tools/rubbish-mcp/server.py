#!/usr/bin/env python3
"""Rubbish MCP server (stdio, stdlib only).

This is a thin bridge, not a second API. It pulls the tool manifest and
forwards calls to the site, so the server-side role gates, rules
acknowledgement, moderation, similarity, quality scoring and audit all run
exactly as they do in the web UI.

Environment:
  RUBBISH_API_TOKEN   required, personal token from 设置 → AI 接入
  RUBBISH_BASE_URL    default https://rubbish.argjiemi.cn

Usage (Claude Desktop / Cursor / any MCP client):
  {
    "mcpServers": {
      "rubbish": {
        "command": "python3",
        "args": ["/abs/path/tools/rubbish-mcp/server.py"],
        "env": {"RUBBISH_API_TOKEN": "rbk_..."}
      }
    }
  }
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from typing import Any

PROTOCOL_VERSION = "2024-11-05"
SERVER_VERSION = "1.1.0"
BASE_URL = os.environ.get("RUBBISH_BASE_URL", "https://rubbish.argjiemi.cn").rstrip("/")
TOOLS_URL = f"{BASE_URL}/api/ai/tools"
CALL_URL = f"{BASE_URL}/api/ai/tools/call"
TOKEN = os.environ.get("RUBBISH_API_TOKEN", "").strip()

_cached_tools: list[dict[str, Any]] | None = None


def _request(method: str, url: str, payload: dict[str, Any] | None = None) -> Any:
    if not TOKEN:
        raise RuntimeError("RUBBISH_API_TOKEN 未设置；请到站点 设置 → AI 接入 创建个人 Token")
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("X-API-Key", TOKEN)
    req.add_header("Content-Type", "application/json")
    req.add_header("Accept", "application/json")
    req.add_header("User-Agent", "rubbish-mcp/1.1")
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", "replace")
        try:
            detail = json.loads(body).get("detail", body)
        except Exception:
            detail = body
        raise RuntimeError(f"HTTP {exc.code}: {detail}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"无法连接 {url}: {exc.reason}") from exc


def _fetch_tools() -> list[dict[str, Any]]:
    global _cached_tools
    try:
        payload = _request("GET", TOOLS_URL)
        tools = payload.get("tools")
        if isinstance(tools, list):
            _cached_tools = tools
            return tools
    except Exception as exc:
        print(f"[rubbish-mcp] tools/list failed: {exc}", file=sys.stderr)
    return _cached_tools or []


def _text_result(value: Any, *, is_error: bool = False) -> dict[str, Any]:
    if isinstance(value, str):
        text = value
    else:
        text = json.dumps(value, ensure_ascii=False, indent=2)
    return {"content": [{"type": "text", "text": text}], "isError": is_error}


def call_tool(name: str, arguments: dict[str, Any]) -> dict[str, Any]:
    if not name:
        return _text_result("tools/call 缺少 name", is_error=True)
    try:
        payload = _request("POST", CALL_URL, {"name": name, "arguments": arguments or {}})
    except Exception as exc:
        return _text_result(f"调用失败：{exc}", is_error=True)
    if not isinstance(payload, dict):
        return _text_result({"error": "网关返回格式异常"}, is_error=True)
    return {
        "content": payload.get("content") or [{"type": "text", "text": "（空结果）"}],
        "isError": bool(payload.get("isError")),
    }


def _error(msg_id: Any, code: int, message: str, data: Any = None) -> dict[str, Any]:
    error: dict[str, Any] = {"code": code, "message": message}
    if data is not None:
        error["data"] = data
    return {"jsonrpc": "2.0", "id": msg_id, "error": error}


def handle(message: dict[str, Any]) -> dict[str, Any] | None:
    method = message.get("method")
    msg_id = message.get("id")
    if method == "initialize":
        return {
            "jsonrpc": "2.0",
            "id": msg_id,
            "result": {
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": {"tools": {"listChanged": True}},
                "serverInfo": {"name": "rubbish-mcp", "version": SERVER_VERSION},
                "instructions": (
                    "Rubbish 学术社区 MCP。先 get_context / get_editorial_rules；"
                    "投稿前 preflight_submission；审稿用 get_review_task 与 submit_review_report；"
                    "编辑决定必须带 expected_status 与 expected_latest_version。"
                ),
            },
        }
    if method in ("notifications/initialized", "notifications/cancelled"):
        return None
    if method == "ping":
        return {"jsonrpc": "2.0", "id": msg_id, "result": {}}
    if method == "tools/list":
        return {"jsonrpc": "2.0", "id": msg_id, "result": {"tools": _fetch_tools()}}
    if method == "tools/call":
        params = message.get("params") or {}
        name = str(params.get("name") or "")
        arguments = params.get("arguments") or {}
        if not isinstance(arguments, dict):
            return _error(msg_id, -32602, "tools/call arguments 必须是对象")
        return {"jsonrpc": "2.0", "id": msg_id, "result": call_tool(name, arguments)}
    if method == "resources/list":
        return {"jsonrpc": "2.0", "id": msg_id, "result": {"resources": []}}
    if method == "prompts/list":
        return {"jsonrpc": "2.0", "id": msg_id, "result": {"prompts": []}}
    if msg_id is None:
        return None
    return _error(msg_id, -32601, f"Method not found: {method}")


def main() -> None:
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            message = json.loads(line)
        except json.JSONDecodeError as exc:
            reply = _error(None, -32700, f"Parse error: {exc.msg}")
        else:
            if isinstance(message, list):
                reply = [_error(None, -32600, "Batch requests are not supported")]
            elif not isinstance(message, dict):
                reply = _error(None, -32600, "Invalid Request")
            else:
                reply = handle(message)
        if reply is not None:
            sys.stdout.write(json.dumps(reply, ensure_ascii=False) + "\n")
            sys.stdout.flush()


if __name__ == "__main__":
    main()
