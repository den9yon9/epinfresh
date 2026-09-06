#!/usr/bin/env bash
# 原生(不用 Docker)一键启动本地监控栈: Prometheus + Grafana。
# 前置:
#   brew install prometheus grafana          # 一次性
#   pnpm dev 已跑起来(storefront-api 3000 / admin-api 3001 / worker HEALTH_PORT 3100)
# 用法: scripts/monitoring-up.sh
# 说明: Prometheus 后台运行, Grafana 前台运行; Ctrl+C 停止 Grafana 并连带停掉 Prometheus。
# 若 9090/3005 端口已被占用(可能是上次遗留的进程), 脚本会提示你停掉后再跑, 不会强行双开。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROMETHEUS_CONF="$ROOT/monitoring/prometheus.yml"
GRAFANA_PROVISIONING="$ROOT/monitoring/grafana/provisioning"
GRAFANA_DASHBOARDS="$ROOT/monitoring/grafana/dashboards"
GRAFANA_DATA="$ROOT/.grafana-data"
GRAFANA_HOMEPATH="${GRAFANA_HOMEPATH:-$(brew --prefix grafana 2>/dev/null)/share/grafana}"
PROMETHEUS_PORT=9090
GRAFANA_PORT=3005

# --- 识别 Grafana 启动命令(两个版本约定不同) ---
# Grafana >= 12: 只有 `grafana` 二进制, 用 `grafana server` 子命令
# Grafana < 12 : 单独的 `grafana-server` 二进制
if command -v grafana >/dev/null 2>&1; then
  GRAFANA_CMD=(grafana server)
  GRAFANA_CMD_LABEL='grafana server'
elif command -v grafana-server >/dev/null 2>&1; then
  GRAFANA_CMD=(grafana-server)
  GRAFANA_CMD_LABEL='grafana-server'
else
  echo "grafana 二进制未找到(需要 brew install grafana)" >&2
  exit 1
fi

# --- 依赖检查并给出安装提示 ---
missing=()
command -v prometheus >/dev/null 2>&1 || missing+=('prometheus')
command -v brew >/dev/null 2>&1 || missing+=('brew (gestion: grafana 需要 brew 安装以便定位 homepath)')
if [[ ${#missing[@]} -gt 0 ]]; then
  echo "missing: ${missing[*]}" >&2
  echo "Install them first:" >&2
  echo "  brew install prometheus grafana" >&2
  echo "then re-run this script." >&2
  exit 1
fi

[[ -f "$PROMETHEUS_CONF" ]] || {
  echo "missing $PROMETHEUS_CONF" >&2
  exit 1
}

# --- 端口预检: 不抢占已运行实例, 给出可操作的提示 ---
if command -v lsof >/dev/null 2>&1; then
  if lsof -nP -iTCP:"$PROMETHEUS_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    pid=$(lsof -nP -iTCP:"$PROMETHEUS_PORT" -sTCP:LISTEN -t 2>/dev/null | head -1)
    echo "Prometheus 已占用 :$PROMETHEUS_PORT (pid $pid)。可能为上次遗留进程, 请先停掉:" >&2
    echo "  kill $pid   # 或 pkill -f 'prometheus.*$PROMETHEUS_PORT'" >&2
    exit 1
  fi
  if lsof -nP -iTCP:"$GRAFANA_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    pid=$(lsof -nP -iTCP:"$GRAFANA_PORT" -sTCP:LISTEN -t 2>/dev/null | head -1)
    echo "Grafana 已占用 :$GRAFANA_PORT (pid $pid)。可能为上次遗留进程, 请先停掉:" >&2
    echo "  kill $pid   # 或 pkill -f 'grafana server'" >&2
    exit 1
  fi
fi

# --- Prometheus(后台) ---
echo "Starting Prometheus on http://localhost:$PROMETHEUS_PORT"
prometheus --config.file "$PROMETHEUS_CONF" --web.listen-address="0.0.0.0:$PROMETHEUS_PORT" --log.level=info &
PROM_PID=$!
trap 'echo "Stopping Prometheus (pid $PROM_PID)"; kill "$PROM_PID" 2>/dev/null || true' EXIT

# --- Grafana(前台; 配置全部经绝对环境变量传入, 不依赖工作目录) ---
export GF_PATHS_PROVISIONING="$GRAFANA_PROVISIONING"
export GF_PATHS_DATA="$GRAFANA_DATA"
export GF_SERVER_HTTP_PORT="$GRAFANA_PORT"
# dashboards.yml 用 ${EPINFRESH_DASHBOARDS_PATH} 引用绝对路径
export EPINFRESH_DASHBOARDS_PATH="$GRAFANA_DASHBOARDS"
echo "Starting Grafana on http://localhost:$GRAFANA_PORT (admin/admin) via: $GRAFANA_CMD_LABEL"
echo "dashboard 'epinfresh 总览' auto-import via provisioning"
echo "Ctrl+C to stop Grafana (Prometheus will be stopped too)"
"${GRAFANA_CMD[@]}" --homepath "$GRAFANA_HOMEPATH"
