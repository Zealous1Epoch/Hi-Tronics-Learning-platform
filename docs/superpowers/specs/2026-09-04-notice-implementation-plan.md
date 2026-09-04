# 系统公告通知模块 -- 实现计划

> 基于设计文档 `2026-09-04-notice-design.md`，按执行顺序排列

## 实现顺序

1. 后端模型 + schema
2. 后端 service + router
3. 后端注册路由
4. 管理端 Dashboard 公告卡片
5. 学员端 Dashboard 公告卡片

---

## Step 1: ORM 模型

**新增 `server/app/models/notice.py`**

- `Notice` 表：id (UUID), title, content, author_id (FK → users), status ('draft'/'published'), is_pinned, created_at, updated_at
- `NoticeRead` 表：id (UUID), notice_id (FK → notices), user_id (FK → users), read_at, UNIQUE(notice_id, user_id)

ID 类型统一用 `String(36) UUID`，与现有模型一致（参考 `course.py`）。

**修改 `server/app/models/__init__.py`**
- 导入 `Notice`, `NoticeRead`
- 加入 `__all__`

---

## Step 2: Pydantic schema

**新增 `server/app/schemas/notice.py`**

- `NoticeCreate`: title, content, status (可选默认 draft), is_pinned (可选默认 false)
- `NoticeUpdate`: 同上，全 optional
- `NoticeResponse`: id, title, content, author_id, status, is_pinned, created_at, updated_at
- `NoticeAdminResponse`: 含 `read_count` / `total_users` 已读统计
- `NoticeStudentResponse`: 含 `is_read` 布尔
- `UnreadCountResponse`: unread_count

---

## Step 3: Service 层

**新增 `server/app/services/notice_service.py`**

- `create_notice(db, author_id, data)` → Notice
- `update_notice(db, notice_id, data)` → Notice
- `delete_notice(db, notice_id)`
- `get_notices(db, status, page, page_size)` → paginated NoticeAdminResponse
- `get_published_notices(db, user_id)` → list of NoticeStudentResponse
- `get_unread_count(db, user_id)` → int
- `mark_as_read(db, notice_id, user_id)` → mark/check
- `_get_total_users_count(db)` → int（用于已读统计）

---

## Step 4: Router

**新增 `server/app/routers/notices.py`**

管理端接口（依赖 `require_admin`）：
- `POST /api/notices` — 创建
- `PUT /api/notices/{id}` — 编辑
- `DELETE /api/notices/{id}` — 删除
- `GET /api/notices` — 列表（含分页，status 过滤，已读统计）

学员端接口（依赖 `get_current_user`）：
- `GET /api/notices/published` — 已发布列表（含当前用户是否已读）
- `GET /api/notices/unread-count` — 未读数
- `POST /api/notices/{id}/read` — 标记已读

---

## Step 5: 注册路由

**修改 `server/app/main.py`**
- 导入 `notices_router`
- `app.include_router(notices_router)`

---

## Step 6: 管理端 Dashboard 公告卡片

**修改 `web/src/pages/admin/Dashboard.tsx`**

新增组件 `AdminNoticePanel`（内联在同一文件）：
- 标题行：「公告管理」+「+ 发布」按钮
- 点击发布 → Modal 表单（标题 input + 内容 textarea + 发布/草稿 switch + 置顶 checkbox）
- 列表：最近 5 条，显示标题、时间、状态、已读人数/总人数
- 编辑、删除操作
- 删除前确认弹窗
- 操作后刷新列表

---

## Step 7: 学员端 Dashboard 公告卡片

**修改 `web/src/pages/student/Dashboard.tsx`**

在课程列表上方新增 `StudentNoticeCard` 组件（内联）：
- 折叠态：标题「系统公告」+ 未读红点数字 + 展开箭头
- 未读 > 0 自动展开
- 展开态：公告列表，每条点击展开详情并标记已读
- 底部「查看全部历史公告」→ Modal 展示所有历史
- 标记已读后即时更新小红点

---

## 风险

| 风险 | 缓解 |
|------|------|
| 学员端 Dashboard 已有的加载/空/错误状态与公告组件叠加 | 公告组件独立管理自己的 loading/error 状态，不干扰课程列表 |
| 管理端编辑已发布公告后，学员端缓存 | 学员端每次加载都调 API，不缓存 |
| 已读表并发插入 | UNIQUE 约束兜底，INSERT...ON DUPLICATE KEY |