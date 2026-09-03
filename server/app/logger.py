"""应用日志配置"""

import logging
import os
import sys
from logging.handlers import RotatingFileHandler

# 日志格式
LOG_FORMAT = "%(asctime)s [%(levelname)s] %(name)s: %(message)s"
DATE_FORMAT = "%Y-%m-%d %H:%M:%S"

# 日志文件路径（供外部 API 读取）
LOG_FILE: str = ""


def setup_logging(debug: bool = False) -> logging.Logger:
    """配置并返回根日志记录器"""
    global LOG_FILE

    level = logging.DEBUG if debug else logging.INFO

    root = logging.getLogger("hitronics")
    root.setLevel(level)

    if root.handlers:
        return root

    # 控制台 handler
    console = logging.StreamHandler(sys.stdout)
    console.setFormatter(logging.Formatter(LOG_FORMAT, DATE_FORMAT))
    root.addHandler(console)

    # 文件 handler（持久化，轮转保留最近 5 个文件，每个最大 10MB）
    # 日志目录放在项目根目录（server/ 的上级），避免 uvicorn --reload 监控到日志文件变化引发重载死循环
    log_dir = os.path.join(os.path.dirname(__file__), "..", "..", "logs")
    os.makedirs(log_dir, exist_ok=True)
    LOG_FILE = os.path.join(log_dir, "app.log")
    file_handler = RotatingFileHandler(
        LOG_FILE, maxBytes=10 * 1024 * 1024, backupCount=5, encoding="utf-8",
    )
    file_handler.setFormatter(logging.Formatter(LOG_FORMAT, DATE_FORMAT))
    root.addHandler(file_handler)

    # 降低第三方库日志噪音
    logging.getLogger("sqlalchemy.engine").setLevel(logging.WARNING)
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)

    return root


def get_logger(name: str) -> logging.Logger:
    """获取模块级日志记录器"""
    return logging.getLogger(f"hitronics.{name}")