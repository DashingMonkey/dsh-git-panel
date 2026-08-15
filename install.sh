#!/usr/bin/env bash
# 一键安装 git-panel 到本机 dsh web profile（跨平台：Windows Git Bash / WSL / macOS / Linux）
# 用法：./install.sh
# 可用环境变量：DSH_PROFILE=/path/to/profile   （默认 ~/.dsh/profiles/web）
set -euo pipefail
cd "$(dirname "$0")"
exec node scripts/install.mjs "$@"
