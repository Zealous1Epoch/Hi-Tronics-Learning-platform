"""企业微信 API 客户端：OAuth 授权登录相关调用"""

import time
from httpx import AsyncClient
from app.config import settings
from app.logger import get_logger

logger = get_logger(__name__)

WECHAT_API_BASE = "https://qyapi.weixin.qq.com"

# 带缓存的 access_token（有效期 7200s，提前 300s 刷新）
_token_cache: dict[str, tuple[str, float]] = {}
_TOKEN_REFRESH_BEFORE = 300


async def _fetch_access_token() -> str:
    """从企微 API 获取 access_token（无缓存，直接调用）"""
    url = f"{WECHAT_API_BASE}/cgi-bin/gettoken"
    params = {
        "corpid": settings.WECHAT_CORP_ID,
        "corpsecret": settings.WECHAT_SECRET,
    }
    async with AsyncClient() as client:
        resp = await client.get(url, params=params)
        data = resp.json()
    if data.get("errcode") != 0:
        raise RuntimeError(f"获取企微 access_token 失败: {data.get('errmsg', '未知错误')}")
    logger.info("获取企微 access_token 成功")
    return data["access_token"]


async def get_access_token(force_refresh: bool = False) -> str:
    """获取企微 access_token（带缓存，自动刷新）"""
    now = time.time()
    cached = _token_cache.get("access_token")
    if cached and not force_refresh:
        token, expires_at = cached
        if now < expires_at - _TOKEN_REFRESH_BEFORE:
            return token
    token = await _fetch_access_token()
    _token_cache["access_token"] = (token, now + 7200)
    return token


async def get_user_info(code: str) -> dict:
    """用授权 code 换取 user_ticket 和 userid

    企微文档: https://developer.work.weixin.qq.com/document/path/91335
    注意：该接口使用 GET 请求，code 作为查询参数，不是 POST
    """
    token = await get_access_token()
    url = f"{WECHAT_API_BASE}/cgi-bin/auth/getuserinfo"
    async with AsyncClient() as client:
        resp = await client.get(url, params={"access_token": token, "code": code})
        data = resp.json()
    if data.get("errcode") != 0:
        raise RuntimeError(f"企微 getuserinfo 失败: {data.get('errmsg', '未知错误')}")
    return data


async def get_user_detail(user_ticket: str) -> dict:
    """用 user_ticket 获取用户详细信息（姓名、头像等）

    企微文档: https://developer.work.weixin.qq.com/document/path/91335
    """
    token = await get_access_token()
    url = f"{WECHAT_API_BASE}/cgi-bin/auth/getuserdetail"
    async with AsyncClient() as client:
        resp = await client.post(url, params={"access_token": token}, json={"user_ticket": user_ticket})
        data = resp.json()
    if data.get("errcode") != 0:
        raise RuntimeError(f"企微 getuserdetail 失败: {data.get('errmsg', '未知错误')}")
    return data