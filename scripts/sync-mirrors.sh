#!/usr/bin/env bash
# 把核心仓库的状态单向同步到全部镜像。
#
# 主从关系（务必遵守，2026-10-18 治理确认）：
#   核心仓库（badhope 账号，三处同权）：
#     - origin      = GitCode/badhope        ← 提交真源（append-only，平台禁止 force push）
#     - gh-badhope  = GitHub/badhope         ← 受分支保护，必须走 PR 合入，禁止直推：
#                                              required checks=backend/migrations/frontend/
#                                              e2e/precommit/security/docker-build，
#                                              strict+线性历史+enforce_admins。
#                                              流程：git push origin HEAD:refs/heads/sync/<tag>
#                                              → 开 PR → CI 全绿 → rebase merge。
#     - gitee       = Gitee/badhope          ← 镜像（可 force 对齐）
#   只读镜像（其他账号）：
#     - gh-x33834   = GitHub/X33834
#     - gh-morningstar = GitHub/Morningstar202604   ← token 需 repo scope，失效则重新生成
#              ← 禁止在镜像上直接提交，否则五平台 HEAD 必然分叉
#
# 认证方式备忘（凭环境变量或 remote URL 内嵌，勿硬编码）：
#   GitCode API:   需 PRIVATE-TOKEN 头或 access_token 查询参数
#                  （Authorization: token 无效，会 401）
#   GitHub/Gitee:  classic PAT 作密码，git push URL 内嵌或凭据助手均可；
#                  Gitee 推送时 URL 内嵌方式最稳
#
# 用法：
#   scripts/sync-mirrors.sh              # 常规同步（快进）
#   scripts/sync-mirrors.sh --force      # 镜像已分叉时用（force-with-lease，安全强推）
#
# 频率控制：每推送一个镜像后 sleep 3 秒，避免触发平台限流。
set -uo pipefail
cd "$(dirname "$0")/.."

BRANCH="${BRANCH:-main}"
FLAG=""
[ "${1:-}" = "--force" ] && FLAG="--force-with-lease"
# gh-badhope 受分支保护不能直推，须走 PR；这里只同步 origin + 真镜像
MIRRORS=(origin gh-x33834 gh-morningstar gitee)

echo "本地 HEAD: $(git rev-parse --short HEAD)  分支: $BRANCH  模式: ${FLAG:-快进}"
echo "提示：gh-badhope 需走 PR 合入（分支保护），不在此脚本范围内"
echo

for r in "${MIRRORS[@]}"; do
    printf '%-16s ' "$r"
    if out=$(timeout 300 git push $FLAG "$r" "$BRANCH" 2>&1); then
        printf 'branch OK  '
    else
        printf 'branch FAIL(%s)  ' "$(echo "$out" | grep -ioE 'authentication failed|invalid username|non-fast-forward|permission denied|unable to access|protected branch' | head -1)"
    fi
    # 标签：v0.2.1 之后统一同步；v1.0.0 是错误标签，遇到就删
    git push -f "$r" "v$(tr -d '[:space:]' < VERSION)" >/dev/null 2>&1 && printf 'tag OK  ' || printf 'tag FAIL  '
    git push "$r" --delete v1.0.0 >/dev/null 2>&1 && printf 'v1.0.0 removed' || printf 'v1.0.0 n/a'
    echo
    sleep 3
done

echo
echo "--- 同步后各远端 HEAD（应全部一致，gh-badhope 走 PR 单独核对）---"
for r in "${MIRRORS[@]}"; do
    printf '%-16s %s\n' "$r" "$(timeout 30 git ls-remote "$r" "$BRANCH" 2>/dev/null | head -1 | cut -c1-10)"
done
echo "本地 HEAD:          $(git rev-parse --short HEAD)"
