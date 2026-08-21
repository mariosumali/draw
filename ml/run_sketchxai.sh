#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
python_bin=${QUICKDRAW_PYTHON:-"$script_dir/.venv/bin/python"}
predict_script=${QUICKDRAW_SKETCHXAI_SCRIPT:-"$script_dir/predict_sketchxai.py"}

exec "$python_bin" "$predict_script"
