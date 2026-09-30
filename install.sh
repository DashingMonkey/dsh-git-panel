#!/usr/bin/env bash
# 一键安装 git-panel 到本机 dsh profile（跨平台：Windows Git Bash / WSL / macOS / Linux）
# 用法：./install.sh [web|desktop]     # 省略时自动探测（两个 profile 都在则必须显式指定）
# 可用环境变量：DSH_PROFILE=<profile 名或路径> / DSH_PROFILE_DIR=<profile 绝对目录>
set -euo pipefail
cd "$(dirname "$0")"
exec node scripts/install.mjs "$@"
