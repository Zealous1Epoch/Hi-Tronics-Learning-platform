"""OA 系统 API 客户端：获取人员信息"""

import hashlib
import json
from datetime import datetime
from typing import TypedDict

import httpx

from app.config import settings
from app.logger import get_logger

logger = get_logger(__name__)

# 已知部门路径映射（id -> 完整路径，OA 管理员加上 supdepid 后可删除）
DEPARTMENT_PATH_MAP: dict[str, str] = {
    "287": "行政人事部-人事部",
    "628": "IT部-实施组",
    "629": "IT部-开发组",
    "630": "IT部-硬件网络组",
}


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
                "operator": workcode,  # 必须用有效工号，不能用 "system"
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

    # 解析返回结果（result 可能是数组或 JSON 字符串）
    raw = body.get("result", [])
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except (json.JSONDecodeError, TypeError):
            logger.error("OA API result 解析失败: workcode=%s, raw=%s", workcode, raw[:200])
            return None
    if not raw or not isinstance(raw, list):
        logger.warning("OA API 未找到员工: workcode=%s", workcode)
        return None

    main_table = raw[0].get("mainTable", {})
    return OAEmployeeInfo(
        workcode=main_table.get("workcode", ""),
        lastname=main_table.get("lastname", ""),
        email=main_table.get("email", ""),
        departmentid=str(main_table.get("departmentid", "")),
        subcompanyid1=str(main_table.get("subcompanyid1", "")),
    )


async def fetch_department_name(department_id: str) -> str | None:
    """从 OA 系统查询部门名称"""
    info = await _fetch_department_info(department_id)
    return info.get("departmentname") if info else None


async def fetch_full_department_path(department_id: str, operator: str | None = None) -> str | None:
    """获取完整的部门路径，例如 '行政人事部-人事部'、'IT部-实施组'

    Args:
        department_id: 部门 ID
        operator: 操作员工号，传有效工号避免 OA 的 OperatorError
    """
    # 1. 先查手动映射（OA 管理员加上 supdepid 后可删除此分支）
    if department_id in DEPARTMENT_PATH_MAP:
        return DEPARTMENT_PATH_MAP[department_id]

    # 2. 通过 API 递归查询（需要 OA 管理员配置了 supdepid 返回字段）
    parts = []
    seen: set[str] = set()
    current = department_id

    while current and current not in seen:
        seen.add(current)
        info = await _fetch_department_info(current, operator=operator)
        if not info:
            break

        name = info.get("departmentname", "")
        if name:
            parts.insert(0, name)  # 先插入父级，保持"父-子"顺序

        supdepid = info.get("supdepid")
        if supdepid and str(supdepid) != "0" and str(supdepid) != current:
            current = str(supdepid)
        else:
            break

    return "-".join(parts) if parts else None


async def _fetch_department_info(department_id: str, operator: str = "system") -> dict | None:
    """内部函数：查询 OA 部门信息，返回 departmentname + supdepid

    Args:
        department_id: 部门 ID
        operator: 操作员工号（某些接口需要有效工号，不能用 "system"）
    """
    base_url = settings.OA_API_BASE_URL
    system_id = settings.OA_SYSTEM_ID
    password = settings.OA_PASSWORD

    if not base_url or not system_id or not password or not department_id:
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
                "operator": operator,
            },
            "mainTable": {
                "id": department_id,
            },
            "pageInfo": {
                "pageNo": 1,
                "pageSize": 10,
            },
        }
    }

    url = f"{base_url}/api/cube/restful/interface/getModeDataPageList/AIZZJGBMB"

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                url,
                data={"datajson": str(payload["datajson"])},
                headers={"Content-Type": "application/x-www-form-urlencoded; charset=utf-8"},
            )
            resp.raise_for_status()
            body = resp.json()
    except Exception as e:
        logger.error("OA 部门 API 查询失败: id=%s, error=%s", department_id, str(e))
        return None

    raw = body.get("result", [])
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except (json.JSONDecodeError, TypeError):
            return None

    if raw and isinstance(raw, list):
        mt = raw[0].get("mainTable", {})
        name = mt.get("departmentname", "")
        supdepid = mt.get("supdepid", "")
        if name:
            return {"departmentname": name, "supdepid": str(supdepid) if supdepid else ""}

    return None