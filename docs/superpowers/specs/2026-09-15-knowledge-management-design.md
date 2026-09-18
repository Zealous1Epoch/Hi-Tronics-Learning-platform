# 知识管理功能 -- 设计文档

> 日期: 2026-09-15
> 状态: 设计中

## 1. 概述

在现有的 `KnowledgeNode` 树形目录基础上，扩展为可视化的**知识地图**。管理员通过画布式界面管理知识节点并上传课件资料（PPT/PDF/HTML/PNG 等），学员通过 Prezi 式聚焦浏览地图并下载课件。

**核心交互：**
- 管理端：React Flow 画布，支持拖拽定位、右键菜单编辑、文件上传
- 学员端：同一画布只读模式，点击节点触发 Prezi 式聚焦动画，叶子节点展开详情

## 2. 数据模型

### 2.1 knowledge_nodes 表（扩展现有）

在现有字段基础上新增：

| 字段 | 类型 | 说明 |
|------|------|------|
| `position_x` | float, nullable | 手动拖拽后的 X 坐标 |
| `position_y` | float, nullable | 手动拖拽后的 Y 坐标 |
| `content` | text, nullable | 富文本正文 HTML |
| `status` | varchar(20), default 'draft' | draft / published |

已有字段保持不变：`id`, `title`, `description`, `parent_id`, `sort_order`, `created_at`, `updated_at`

### 2.2 knowledge_files 表（新建）

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | varchar(36) PK | UUID |
| `node_id` | varchar(36) FK -> knowledge_nodes.id | 归属节点 |
| `original_name` | varchar(500) | 原始文件名 |
| `obs_key` | varchar(500) | 存储路径/文件名 |
| `file_size` | int | 字节数 |
| `file_type` | varchar(20) | pdf/ppt/pptx/docx/xlsx/html/png/jpg |
| `sort_order` | int, default 0 | 排序 |
| `created_at` | datetime | 创建时间 |

## 3. 后端 API

### 3.1 管理端（需要 admin 权限）

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/knowledge-nodes` | 获取节点树（已有，扩展返回 content/position/files） |
| `POST` | `/api/knowledge-nodes` | 创建节点（已有，扩展 content 字段） |
| `PUT` | `/api/knowledge-nodes/{id}` | 更新节点（已有，扩展 content/position 字段） |
| `DELETE` | `/api/knowledge-nodes/{id}` | 删除节点（已有，保留递归删子节点逻辑） |
| `PUT` | `/api/knowledge-nodes/positions` | 批量保存节点坐标 |
| `POST` | `/api/knowledge-nodes/{id}/files` | 上传课件文件（multipart） |
| `DELETE` | `/api/knowledge-files/{id}` | 删除文件 |

### 3.2 学员端（需要登录）

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/student/knowledge-nodes` | 获取已发布节点树（含文件列表） |
| `GET` | `/api/student/knowledge-nodes/{id}` | 节点详情 |
| `GET` | `/api/student/knowledge-files/{id}/download` | 下载文件 |

### 3.3 文件存储

- 本地存储目录：`server/uploads/knowledge/`
- 上传方式：`multipart/form-data`，字段名 `file`
- 单文件限制：50MB
- 文件名：`{uuid}.{ext}`
- 响应：`{ filename, original_name, file_size, file_type }`

## 4. 前端架构

### 4.1 共享组件

| 组件 | 说明 |
|------|------|
| `KnowledgeCanvas.tsx` | React Flow 画布包装，处理节点/边渲染、zoom/pan、小地图 |
| `KnowledgeNodeCard.tsx` | 自定义节点卡片，根据层级不同尺寸（一级 200x120、二级 160x100、叶子 140x80） |
| `KnowledgeEdge.tsx` | 自定义贝塞尔连线，线宽随层级递减 |

### 4.2 管理端（`/admin/knowledge`）

| 组件 | 说明 |
|------|------|
| `KnowledgeManage.tsx` | 顶层，组装画布 + 工具栏 + 编辑弹窗 |
| `KnowledgeToolbar.tsx` | 浮动工具栏：新建根节点、保存布局 |
| `KnowledgeContextMenu.tsx` | 右键菜单：添加子节点、编辑、删除、上传文件 |
| `KnowledgeEditModal.tsx` | 编辑模态框：标题 + TipTap 富文本 + 文件上传/管理 |

### 4.3 学员端（`/student/knowledge`）

| 组件 | 说明 |
|------|------|
| `KnowledgeBrowse.tsx` | 顶层，组装只读画布 + 搜索 + 面包屑 + 详情 |
| `SearchBar.tsx` | 顶部搜索框，输入关键词高亮匹配节点 |
| `BreadcrumbNav.tsx` | 面包屑导航，点击任意层级回退聚焦 |
| `NodeDetailPanel.tsx` | 叶子节点详情：富文本渲染 + 可下载文件列表 |

### 4.4 路由

- 管理端：已注册 `/admin/knowledge`，无需改动
- 学员端：在 `StudentLayout.tsx` 中新增 `/student/knowledge` 路由，导航栏新增「知识地图」入口

## 5. 交互流程

### 5.1 学员浏览流程

1. 进入 `/student/knowledge`，画布鸟瞰展示根节点
2. 滚轮缩放/拖拽平移浏览
3. 点击节点 -> Prezi 动画 zoom + pan 将其居中，子节点浮现
4. 面包屑更新，可点击回退
5. 点击叶子节点 -> 节点展开为详情面板（富文本正文 + 文件列表）
6. 点击文件触发下载

### 5.2 管理编辑流程

1. 进入 `/admin/knowledge`，画布展示所有节点（含草稿）
2. 工具栏「+ 新建根节点」-> 弹出编辑弹窗
3. 右键节点 -> 选择操作
4. 拖拽节点改变位置，拖到另一节点上方改变父子关系
5. 编辑弹窗内 TipTap 写正文，拖拽文件上传
6. 「发布」按钮将 status 改为 published

## 6. 技术依赖

### 6.1 新增

```
前端：
@xyflow/react   -- React Flow 画布引擎
@tiptap/react   -- 富文本编辑器
@tiptap/starter-kit
@tiptap/extension-image
dagre            -- 自动树形布局算法

后端：
无新增依赖
```

### 6.2 已有复用

- 文件上传：复用 `server/uploads/` 本地存储模式
- 认证：复用现有 JWT 中间件
- 日志：复用 `write_log`
- 设计系统：kami（墨蓝 #1B365D、象牙白 #faf9f5、羊皮纸 #f5f4ed）

## 7. 自动布局

使用 `dagre` 将树形 JSON 转换为节点坐标：

1. 首次加载时，对没有 `position_x` 的节点运行 dagre 计算坐标
2. 管理端手动拖拽后，坐标写入数据库覆盖自动值
3. 新增节点默认放在父节点右下偏移处

## 8. 数据库迁移

Alembic 迁移内容：
1. `knowledge_nodes` 表新增 `position_x`、`position_y`、`content`、`status` 列
2. 新建 `knowledge_files` 表
3. 存量数据 `status` 默认设为 `published`