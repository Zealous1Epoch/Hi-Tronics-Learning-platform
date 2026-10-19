"""全员名册镜像（org_members）与用户管理融合视图测试

源库通过 monkeypatch org_sync.fetch_source_rows 模拟，不依赖真实 MySQL。
"""

import io
import uuid
from datetime import datetime, timedelta

import pytest

from app.models.department import Department
from app.models.org_member import OrgMember, OrgSyncMeta
from app.models.user import User
from app.services import org_sync
from app.services.auth_service import hash_password


def make_source_rows(n=3):
    return [
        {
            "emp_id": f"00000{i}",
            "name": f"员工{i}",
            "position": "操作工",
            "dept_path": f"生产部>车间{i % 2}>班组{i}",
            "top_dept": "生产部",
            "supervisor_id": "000001",
            "seq": i,
            "imported_at": datetime(2026, 10, 15, 12, 0, 0),
        }
        for i in range(1, n + 1)
    ]


def add_user(db, username, employee_id=None, role="student", status="active", department=None, created_at=None):
    u = User(
        id=str(uuid.uuid4()),
        username=username,
        password_hash=hash_password("Pass123456"),
        name=f"用户{username}",
        employee_id=employee_id,
        role=role,
        status=status,
        department=department,
        created_at=created_at or datetime(2026, 1, 1),
    )
    db.add(u)
    db.commit()
    return u


# ────────────────────── 同步行为 ──────────────────────


def test_sync_success_replaces_and_meta(client, admin_headers, db, monkeypatch):
    monkeypatch.setattr(org_sync, "fetch_source_rows", lambda: make_source_rows(3))
    res = client.post("/api/org/sync", headers=admin_headers)
    assert res.status_code == 200
    body = res.json()
    assert body["imported"] == 3 and body["previous"] == 0
    assert db.query(OrgMember).count() == 3
    meta = db.get(OrgSyncMeta, 1)
    assert meta is not None and meta.row_count == 3
    assert meta.source_imported_at == datetime(2026, 10, 15, 12, 0, 0)

    # 再次同步 2 行（2 >= 3*50%，未触发骤降守卫）→ 全量替换
    monkeypatch.setattr(org_sync, "fetch_source_rows", lambda: make_source_rows(2))
    res = client.post("/api/org/sync", headers=admin_headers)
    assert res.status_code == 200
    assert res.json()["imported"] == 2 and res.json()["previous"] == 3
    assert db.query(OrgMember).count() == 2
    assert db.get(OrgSyncMeta, 1).row_count == 2


def test_sync_source_unavailable_keeps_mirror(client, admin_headers, db, monkeypatch):
    monkeypatch.setattr(org_sync, "fetch_source_rows", lambda: make_source_rows(3))
    assert client.post("/api/org/sync", headers=admin_headers).status_code == 200

    def boom():
        raise org_sync.OrgSourceUnavailable("connection refused")

    monkeypatch.setattr(org_sync, "fetch_source_rows", boom)
    res = client.post("/api/org/sync", headers=admin_headers)
    assert res.status_code == 502
    assert "不可达" in res.json()["detail"]
    # 旧镜像与 meta 完好
    assert db.query(OrgMember).count() == 3
    assert db.get(OrgSyncMeta, 1).row_count == 3


def test_sync_rejects_empty_and_shrunken_source(client, admin_headers, db, monkeypatch):
    # 首次同步空源 → 拒绝
    monkeypatch.setattr(org_sync, "fetch_source_rows", lambda: [])
    assert client.post("/api/org/sync", headers=admin_headers).status_code == 400

    monkeypatch.setattr(org_sync, "fetch_source_rows", lambda: make_source_rows(4))
    assert client.post("/api/org/sync", headers=admin_headers).status_code == 200

    # 骤降（1 < 4*50%）→ 拒绝且不动镜像
    monkeypatch.setattr(org_sync, "fetch_source_rows", lambda: make_source_rows(1))
    res = client.post("/api/org/sync", headers=admin_headers)
    assert res.status_code == 400
    assert "骤降" in res.json()["detail"]
    assert db.query(OrgMember).count() == 4


