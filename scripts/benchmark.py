import argparse
import csv
import json
import math
import os
import platform
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

import httpx


CASES = {
    "full_catalog": "/api/products?limit=1000",
    "four_facets": "/api/products?min_price=1000&max_price=80000&stock=in&brand_id=1&brand_id=2&min_rating=3.5&limit=100",
    "root_category": "/api/products?category_id=1&limit=1000",
    "literal_search": "/api/products?search=Studio&limit=1000",
    "stock_sort": "/api/products?stock=low&sort=stock_desc&limit=100",
}


def percentile(values, fraction):
    return sorted(values)[max(0, math.ceil(len(values) * fraction) - 1)]


def host_limits():
    values = {"platform": platform.platform(), "python": platform.python_version(), "logical_cpus": os.cpu_count()}
    for name, path in {
        "cpu_quota": "/sys/fs/cgroup/cpu.max",
        "memory_limit_bytes": "/sys/fs/cgroup/memory.max",
    }.items():
        try:
            values[name] = Path(path).read_text().strip()
        except OSError:
            values[name] = "unavailable"
    return values


def main():
    parser = argparse.ArgumentParser(description="Measure HTTP latency against a RUNNING, real MySQL-backed app")
    parser.add_argument("--url", default="http://127.0.0.1:8000")
    parser.add_argument("--samples", type=int, default=300)
    parser.add_argument("--concurrency", type=int, default=10)
    parser.add_argument("--warmup", type=int, default=20)
    parser.add_argument("--out", default="reports")
    args = parser.parse_args()
    if args.samples < 1 or args.concurrency < 1 or args.warmup < 0:
        raise SystemExit("samples/concurrency must be positive; warmup must be non-negative")
    output = Path(args.out)
    output.mkdir(parents=True, exist_ok=True)
    rows = []
    limits = httpx.Limits(max_connections=args.concurrency, max_keepalive_connections=args.concurrency)
    with httpx.Client(base_url=args.url, timeout=30, limits=limits) as client:
        health = client.get("/health").raise_for_status().json()
        stats = client.get("/api/stats").raise_for_status().json()
        for case, path in CASES.items():
            for _ in range(args.warmup):
                client.get(path).raise_for_status()

            def measure(sample):
                started = time.perf_counter()
                response = client.get(path)
                elapsed = (time.perf_counter() - started) * 1000
                result = response.json() if response.status_code == 200 else {}
                return {
                    "scenario": case, "sample": sample,
                    "status": response.status_code, "latency_ms": elapsed,
                    "returned_products": len(result.get("items", [])),
                }

            with ThreadPoolExecutor(max_workers=args.concurrency) as executor:
                rows.extend(executor.map(measure, range(1, args.samples + 1)))
    with (output / "benchmark_raw.csv").open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)
    scenarios = {}
    for case in CASES:
        selected = [row for row in rows if row["scenario"] == case]
        latencies = [row["latency_ms"] for row in selected]
        scenarios[case] = {
            "path": CASES[case], "requests": len(selected),
            "errors": sum(row["status"] != 200 for row in selected),
            "p50_ms": percentile(latencies, 0.5),
            "p95_ms": percentile(latencies, 0.95),
            "p99_ms": percentile(latencies, 0.99),
            "max_ms": max(latencies),
        }
    evidence = {
        "measured_at_utc": datetime.now(timezone.utc).isoformat(),
        "base_url": args.url, "concurrency": args.concurrency,
        "warmup_per_scenario": args.warmup, "catalog": stats,
        "database": health, "environment": host_limits(),
        "method": "Nearest-rank percentiles; full HTTP response body read; warmups excluded; localhost client and server",
        "scenarios": scenarios,
        "worst_scenario_p95_ms": max(case["p95_ms"] for case in scenarios.values()),
        "all_requests_under_400_ms": all(row["latency_ms"] < 400 for row in rows),
        "total_requests": len(rows), "total_errors": sum(row["status"] != 200 for row in rows),
        "caveat": "Local measurements on synthetic data, not a production SLA or an internet-latency guarantee.",
    }
    (output / "benchmark_summary.json").write_text(json.dumps(evidence, indent=2) + "\n")
    print(json.dumps({key: evidence[key] for key in (
        "total_requests", "total_errors", "worst_scenario_p95_ms", "all_requests_under_400_ms"
    )}, indent=2))
    if evidence["total_errors"]:
        raise SystemExit("Benchmark contained HTTP errors; inspect the raw results")


if __name__ == "__main__":
    main()
