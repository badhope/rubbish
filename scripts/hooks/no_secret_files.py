#!/usr/bin/env python3
"""Pre-commit guard: block committing credential/key files by name.

Equivalent of zcode hook ``guard-write.js`` (SECRET_FILE_PATTERNS /
SECRET_DIR_PATTERNS). This catches secret *filenames* even when the content is
benign (gitleaks only inspects content). It inspects staged files passed by
pre-commit (positional argv); with no args it exits 0.
"""

import re
import sys

SECRET_FILE_PATTERNS = [
    re.compile(r"(^|[/\\])\.env(\.|$)", re.I),
    re.compile(r"(^|[/\\])\.env\.[\w.-]+$", re.I),
    re.compile(r"\.pem$", re.I),
    re.compile(r"\.p12$", re.I),
    re.compile(r"\.pfx$", re.I),
    re.compile(r"\.key$", re.I),
    re.compile(r"\.keystore$", re.I),
    re.compile(r"\.jks$", re.I),
    re.compile(r"(^|[/\\])id_rsa(\.pub)?$", re.I),
    re.compile(r"(^|[/\\])id_ed25519(\.pub)?$", re.I),
    re.compile(r"(^|[/\\])\.netrc$", re.I),
    re.compile(r"(^|[/\\])\.npmrc$", re.I),
    re.compile(r"(^|[/\\])\.pypirc$", re.I),
    re.compile(r"(^|[/\\])credentials(\.json)?$", re.I),
    re.compile(r"(^|[/\\])secrets?(\.json)?$", re.I),
    re.compile(r"(^|[/\\])accounts\.json$", re.I),
    re.compile(r"(^|[/\\])service[_-]?account[\w.-]*\.json$", re.I),
    re.compile(r"(^|[/\\])tokens?\.json$", re.I),
]

SECRET_DIR_PATTERNS = [
    re.compile(r"(^|[/\\])\.ssh([/\\]|$)", re.I),
    re.compile(r"(^|[/\\])\.aws([/\\]|$)", re.I),
    re.compile(r"(^|[/\\])\.gnupg([/\\]|$)", re.I),
    re.compile(r"(^|[/\\])secrets([/\\]|$)", re.I),
    re.compile(r"(^|[/\\])keystore([/\\]|$)", re.I),
]


def _norm(p):
    return p.replace("\\", "/")


# 允许提交的样例环境文件（与 .gitignore 的 !.env.example 及 .gitleaks.toml 白名单一致）。
SAFE_ENV_SAMPLES = {".env.example", ".env.sample"}


def main(argv):
    files = argv[1:]
    if not files:
        return 0
    hits = []
    for f in files:
        n = _norm(f)
        base = n.split("/")[-1]
        if base in SAFE_ENV_SAMPLES:
            continue
        if any(p.search(n) for p in SECRET_FILE_PATTERNS) or any(p.search(n) for p in SECRET_DIR_PATTERNS):
            hits.append(f)
    if not hits:
        return 0
    print("【no-secret-files】检测到凭据/密钥文件，禁止提交：")
    for f in hits:
        print("  · " + f)
    print("\n凭据应通过 .env（已 gitignore）+ 服务器密钥管理；确需提交的非敏感样例请用 .env.example。")
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