def test_org_endpoints_require_admin(client, student_headers, db, monkeypatch):
    monkeypatch.setattr(org_sync, "fetch_source_rows", lambda: make_source_rows(1))
    for path, method in [
        ("/api/org/members", "get"),
        ("/api/org/sync", "post"),
        ("/api/org/provision", "post"),
    ]:
        assert getattr(client, method)(path, headers=student_headers).status_code == 403
        assert getattr(client, method)(path).status_code == 401


# ────────────────────── 融合标注 ──────────────────────


def test_members_account_annotation(client, admin_headers, db, monkeypatch):
    monkeypatch.setattr(org_sync, "fetch_source_rows", lambda: make_source_rows(3))
    assert client.post("/api/org/sync", headers=admin_headers).status_code == 200

    # 000001 双账号：旧禁用 + 新启用 → 主账号应取启用态
    add_user(db, "old_acc", employee_id="000001", status="disabled", created_at=datetime(2026, 1, 1))
    new_acc = add_user(db, "new_acc", employee_id="000001", status="active", created_at=datetime(2026, 6, 1))
    # 空工号 + 工号不在名册 → unlinked（内置 admin 空工号也计入）
    add_user(db, "no_emp", employee_id=None)
    add_user(db, "ghost_emp", employee_id="999999")

    res = client.get("/api/org/members", headers=admin_headers)
    assert res.status_code == 200
    data = res.json()
    members = {m["emp_id"]: m for m in data["members"]}

    m1 = members["000001"]
    assert m1["account_count"] == 2
    assert m1["account"]["user_id"] == new_acc.id
    assert m1["account"]["status"] == "active"
    assert m1["account"]["employee_id"] == "000001"

    m2 = members["000002"]
    assert m2["account"] is None and m2["account_count"] == 0

    # unlinked：内置 admin（空工号）+ no_emp（空工号）+ ghost_emp（999999 不在名册）
    assert data["meta"]["unlinked_account_count"] == 3
    unlinked_names = {u["username"] for u in data["unlinked_accounts"]}
    assert {"no_emp", "ghost_emp", "admin"} <= unlinked_names


def test_members_meta_null_before_first_sync(client, admin_headers):
    res = client.get("/api/org/members", headers=admin_headers)
    assert res.status_code == 200
    body = res.json()
    assert body["meta"] is None
    assert body["members"] == []


# ────────────────────── 开通账号守卫 ──────────────────────


def test_create_user_duplicate_employee_id_400(client, admin_headers, db, monkeypatch):
    monkeypatch.setattr(org_sync, "fetch_source_rows", lambda: make_source_rows(1))
    assert client.post("/api/org/sync", headers=admin_headers).status_code == 200
    add_user(db, "existing", employee_id="000001")

    # 首尾空白归一后也应判重
    res = client.post(
        "/api/users",
        headers=admin_headers,
        json={
            "name": "重复工号",
            "username": "dup_user",
            "password": "Pass123456",
            "employee_id": "  000001  ",
            "role": "student",
        },
    )
    assert res.status_code == 400
    assert "已有账号" in res.json()["detail"]


def test_create_user_backfills_department_id(client, admin_headers, db):
    res = client.post(
        "/api/users",
        headers=admin_headers,
        json={
            "name": "建树用户",
            "username": "tree_user",
            "password": "Pass123456",
            "employee_id": "000123",
            "department": "生产部-测试车间-测试班组",
            "role": "student",
        },
    )
    assert res.status_code == 201
    body = res.json()
    assert body["department_id"]

    leaf = db.get(Department, body["department_id"])
    assert leaf.name == "测试班组"
    assert leaf.parent.name == "测试车间"
    assert leaf.parent.parent.name == "生产部"


# ────────────────────── 批量导入行为回归 ──────────────────────


