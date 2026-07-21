#!/usr/bin/env bash
# 启动 PostgreSQL + Redis（Docker Compose）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

if ! command -v docker >/dev/null 2>&1; then
  echo "未找到 docker，请先安装 Docker。" >&2
  exit 1
fi

echo "==> 启动 dpl304 数据库容器..."
if ! docker compose up -d --wait 2>/dev/null; then
  docker compose up -d
  for i in $(seq 1 30); do
    pg=$(docker inspect -f '{{.State.Health.Status}}' dpl304-postgres 2>/dev/null || echo "")
    rd=$(docker inspect -f '{{.State.Health.Status}}' dpl304-redis 2>/dev/null || echo "")
    if [ "$pg" = "healthy" ] && [ "$rd" = "healthy" ]; then
      break
    fi
    sleep 2
    if [ "$i" -eq 30 ]; then
      echo "健康检查超时" >&2
      exit 1
    fi
  done
fi

echo ""
echo "✓ 数据库已就绪"
echo "  DATABASE_URL=postgresql://postgres:postgres@localhost:5432/dpl304?schema=public"
echo "  REDIS_URL=redis://127.0.0.1:6379"
