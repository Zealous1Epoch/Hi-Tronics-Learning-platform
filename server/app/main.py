"""Hi-Tronics 在线学习平台 - FastAPI 应用入口"""

import os
import sys
import time
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from app.config import settings
from app.database import engine, Base, SessionLocal
from app.logger import setup_logging, get_logger
from app.models import *  # noqa: F401, F403 — 注册所有模型到 Base.metadata
from app.routers.auth import router as auth_router
from app.routers.users import router as users_router
from app.routers.departments import router as departments_router
from app.routers.courses import router as courses_router
from app.routers.videos import router as videos_router
from app.routers.questions import router as questions_router
from app.routers.exams import router as exams_router
from app.routers.student_exam import router as student_exam_router
from app.routers.question_tags import router as question_tags_router
from app.routers.question_categories import router as question_categories_router
from app.routers.learning_progress import router as learning_progress_router, admin_router as admin_progress_router
from app.routers.papers import router as papers_router
from app.routers.logs import router as logs_router
from app.services.seed import seed_builtin_admin

logger = setup_logging(debug=settings.DEBUG)


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    """请求日志中间件：记录每个请求的方法、路径、耗时和状态码"""

    async def dispatch(self, request: Request, call_next):
        start = time.time()
        response = await call_next(request)
        elapsed_ms = round((time.time() - start) * 1000)
        # 跳过健康检查和静态资源
        if not request.url.path.startswith("/api/videos/stream/"):
            logger.info(
                "%s %s -> %d (%dms)",
                request.method,
                request.url.path,
                response.status_code,
                elapsed_ms,
            )
        return response


@asynccontextmanager
async def lifespan(app: FastAPI):
    """启动时校验配置、创建表并初始化种子数据"""
    logger.info("正在启动 %s v%s", settings.APP_NAME, settings.APP_VERSION)

    # 安全校验：JWT_SECRET 不允许为空（所有环境）
    if not settings.JWT_SECRET:
        logger.critical("JWT_SECRET 未设置，请通过环境变量 JWT_SECRET 配置")
        sys.exit(1)
    # 生产环境安全校验
    if not settings.DEBUG:
        if settings.JWT_SECRET == "change-me-in-production":
            logger.critical("生产环境必须将 JWT_SECRET 改为实际密钥")
            sys.exit(1)
        if not settings.BUILTIN_ADMIN_PASSWORD:
            logger.critical("生产环境必须设置 ADMIN_PASSWORD 环境变量")
            sys.exit(1)
    elif settings.JWT_SECRET == "change-me-in-production":
        logger.warning("JWT_SECRET 使用默认值，仅限开发环境使用")

    logger.info("创建数据库表...")
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        seed_builtin_admin(db)
    finally:
        db.close()
    logger.info("启动完成")
    yield
    logger.info("正在关闭...")


app = FastAPI(
    title="Hi-Tronics Learning Platform API",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(RequestLoggingMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv(
        "CORS_ORIGINS",
        "http://localhost:5178,http://localhost:3000",
    ).split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(users_router)
app.include_router(departments_router)
app.include_router(courses_router)
app.include_router(videos_router)
app.include_router(questions_router)
app.include_router(exams_router)
app.include_router(student_exam_router)
app.include_router(question_tags_router)
app.include_router(question_categories_router)
app.include_router(learning_progress_router)
app.include_router(admin_progress_router)
app.include_router(papers_router)
app.include_router(logs_router)


@app.get("/api/health")
async def health_check():
    return {"status": "ok", "version": "0.1.0"}