def _xlsx_bytes(rows):
    import openpyxl

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(["姓名", "用户名", "密码", "工号", "部门", "角色"])
    for r in rows:
        ws.append(r)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def test_batch_import_backfills_dept_and_rejects_dup_emp(client, admin_headers, db, monkeypatch):
    monkeypatch.setattr(org_sync, "fetch_source_rows", lambda: make_source_rows(1))
    assert client.post("/api/org/sync", headers=admin_headers).status_code == 200
    add_user(db, "existing", employee_id="000001")

    content = _xlsx_bytes([
        ["重复工号者", "imp_dup", "Pass123456", "000001", "生产部", "学员"],   # 工号重复 → 跳过
        ["新员工", "imp_ok", "Pass123456", "000002", "生产部-新车间", "学员"],  # 部门自动建树 → 成功
    ])
    res = client.post(
        "/api/users/batch-import",
        headers=admin_headers,
        files={"file": ("t.xlsx", content, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["success_count"] == 1 and body["skip_count"] == 1

    imported = db.query(User).filter(User.username == "imp_ok").first()
    assert imported is not None and imported.department_id is not None
    leaf = db.get(Department, imported.department_id)
    assert leaf.name == "新车间"


# ────────────────────── 名册全员批量开通账号 ──────────────────────


def _sync_fixture(client, admin_headers, monkeypatch, n=3):
    monkeypatch.setattr(org_sync, "fetch_source_rows", lambda: make_source_rows(n))
    assert client.post("/api/org/sync", headers=admin_headers).status_code == 200


def test_provision_creates_passwordless_students(client, admin_headers, db, monkeypatch):
    _sync_fixture(client, admin_headers, monkeypatch, 3)

    res = client.post("/api/org/provision", headers=admin_headers)
    assert res.status_code == 200
    body = res.json()
    assert body == {
        "total": 3, "created": 3, "existing": 0,
        "conflict": 0, "conflict_samples": [], "no_employee_id": 0,
    }

    u = db.query(User).filter(User.username == "000001").one()
    assert u.password_hash is None
    assert u.employee_id == "000001"
    assert u.role == "student" and u.status == "active"
    # dept_path '>' 转 '-' 且挂上 Department 链
    assert u.department == "生产部-车间1-班组1"
    leaf = db.get(Department, u.department_id)
    assert leaf.name == "班组1" and leaf.parent.name == "车间1" and leaf.parent.parent.name == "生产部"


def test_provision_idempotent_and_skips_linked(client, admin_headers, db, monkeypatch):
    _sync_fixture(client, admin_headers, monkeypatch, 3)
    # 000002 已有手工账号（工号已关联）→ 应计入 existing 而不是重复建
    add_user(db, "manual_2", employee_id=" 000002 ")

    first = client.post("/api/org/provision", headers=admin_headers).json()
    assert first["created"] == 2 and first["existing"] == 1

    # 重复执行 → 全部 existing，不再新建
    second = client.post("/api/org/provision", headers=admin_headers).json()
    assert second["created"] == 0 and second["existing"] == 3
    assert db.query(User).filter(User.employee_id.isnot(None)).count() == 3


def test_provision_username_conflict_skipped(client, admin_headers, db, monkeypatch):
    _sync_fixture(client, admin_headers, monkeypatch, 3)
    # 存量账号占用了工号 000003 作为 username，但 employee_id 对不上 → conflict 跳过
    add_user(db, "000003", employee_id=None)

    body = client.post("/api/org/provision", headers=admin_headers).json()
    assert body["created"] == 2 and body["conflict"] == 1
    assert body["conflict_samples"] and "000003" in body["conflict_samples"][0]
    # 未被强行建重复 username（唯一键不炸）
    assert db.query(User).filter(User.username == "000003").count() == 1


def test_provision_empty_emp_id_skipped(client, admin_headers, db, monkeypatch):
    _sync_fixture(client, admin_headers, monkeypatch, 2)
    # 同步后再插空工号镜像行（sync 会全量替换，顺序不能反）
    db.add(OrgMember(emp_id="", name="无工号", dept_path="生产部", seq=99))
    db.commit()

    body = client.post("/api/org/provision", headers=admin_headers).json()
    assert body["total"] == 3 and body["created"] == 2 and body["no_employee_id"] == 1
    assert db.query(User).filter(User.username == "").count() == 0
