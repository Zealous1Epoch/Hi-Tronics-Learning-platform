"""应用配置"""

import os
from dotenv import load_dotenv

load_dotenv()


class Settings:
    APP_NAME: str = "Hi-Tronics Learning Platform"
    APP_VERSION: str = "0.1.0"
    # 默认 false（安全优先）：false 时启动强校验 JWT_SECRET/ADMIN_PASSWORD，
    # 跳过 create_all（表结构必须由 alembic 迁移维护），内置管理员不允许弱口令回退。
    # 本地开发请在 .env 显式设置 DEBUG=true。
    DEBUG: bool = os.getenv("DEBUG", "false").lower() == "true"

    # MySQL 数据库配置
    DB_HOST: str = os.getenv("DB_HOST", "localhost")
    DB_PORT: int = int(os.getenv("DB_PORT", "3306"))
    DB_USER: str = os.getenv("DB_USER", "root")
    DB_PASSWORD: str = os.getenv("DB_PASSWORD", "")
    DB_NAME: str = os.getenv("DB_NAME", "hitronics_learning")
    DATABASE_URL: str = (
        f"mysql+pymysql://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}"
    )

    # 全员名册镜像数据源（招聘系统 recruitment_db.org_members）
    # ORG_SOURCE_DB_URL：显式完整连接串（生产与招聘系统不同机时配置它）；
    # 留空时运行时用上面 DB_HOST/PORT/USER/PASSWORD + ORG_SOURCE_DB_NAME 推导，
    # 同 MySQL 实例场景零配置可用。源不可达只影响「同步全员」，不影响页面浏览。
    ORG_SOURCE_DB_URL: str = os.getenv("ORG_SOURCE_DB_URL", "")
    ORG_SOURCE_DB_NAME: str = os.getenv("ORG_SOURCE_DB_NAME", "recruitment_db")
    ORG_SOURCE_CONNECT_TIMEOUT: int = int(os.getenv("ORG_SOURCE_CONNECT_TIMEOUT", "5"))

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
    # SSO 共享密钥：配置后 OA 免密登录改用 HMAC-SHA256(secret, "工号:时间戳") 校验，
    # 票据与工号绑定，无法被任意伪造。未配置且未开启下方兼容开关时，
    # /sso/login 返回 503（fail-closed），OA 免密登录不可用。
    SSO_SHARED_SECRET: str = os.getenv("SSO_SHARED_SECRET", "")
    # 是否允许未配置 SSO_SHARED_SECRET 时回退到不安全的 md5(时间) 兼容模式。
    # 默认 false：无密钥时直接拒绝 SSO 登录（fail-closed）。
    # 该模式下票据与工号无关、任何人可伪造登录任意工号，仅限 OA 侧
    # 尚未完成 HMAC 改造的过渡期临时设为 true，迁移完成后必须删除该配置。
    SSO_ALLOW_INSECURE_COMPAT: bool = (
        os.getenv("SSO_ALLOW_INSECURE_COMPAT", "false").lower() == "true"
    )
    # 是否允许企微回调跳过 state（CSRF）校验。默认 false（安全）；
    # 仅当需要支持「企微客户端内直接打开应用」这一入口时才设为 true。
    WECHAT_ALLOW_UNVERIFIED_STATE: bool = (
        os.getenv("WECHAT_ALLOW_UNVERIFIED_STATE", "false").lower() == "true"
    )

    # 线下签到动态码密钥。留空时依次回退到 SSO_SHARED_SECRET → JWT_SECRET。
    # 单独配置的好处：轮换它不会影响已有 JWT 与 SSO 票据的有效性。
    ATTENDANCE_CODE_SECRET: str = os.getenv("ATTENDANCE_CODE_SECRET", "")

    # OA 系统 API 配置
    OA_API_BASE_URL: str = os.getenv("OA_API_BASE_URL", "")
    OA_SYSTEM_ID: str = os.getenv("OA_SYSTEM_ID", "")
    OA_PASSWORD: str = os.getenv("OA_PASSWORD", "")

    # 阿里云 OSS 配置
    OSS_ACCESS_KEY_ID: str = os.getenv("OSS_ACCESS_KEY_ID", "")
    OSS_ACCESS_KEY_SECRET: str = os.getenv("OSS_ACCESS_KEY_SECRET", "")
    OSS_ENDPOINT: str = os.getenv("OSS_ENDPOINT", "")
    OSS_BUCKET: str = os.getenv("OSS_BUCKET", "hitronics-learning-platform")

    # LLM（AI 出题）配置。LLM_API_KEY 留空 = AI 功能整体关闭（fail-closed）：
    # GET /api/ai/status 返回 enabled=false，POST /api/ai/generate 返回 503。
    # 兼容 OpenAI 协议的官方供应商均可：DeepSeek / 通义 / 智谱 等。
    LLM_API_KEY: str = os.getenv("LLM_API_KEY", "")
    LLM_BASE_URL: str = os.getenv("LLM_BASE_URL", "https://api.deepseek.com")
    LLM_MODEL: str = os.getenv("LLM_MODEL", "deepseek-chat")
    # 视觉模型（参考资料图片 OCR 用），与主模型共用 base_url/api_key。
    # 留空 = 图片上传报 400（PDF/Word/文本解析不受影响）。DeepSeek 官方无视觉模型，
    # 需要图片识别时配同协议的多模态端点（如通义 qwen-vl 系列）。
    LLM_VISION_MODEL: str = os.getenv("LLM_VISION_MODEL", "")
    # 单次调用超时（秒）。生成按题型拆分调用，单次典型 10-60s
    LLM_TIMEOUT: int = int(os.getenv("LLM_TIMEOUT", "75"))
    # 单次输出 token 上限（DeepSeek 上限 8192，留余量防推理/格式开销截断）
    LLM_MAX_OUTPUT_TOKENS: int = int(os.getenv("LLM_MAX_OUTPUT_TOKENS", "6000"))
    # 仅 vLLM 自托管需要（官方 API 会忽略该参数）：关闭推理模型 thinking，
    # 防 reasoning token 吃满 max_tokens 导致 JSON 腰斩（2026-10-16 招聘系统事故教训）
    LLM_DISABLE_THINKING: bool = (
        os.getenv("LLM_DISABLE_THINKING", "false").lower() == "true"
    )

    # 内置管理员账号（生产环境必须通过环境变量设置密码）
    BUILTIN_ADMIN_USERNAME: str = os.getenv("ADMIN_USERNAME", "hitronics")
    BUILTIN_ADMIN_PASSWORD: str = os.getenv("ADMIN_PASSWORD", "")

    # 可信反向代理 IP 列表（逗号分隔）。
    # 只有当直连对端在此列表中时，才会采信 X-Forwarded-For 获取真实客户端 IP；
    # 默认为空 → 忽略该头部 → 无法通过伪造头部绕过登录限流。
    # 部署在 nginx 后面时，把 nginx 的 IP 填进来，例如 127.0.0.1,10.0.0.5
    TRUSTED_PROXY_IPS: list[str] = [
        ip.strip()
        for ip in os.getenv("TRUSTED_PROXY_IPS", "").split(",")
        if ip.strip()
    ]


settings = Settings()