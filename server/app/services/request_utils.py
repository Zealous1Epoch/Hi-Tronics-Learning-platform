"""请求相关的小工具（跨 router 共用，避免从别的 router 导入私有函数）。"""

from __future__ import annotations

from fastapi import Request

from app.config import settings


def get_client_ip(request: Request) -> str:
    """解析真实客户端 IP。

    仅当直连对端是「可信代理」时才采信 X-Forwarded-For，否则一律使用 TCP 对端地址。
    默认 TRUSTED_PROXY_IPS 为空 → 该头部被忽略 → 无法通过伪造 IP 绕过限流或签到网络校验。
    反向代理部署时，把代理（如 nginx）的 IP 加入 TRUSTED_PROXY_IPS。
    """
    peer = request.client.host if request.client else "unknown"
    if peer not in settings.TRUSTED_PROXY_IPS:
        return peer

    hops = [
        h.strip()
        for h in request.headers.get("X-Forwarded-For", "").split(",")
        if h.strip()
    ]
    for ip in reversed(hops):  # 从右往左取第一个非可信代理地址
        if ip not in settings.TRUSTED_PROXY_IPS:
            return ip
    return peer
