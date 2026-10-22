"""OpenAI 兼容协议 LLM 调用封装（同步客户端）

- 懒加载单例 + 函数内 import openai：生产未装 openai 包时平台照常启动，
  只是 AI 功能不可用（fail-closed 由调用方 llm_enabled()/503 保证）。
- 路由用同步 def（跑在 Starlette 线程池），30-90s 的 LLM 调用不阻塞事件循环，
  因此这里用同步 SDK 而非 AsyncOpenAI。
- response_format={"type":"json_object"} 在 DeepSeek/通义/智谱兼容端点均受支持；
  个别供应商报 400 时自动去掉该参数重试一次。
"""

import logging
import threading
import time

from app.config import settings

logger = logging.getLogger(__name__)

_client = None
_client_lock = threading.Lock()

SYSTEM_PROMPT = (
    "你是严谨的企业培训出题助手。"
    "严格遵守用户给出的输出格式要求，只输出一个 JSON 对象，"
    "不要输出任何解释文字、不要使用 markdown 代码围栏。"
)


def llm_enabled() -> bool:
    """是否配置了 LLM_API_KEY（未配置 = AI 功能整体关闭）"""
    return bool(settings.LLM_API_KEY)


def get_client():
    """懒加载 OpenAI 客户端单例"""
    global _client
    if _client is None:
        with _client_lock:
            if _client is None:
                from openai import OpenAI

                _client = OpenAI(
                    api_key=settings.LLM_API_KEY,
                    base_url=settings.LLM_BASE_URL,
                    timeout=settings.LLM_TIMEOUT,
                )
    return _client


def chat_completion_json(prompt: str, max_tokens: int | None = None) -> tuple[str, dict]:
    """单轮 JSON 输出调用，返回 (content, usage)。

    失败抛 openai 异常（APIConnectionError/APITimeoutError/APIStatusError 等），
    由服务层决定是否重试；本函数只负责一次调用 + 供应商兼容性降级重试。
    """
    client = get_client()
    kwargs: dict = {
        "model": settings.LLM_MODEL,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.3,
        "max_tokens": max_tokens or settings.LLM_MAX_OUTPUT_TOKENS,
        "response_format": {"type": "json_object"},
    }
    if settings.LLM_DISABLE_THINKING:
        # vLLM 只认 chat_template_kwargs 嵌套写法；平铺 enable_thinking 会被忽略
        kwargs["extra_body"] = {"chat_template_kwargs": {"enable_thinking": False}}

    t0 = time.time()
    try:
        resp = client.chat.completions.create(**kwargs)
    except Exception as e:
        # 供应商不支持 response_format（400）→ 去掉后再试一次；其余异常上抛
        if getattr(e, "status_code", None) == 400 and "response_format" in kwargs:
            logger.warning("供应商拒绝 response_format 参数，去掉后重试: %s", e)
            kwargs.pop("response_format")
            resp = client.chat.completions.create(**kwargs)
        else:
            raise

    content = resp.choices[0].message.content or ""
    usage: dict = {}
    if getattr(resp, "usage", None) is not None:
        usage = {
            "prompt_tokens": resp.usage.prompt_tokens or 0,
            "completion_tokens": resp.usage.completion_tokens or 0,
        }
    logger.info(
        "LLM 调用 %s 完成: %.1fs, in=%s out=%s, content_len=%s",
        settings.LLM_MODEL,
        time.time() - t0,
        usage.get("prompt_tokens"),
        usage.get("completion_tokens"),
        len(content),
    )
    return content, usage


def chat_completion_vision(prompt_text: str, image_b64: str, mime: str) -> str:
    """单轮视觉调用（图片→文本），用于参考资料图片的 OCR 识别。

    使用 settings.LLM_VISION_MODEL（须为支持 image_url 的多模态模型，
    与主模型共用 base_url/api_key）。失败抛 openai 异常，由调用方转 HTTP 错误。
    """
    client = get_client()
    t0 = time.time()
    resp = client.chat.completions.create(
        model=settings.LLM_VISION_MODEL,
        messages=[
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt_text},
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:{mime};base64,{image_b64}"},
                    },
                ],
            }
        ],
        temperature=0.1,
        max_tokens=settings.LLM_MAX_OUTPUT_TOKENS,
    )
    content = resp.choices[0].message.content or ""
    logger.info(
        "LLM 视觉调用 %s 完成: %.1fs, content_len=%s",
        settings.LLM_VISION_MODEL,
        time.time() - t0,
        len(content),
    )
    return content
