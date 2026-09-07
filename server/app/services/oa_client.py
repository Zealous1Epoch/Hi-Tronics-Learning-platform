"""OA 系统 API 客户端：获取人员信息"""

import hashlib
from datetime import datetime
from typing import TypedDict

import httpx

from app.config import settings
from app.logger import get_logger

logger = get_logger(__name__)


class OAEmployeeInfo(TypedDict, total=False):
    workcode: str
    lastname: str
    email: str
    departmentid: str
    subcompanyid1: str


def _md5(text: str) -> str:
    return hashlib.md5(text.encode("utf-8")).hexdigest().lower()


def _build_signature(system_id: str, password: str, timestamp: str) -> str:
    """生成 OA API 签名：md5(systemid + password + currentDateTime)"""
    raw = f"{system_id}{password}{timestamp}"
    return _md5(raw)


def _current_timestamp() -> str:
    """当前时间，格式 yyyyMMddHHmmss"""
    return datetime.now().strftime("%Y%m%d%H%M%S")


async def fetch_employee_by_workcode(workcode: str) -> OAEmployeeInfo | None:
    """按工号从 OA 系统查询员工信息"""
    base_url = settings.OA_API_BASE_URL
    system_id = settings.OA_SYSTEM_ID
    password = settings.OA_PASSWORD

    if not base_url or not system_id or not password:
        logger.warning("OA API 未配置（OA_API_BASE_URL / OA_SYSTEM_ID / OA_PASSWORD）")
        return None

    timestamp = _current_timestamp()
    signature = _build_signature(system_id, password, timestamp)

    payload = {
        "datajson": {
            "header": {
                "systemid": system_id,
                "currentDateTime": timestamp,
                "Md5": signature,
            },
            "operationinfo": {
                "operator": "system",
            },
            "mainTable": {
                "workcode": workcode,
            },
            "pageInfo": {
                "pageNo": 1,
                "pageSize": 10,
            },
        }
    }

    url = f"{base_url}/api/cube/restful/interface/getModeDataPageList/HTAIHRM"

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                url,
                data={"datajson": str(payload["datajson"])},
                headers={"Content-Type": "application/x-www-form-urlencoded; charset=utf-8"},
            )
            resp.raise_for_status()
            body = resp.json()
    except httpx.TimeoutException:
        logger.error("OA API 请求超时: workcode=%s", workcode)
        return None
    except httpx.HTTPStatusError as e:
        logger.error("OA API 返回异常: workcode=%s, status=%s", workcode, e.response.status_code)
        return None
    except Exception as e:
        logger.error("OA API 请求失败: workcode=%s, error=%s", workcode, str(e))
        return None

    # 解析返回结果
    results = body.get("result", [])
    if not results:
        logger.warning("OA API 未找到员工: workcode=%s", workcode)
        return None

    main_table = results[0].get("mainTable", {})
    return OAEmployeeInfo(
        workcode=main_table.get("workcode", ""),
        lastname=main_table.get("lastname", ""),
        email=main_table.get("email", ""),
        departmentid=str(main_table.get("departmentid", "")),
        subcompanyid1=str(main_table.get("subcompanyid1", "")),
    )