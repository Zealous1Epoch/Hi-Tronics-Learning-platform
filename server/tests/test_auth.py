"""认证模块集成测试"""


def test_login_success(client):
    """管理员登录成功"""
    res = client.post("/api/auth/login", json={
        "username": "admin",
        "password": "TestAdmin123!",
    })
    assert res.status_code == 200
    data = res.json()
    assert "access_token" in data
    assert data["user"]["role"] == "admin"
    assert data["user"]["username"] == "admin"


def test_login_wrong_password(client):
    """密码错误应返回 401"""
    res = client.post("/api/auth/login", json={
        "username": "admin",
        "password": "WrongPassword!",
    })
    assert res.status_code == 401


def test_login_disabled_user(client, admin_headers, db):
    """禁用用户无法登录"""
    from app.models.user import User
    from app.services.auth_service import hash_password
    import uuid

    user = User(
        id=str(uuid.uuid4()),
        username="disabled_user",
        password_hash=hash_password("Test123!"),
        name="被禁用用户",
        role="student",
        status="disabled",
    )
    db.add(user)
    db.commit()

    res = client.post("/api/auth/login", json={
        "username": "disabled_user",
        "password": "Test123!",
    })
    assert res.status_code == 403


def test_get_me(admin_headers, client):
    """获取当前用户信息"""
    res = client.get("/api/auth/me", headers=admin_headers)
    assert res.status_code == 200
    data = res.json()
    assert data["username"] == "admin"
    assert data["role"] == "admin"


def test_unauthorized_access(client):
    """未认证请求应返回 401"""
    res = client.get("/api/auth/me")
    assert res.status_code == 401


def test_invalid_token(client):
    """无效 token 应返回 401"""
    res = client.get("/api/auth/me", headers={"Authorization": "Bearer invalid_token"})
    assert res.status_code == 401


def test_student_cannot_access_admin(client, student_headers):
    """学员不能访问管理接口"""
    res = client.get("/api/users", headers=student_headers)
    assert res.status_code == 403


def test_admin_can_access_users(client, admin_headers):
    """管理员可以访问用户列表"""
    res = client.get("/api/users", headers=admin_headers)
    assert res.status_code == 200
    assert isinstance(res.json(), list)


def test_health_check(client):
    """健康检查接口"""
    res = client.get("/api/health")
    assert res.status_code == 200
    assert res.json()["status"] == "ok"