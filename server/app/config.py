"""应用配置"""

import os
from dotenv import load_dotenv

load_dotenv()


class Settings:
    APP_NAME: str = "Hi-Tronics Learning Platform"
    APP_VERSION: str = "0.1.0"
    DEBUG: bool = os.getenv("DEBUG", "true").lower() == "true"

    # MySQL 数据库配置
    DB_HOST: str = os.getenv("DB_HOST", "localhost")
    DB_PORT: int = int(os.getenv("DB_PORT", "3306"))
    DB_USER: str = os.getenv("DB_USER", "root")
    DB_PASSWORD: str = os.getenv("DB_PASSWORD", "")
    DB_NAME: str = os.getenv("DB_NAME", "hitronics_learning")
    DATABASE_URL: str = (
        f"mysql+pymysql://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}"
    )

    # JWT 配置
    JWT_SECRET: str = os.getenv("JWT_SECRET", "")
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_HOURS: int = 24

    # 企业微信 OAuth 配置
    WECHAT_CORP_ID: str = os.getenv("WECHAT_CORP_ID", "")
    WECHAT_AGENT_ID: str = os.getenv("WECHAT_AGENT_ID", "")
    WECHAT_SECRET: str = os.getenv("WECHAT_SECRET", "")

    # SSO 配置
    FRONTEND_URL: str = os.getenv("FRONTEND_URL", "http://hr.hi-tronics.com/learning-platform")
    SSO_TIME_WINDOW: int = int(os.getenv("SSO_TIME_WINDOW", "30"))

    # OA 系统 API 配置
    OA_API_BASE_URL: str = os.getenv("OA_API_BASE_URL", "")
    OA_SYSTEM_ID: str = os.getenv("OA_SYSTEM_ID", "")
    OA_PASSWORD: str = os.getenv("OA_PASSWORD", "")

    # 阿里云 OSS 配置
    OSS_ACCESS_KEY_ID: str = os.getenv("OSS_ACCESS_KEY_ID", "")
    OSS_ACCESS_KEY_SECRET: str = os.getenv("OSS_ACCESS_KEY_SECRET", "")
    OSS_ENDPOINT: str = os.getenv("OSS_ENDPOINT", "")
    OSS_BUCKET: str = os.getenv("OSS_BUCKET", "hitronics-learning-platform")

    # 内置管理员账号（生产环境必须通过环境变量设置密码）
    BUILTIN_ADMIN_USERNAME: str = os.getenv("ADMIN_USERNAME", "hitronics")
    BUILTIN_ADMIN_PASSWORD: str = os.getenv("ADMIN_PASSWORD", "")


settings = Settings()