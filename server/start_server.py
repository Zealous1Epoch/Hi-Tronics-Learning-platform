#!/usr/bin/env python3
"""后端服务启动脚本：启动 uvicorn 并重定向输出到日志文件。"""
import os
import sys
import subprocess

SERVER_DIR = "/Users/cc/Documents/Hi-Tronics/Hi-Tronics-EHR/Hi-Tronics-Learning-platform/server"
VENV_PYTHON = os.path.join(SERVER_DIR, ".venv", "bin", "python3")
LOG_FILE = os.path.join(SERVER_DIR, "logs", "app.log")

os.chdir(SERVER_DIR)

# 启动 uvicorn，start_new_session=True 让它成为独立的守护进程
proc = subprocess.Popen(
    [VENV_PYTHON, "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8200"],
    stdout=open(LOG_FILE, "a"),
    stderr=subprocess.STDOUT,
    start_new_session=True,
)
print(f"Backend started with PID {proc.pid}, logging to {LOG_FILE}")
