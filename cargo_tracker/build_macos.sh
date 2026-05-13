#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
pip install -r requirements.txt
pip install pyinstaller
pyinstaller --onefile --windowed --name EthiopianCargoTracker tracker_gui.py

echo "打包完成：$(pwd)/dist/EthiopianCargoTracker"
