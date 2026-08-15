#!/usr/bin/env bash
# 卸载 git-panel（跨平台：Windows Git Bash / WSL / macOS / Linux）
# 用法：./uninstall.sh
# 可用环境变量：DSH_PROFILE=/path/to/profile
set -euo pipefail
cd "$(dirname "$0")"
exec node scripts/uninstall.mjs "$@"
