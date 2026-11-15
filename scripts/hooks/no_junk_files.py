#!/usr/bin/env python3
"""Pre-commit guard: block committing transient/backup files.

Equivalent of zcode hook ``cleanup-check.js`` (TMP_PATTERNS). It only inspects
the staged files passed by pre-commit (positional argv). With no args it exits 0.

Patterns mirror zcode/hooks/lib (cleanup-check.js TMP_PATTERNS) so the two
repos enforce the same "no leftover temp files in history" rule.
"""

import re
import sys

TMP_PATTERNS = [
    re.compile(r"\.tmp$", re.I),
    re.compile(r"\.temp$", re.I),
    re.compile(r"\.bak$", re.I),
    re.compile(r"\.bak-\d", re.I),
    re.compile(r"\.orig$", re.I),
    re.compile(r"\.rej$", re.I),
    re.compile(r"~$"),
    re.compile(r"\.swp$", re.I),
    re.compile(r"\.log$", re.I),
    re.compile(r"\.old$", re.I),
    re.compile(r"\.copy$", re.I),
    re.compile(r"^(tmp|temp|test|debug|scratch|try)[-_].*\.(js|mjs|py|ts|json|txt|md|sh)$", re.I),
]


def _norm(p):
    return p.replace("\\", "/")


def _in_test_dir(f):
    # 跳过约定测试目录：本仓 662 个后端测试在 apps/backend/tests/，
    # 误伤会阻断整个测试套件；真正的临时脚本通常散落在根或临时目录。
    return "tests" in _norm(f).split("/") or "test" in _norm(f).split("/")


def _is_governance_command(f):
    # .codebuddy/commands/ 是仓库治理命令（test-gap.md 等），文件名前缀
    # 会命中下面的临时脚本正则，属于误伤。
    return _norm(f).startswith(".codebuddy/commands/")


def main(argv):
    files = argv[1:]
    if not files:
        return 0
    hits = [
        f
        for f in files
        if not _in_test_dir(f)
        and not _is_governance_command(f)
        and any(p.search(f.split("/")[-1]) for p in TMP_PATTERNS)
    ]
    if not hits:
        return 0
    print("【no-junk-files】检测到临时/备份文件，禁止提交：")
    for f in hits:
        print("  · " + f)
    print("\n请删除或 git restore --staged 后重新提交；构建产物请用项目 clean 脚本清理。")
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
