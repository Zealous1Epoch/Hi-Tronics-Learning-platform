"""测试 fixtures：使用 SQLite 内存数据库，避免依赖 MySQL"""

import os
import sys
import uuid

# 确保测试环境变量在导入 app 之前设置
os.environ["JWT_SECRET"] = "test-secret-key-for-testing-only"
os.environ["ADMIN_PASSWORD"] = "TestAdmin123!"
os.environ["DEBUG"] = "true"

# 使用 SQLite 内存数据库（设置 dummy 值避免 config 解析报错）
os.environ["DB_HOST"] = "localhost"
os.environ["DB_PORT"] = "3306"
os.environ["DB_USER"] = "test"
os.environ["DB_PASSWORD"] = "test"
os.environ["DB_NAME"] = "test"

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session

# 强制使用 SQLite
from app.config import settings
from app import database as db_module

# 覆盖配置
settings.DATABASE_URL = "sqlite:///./test.db"
settings.JWT_SECRET = "test-secret-key-for-testing-only"
settings.BUILTIN_ADMIN_USERNAME = "admin"
settings.BUILTIN_ADMIN_PASSWORD = "TestAdmin123!"

# 创建测试引擎并替换 database 模块中的 engine 和 SessionLocal
test_engine = create_engine(
    settings.DATABASE_URL,
    connect_args={"check_same_thread": False},
)
TestSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=test_engine)
db_module.engine = test_engine
db_module.SessionLocal = TestSessionLocal

from app.database import Base, get_db


@pytest.fixture(scope="function")
def db():
    """每个测试函数独立的数据库 session"""
    Base.metadata.create_all(bind=test_engine)
    session = TestSessionLocal()
    try:
        yield session
    finally:
        session.rollback()
        session.close()
    # 清理
    Base.metadata.drop_all(bind=test_engine)


@pytest.fixture(scope="function")
def client(db: Session):
    """带测试数据库的 FastAPI TestClient"""
    from app.main import app
    from app.services.seed import seed_builtin_admin

    # 覆盖依赖
    def override_get_db():
        try:
            yield db
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db

    # 初始化种子数据
    seed_builtin_admin(db)

    with TestClient(app) as c:
        yield c

    app.dependency_overrides.clear()


@pytest.fixture(scope="function")
def admin_token(client):
    """管理员登录 token"""
    res = client.post("/api/auth/login", json={
        "username": "admin",
        "password": "TestAdmin123!",
    })
    assert res.status_code == 200
    return res.json()["access_token"]


@pytest.fixture(scope="function")
def admin_headers(admin_token):
    """管理员请求头"""
    return {"Authorization": f"Bearer {admin_token}"}


@pytest.fixture(scope="function")
def student_token(client, admin_headers, db):
    """创建学员并返回其 token"""
    # 创建学员
    from app.models.user import User
    from app.services.auth_service import hash_password

    student = User(
        id=str(uuid.uuid4()),
        username="student1",
        password_hash=hash_password("Student123!"),
        name="测试学员",
        role="student",
        status="active",
        department="测试部门",
    )
    db.add(student)
    db.commit()

    res = client.post("/api/auth/login", json={
        "username": "student1",
        "password": "Student123!",
    })
    assert res.status_code == 200
    return res.json()["access_token"]


@pytest.fixture(scope="function")
def student_headers(student_token):
    """学员请求头"""
    return {"Authorization": f"Bearer {student_token}"}


@pytest.fixture(scope="function")
def course_id(client, admin_headers, db):
    """创建测试课程并返回 ID"""
    from app.models.course import Course, Video
    from app.models.course import CourseAssignment

    course = Course(
        id=str(uuid.uuid4()),
        title="测试课程",
        description="用于测试的课程",
        status="published",
    )
    db.add(course)

    video = Video(
        id=str(uuid.uuid4()),
        course_id=course.id,
        title="第一章",
        obs_key="test.mp4",
        duration=600,
        sort_order=0,
    )
    db.add(video)
    db.commit()
    return course.id


def create_question(db: Session, q_type: str, stem: str, answer: dict, difficulty: str = "medium"):
    """创建测试题目"""
    from app.models.question import Question
    q = Question(
        id=str(uuid.uuid4()),
        type=q_type,
        stem=stem,
        options={"A": "选项A", "B": "选项B", "C": "选项C", "D": "选项D"} if q_type in ("single_choice", "multi_choice") else None,
        answer=answer,
        difficulty=difficulty,
    )
    db.add(q)
    db.commit()
    return q