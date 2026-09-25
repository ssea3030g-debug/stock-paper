#!/usr/bin/env bash
# 내 컴퓨터에서 매일 실행할 스크립트. crontab.example 참고.
set -euo pipefail
cd "$(dirname "$0")/.."
PY="${PYTHON:-python3}"
[ -d .venv ] && PY=.venv/bin/python
"$PY" main.py "$@" >> "logs/cron.log" 2>&1
