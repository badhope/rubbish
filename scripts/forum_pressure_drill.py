#!/usr/bin/env python3
"""Read-only front-door pressure drill for the Rubbish forum.

This script does not write. It measures the public read path that a moderator
and a visitor actually hit: forum list, unified search, catalog list and
explore. Write-path load (50 topic submissions + batch decision) is covered by
``apps/backend/tests/test_forum_moderation_stress.py`` in an isolated DB.

Usage:
    python3 scripts/forum_pressure_drill.py --requests 200 --concurrency 20
    python3 scripts/forum_pressure_drill.py --base-url http://127.0.0.1:8080 \
        --host rubbish.argjiemi.cn --requests 200
"""

from __future__ import annotations

import argparse
import json
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

ENDPOINTS = (
    "/api/forum/topics?page=1&page_size=20",
    "/api/search?type=resources&q=ai&page=1&page_size=20",
    "/api/catalog?page=1&page_size=20",
    "/api/explore/overview",
)


def _hit(base_url: str, host: str | None, path: str, token: str | None) -> tuple[float, int, str]:
    request = urllib.request.Request(base_url.rstrip("/") + path)
    request.add_header("User-Agent", "rubbish-pressure-drill/1.0")
    if host:
        request.add_header("Host", host)
    if token:
        request.add_header("Authorization", f"Bearer {token}")
    started = time.perf_counter()
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            response.read(256)
            return time.perf_counter() - started, response.status, path
    except urllib.error.HTTPError as exc:
        return time.perf_counter() - started, exc.code, path
    except Exception as exc:
        return time.perf_counter() - started, 0, f"{path}: {type(exc).__name__}"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="https://rubbish.argjiemi.cn")
    parser.add_argument("--host", default=None, help="Optional Host header for loopback drills")
    parser.add_argument("--requests", type=int, default=100)
    parser.add_argument("--concurrency", type=int, default=10)
    parser.add_argument("--token", default=None, help="Optional bearer token for logged-in path")
    args = parser.parse_args()

    started = time.perf_counter()
    results = []
    with ThreadPoolExecutor(max_workers=max(1, args.concurrency)) as pool:
        futures = [
            pool.submit(
                _hit,
                args.base_url,
                args.host,
                ENDPOINTS[index % len(ENDPOINTS)],
                args.token,
            )
            for index in range(args.requests)
        ]
        for future in as_completed(futures):
            results.append(future.result())
    elapsed = time.perf_counter() - started

    successes = [result for result in results if 200 <= result[1] < 300]
    rate_limited = [result for result in results if result[1] == 429]
    client_errors = [result for result in results if 400 <= result[1] < 500 and result[1] != 429]
    server_errors = [result for result in results if result[1] == 0 or result[1] >= 500]
    latencies = sorted(result[0] for result in successes)

    def percentile(value: float) -> float:
        if not latencies:
            return 0.0
        index = min(len(latencies) - 1, int(len(latencies) * value))
        return latencies[index]

    by_endpoint = {}
    for endpoint in ENDPOINTS:
        rows = [result for result in results if result[2] == endpoint]
        ok = sorted(result[0] for result in rows if 200 <= result[1] < 300)
        entry = {
            "requests": len(rows),
            "ok": len(ok),
            "rate_limited": sum(1 for result in rows if result[1] == 429),
            "server_errors": sum(1 for result in rows if result[1] == 0 or result[1] >= 500),
            "p50_ms": round(ok[len(ok) // 2] * 1000, 1) if ok else None,
            "p95_ms": round(ok[min(len(ok) - 1, int(len(ok) * 0.95))] * 1000, 1) if ok else None,
        }
        by_endpoint[endpoint] = entry

    report = {
        "base_url": args.base_url,
        "requests": args.requests,
        "concurrency": args.concurrency,
        "elapsed_seconds": round(elapsed, 2),
        "rps": round(args.requests / elapsed, 1) if elapsed else None,
        "ok_requests": len(successes),
        "rate_limited": len(rate_limited),
        "client_errors": len(client_errors),
        "server_errors": len(server_errors),
        "p50_ms": round(percentile(0.50) * 1000, 1),
        "p95_ms": round(percentile(0.95) * 1000, 1),
        "max_ms": round((latencies[-1] if latencies else 0) * 1000, 1),
        "endpoints": by_endpoint,
        "error_samples": [
            {"status": status, "path": path}
            for _, status, path in (server_errors + client_errors)[:5]
        ],
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 1 if server_errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
