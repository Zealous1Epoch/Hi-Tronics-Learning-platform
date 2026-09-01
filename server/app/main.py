"""Hi-Tronics 在线学习平台 - FastAPI 应用入口"""

from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.database import engine, Base, SessionLocal
from app.models import *  # noqa: F401, F403 — 注册所有模型到 Base.metadata
from app.routers.auth import router as auth_router
from app.routers.users import router as users_router
from app.routers.departments import router as departments_router
from app.routers.courses import router as courses_router
from app.routers.videos import router as videos_router
from app.services.seed import seed_builtin_admin


@asynccontextmanager
async def lifespan(app: FastAPI):
    """启动时创建表并初始化种子数据"""
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        seed_builtin_admin(db)
    finally:
        db.close()
    yield


app = FastAPI(
    title="Hi-Tronics Learning Platform API",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5178", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(users_router)
app.include_router(departments_router)
app.include_router(courses_router)
app.include_router(videos_router)


@app.get("/api/health")
async def health_check():
    return {"status": "ok", "version": "0.1.0"}