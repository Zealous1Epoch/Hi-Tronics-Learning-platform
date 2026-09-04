# 系统公告通知模块 -- 设计文档

> 日期: 2026-09-04
> 状态: 已确认

## 1. 概述

管理员在管理后台首页编辑发布公告，学员在首页查看公告列表，支持未读标记。

## 2. 数据模型

### 2.1 notices（公告表）

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | INT | PK AUTO_INCREMENT | |
| title | VARCHAR(200) | NOT NULL | 公告标题 |
| content | TEXT | NOT NULL | 公告内容（纯文本） |
| author_id | INT | FK → users.id, NOT NULL | 发布管理员 |
| status | ENUM('draft','published') | NOT NULL, DEFAULT 'draft' | 草稿/已发布 |
| is_pinned | TINYINT(1) | NOT NULL, DEFAULT 0 | 是否置顶 |
| created_at | DATETIME | NOT NULL, DEFAULT CURRENT_TIMESTAMP | |
| updated_at | DATETIME | NOT NULL, DEFAULT CURRENT_TIMESTAMP ON UPDATE | |

### 2.2 notice_reads（已读记录表）

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | INT | PK AUTO_INCREMENT | |
| notice_id | INT | FK → notices.id, NOT NULL | 关联公告 |
| user_id | INT | FK → users.id, NOT NULL | 学员 |
| read_at | DATETIME | NOT NULL, DEFAULT CURRENT_TIMESTAMP | |
| | | UNIQUE(notice_id, user_id) | 一人一条已读记录 |

## 3. API 设计

### 管理端

| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| POST | `/api/notices` | admin | 创建公告（body: title, content, status, is_pinned） |
| PUT | `/api/notices/{id}` | admin | 编辑公告 |
| DELETE | `/api/notices/{id}` | admin | 删除公告 |
| GET | `/api/notices` | admin | 列表（分页，status 过滤，含已读统计） |

### 学员端

| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| GET | `/api/notices/published` | 登录用户 | 已发布公告列表（含当前用户是否已读） |
| GET | `/api/notices/unread-count` | 登录用户 | 未读公告数 |
| POST | `/api/notices/{id}/read` | 登录用户 | 标记已读 |

### 响应示例

```
GET /api/notices/published
→ { notices: [{ id, title, content, created_at, is_pinned, is_read: bool }], total: 10 }

GET /api/notices/unread-count
→ { unread_count: 3 }
```

## 4. 管理端前端

### 位置

在 `admin/Dashboard.tsx` 增加一个公告卡片，不另建页面。

### 布局

- 卡片标题行：**公告管理** + 「+ 发布」按钮
- 点击「+ 发布」→ Modal 表单（标题 + 内容文本域 + 发布/草稿切换 + 置顶勾选）
- 下方：最近 5 条公告列表，每条显示：
  - 标题 + 发布时间 + 状态标签（已发布/草稿）
  - 已读人数 / 总学员数
  - 置顶标识
- 每条公告行右侧：编辑、删除操作按钮

### 交互

- 编辑 → 弹出 Modal 预填当前内容
- 删除 → 二次确认弹窗
- 发布/编辑/删除后 → 列表实时刷新

## 5. 学员端前端

### 位置

在 `student/Dashboard.tsx` 顶部增加一个系统公告卡片。

### 默认状态（折叠态）

- 标题行：**系统公告** + 未读小红点（数字）+ 展开/收起箭头
- 未读 > 0 时自动展开；已读全部时折叠

### 展开态

- 显示未读公告列表（置顶的优先），每条：标题 + 发布时间
- 点击某条 → 展开详情（完整内容），同时调标记已读接口
- 已读的公告以灰色/正常样式显示，无红点
- 列表底部：**「查看全部历史公告」** 链接（可弹出 Modal 查看所有已读公告）

### 数据加载

- 组件挂载时调 `GET /api/notices/published` + `GET /api/notices/unread-count`
- 标记已读后更新本地状态，小红点即时消失

## 6. 后端实现

### 新增文件

| 文件 | 内容 |
|------|------|
| `server/app/models/notice.py` | ORM 模型：Notice, NoticeRead |
| `server/app/schemas/notice.py` | Pydantic schema |
| `server/app/services/notice_service.py` | 业务逻辑 |
| `server/app/routers/notices.py` | 路由 |

### 修改文件

| 文件 | 改动 |
|------|------|
| `server/app/main.py` | 注册 `notices` router |
| `server/app/models/__init__.py` | 导出 notice 模型 |
| `server/app/database.py` | 确保新表自动创建（现有 lifespan 已做 Base.metadata.create_all） |

## 7. 权限

- 管理端公告接口：当前用户 role 为 admin 才可访问
- 学员端公告接口：任意登录用户可访问（通过 JWT 认证即可）

## 8. 风险

| 风险 | 缓解 |
|------|------|
| 大量学员标记已读导致 notice_reads 表膨胀 | 分页查询，给 notice_id + user_id 加联合索引；可定期清理 90 天前的数据 |
| 公告内容含 XSS | 学员端渲染时对内容做 HTML 转义，不允许富文本 |
| 并发重复标记已读 | UNIQUE 约束 + INSERT IGNORE / ON DUPLICATE KEY |