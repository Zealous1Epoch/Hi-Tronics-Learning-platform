#!/usr/bin/env python3
"""前端开发服务器启动脚本。"""
import os
import subprocess

WEB_DIR = "/Users/cc/Documents/Hi-Tronics/Hi-Tronics-EHR/Hi-Tronics-Learning-platform/web"
VITE_BIN = os.path.join(WEB_DIR, "node_modules", ".bin", "vite")
LOG_FILE = os.path.join(WEB_DIR, "logs", "frontend.log")

os.makedirs(os.path.dirname(LOG_FILE), exist_ok=True)

proc = subprocess.Popen(
    [VITE_BIN, "--port", "5178"],
    cwd=WEB_DIR,
    stdout=open(LOG_FILE, "a"),
    stderr=subprocess.STDOUT,
    start_new_session=True,
)
print(f"Frontend started with PID {proc.pid}, logging to {LOG_FILE}")
