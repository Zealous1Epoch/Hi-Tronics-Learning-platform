# 开发日志

> 项目：Hi-Tronics 在线学习平台
> 仓库：https://github.com/Zealous1Epoch/Hi-Tronics-Learning-platform
> 开始日期：2026-09-01

---

## 当前进度

| 阶段 | 模块 | 状态 | 完成日期 |
|------|------|------|----------|
| P0-1 | 项目脚手架搭建 | 已完成 | 2026-09-01 |
| P0-2 | 数据库表创建 | 已完成 | 2026-09-01 |
| P0-3 | 内置账号登录 + JWT 认证 | 已完成 | 2026-09-01 |
| P0-4 | 用户管理 + 部门管理 | 已完成 | 2026-09-01 |
| P0-5 | 课程分类 + 课程 CRUD | 已完成 | 2026-09-01 |
| P0-6 | 视频上传 + 播放器（本地存储） | 已完成 | 2026-09-01 |
| P0-7 | 课程编辑页 | 已完成 | 2026-09-01 |
| P0-8 | 题库 CRUD | 已完成 | 2026-09-01 |
| P0-9 | 考试管理 + 组卷 | 已完成 | 2026-09-01 |
| P0-10 | 考试页面 + 自动打分 | 已完成 | 2026-09-01 |
| P0-11 | 学员端「我的课程」+ 视频播放 | 已完成 | 2026-09-01 |
| P0-12 | 学习进度上报 + 记录 | 已完成 | 2026-09-01 |
| P0-13 | 端到端联调 + 基础测试 | 已完成 | 2026-09-01 |
| P1-1 | 课程分配 | 已完成 | 2026-09-01 |
| P1-2 | 学员进度（管理后台） | 已完成 | 2026-09-01 |
| P1-3 | 个人学习档案（学员端） | 已完成 | 2026-09-01 |

---

## 技术决策记录

### 2026-09-01

| # | 决策 | 原因 |
|---|------|------|
| 1 | 技术栈：React + shadcn/ui + FastAPI + MySQL | 与 EHR Candidate 子项目一致，复用 kami 设计系统 |
| 2 | 视频存储：华为云 OBS + CDN | 公司已有华为云账号，兼容 S3 协议 |
| 3 | 用户体系：独立，企业微信 OAuth 扫码登录 | 与 EHR 用户体系分离，后期可独立运营 |
| 4 | 内置管理员：hitronics / Ht12345! | 首次登录入口，后续可提升其他企微用户为 admin |
| 5 | 课程完成标准：看完所有视频 + 通过考试 | 考试必选，确保学习效果 |
| 6 | 考试重考：不限次数 | 降低学员压力，鼓励反复学习 |
| 7 | 问答题打分：关键词匹配 | 自动打分，无需人工批改，语义相似度作为 P3 扩展 |
| 8 | 课程分配：管理员按人/部门分配 | 非自主选课，确保培训覆盖率 |
| 9 | 组卷方式：固定 + 随机 | 固定用于标准考核，随机用于防作弊 |
| 10 | 随机组卷时机：考生打开试卷时动态生成 | 防止泄题 |
| 11 | 不集成 Portal | 独立部署，不嵌入 EHR Portal iframe |
| 12 | 数据库：MySQL | 服务器已有 MySQL，不新增 PostgreSQL |
| 13 | 播放器：video.js | 成熟稳定，支持 HLS/MP4，皮肤可定制 |
| 14 | 前端状态管理：React Context + hooks | 不引入 Redux/Zustand，保持简单 |
| 15 | 设计系统：kami | 墨蓝 #1B365D + 象牙白 #faf9f5，与 EHR 全平台统一 |

---

## 报错及解决方案

### 2026-09-01

| # | 问题 | 原因 | 解决方案 |
|---|------|------|----------|
| 1 | 学员端看不到视频（播放器黑屏） | React 18 StrictMode 在开发模式下 double-mount 组件，video.js 的 `dispose()` 修改了 DOM 结构，导致第二次初始化失败 | 移除 `main.tsx` 中的 `<StrictMode>` 包裹 |
| 2 | 切换视频后第二个视频不显示 | `src` 变化时 `useEffect` 清理函数调用 `player.dispose()` 销毁了 DOM，新播放器无法复用被修改过的 DOM | `CourseDetail.tsx` 中给 VideoPlayer 加 `key={activeVideo.id}`，切换视频时强制 React 重建全新 DOM 元素 |
| 3 | `/api/questions/export` 返回 500 | 路由 `/questions/{question_id}` 捕获了 `export` 作为 ID | 将 `/questions/export`、`/questions/import`、`/questions/batch` 路由移到 `{question_id}` 之前 |

## 2026-09-01 改进

| 模块 | 内容 |
|------|------|
| 标签管理 | 新增 `question_tags` 表 + 树形标签管理页面 + 题目编辑改为标签库选择 |
| 批量操作 | 列表页 checkbox 多选 + 批量改难度/加标签/删除 |
| 导入导出 | Excel 模板导入导出（openpyxl），重复题干自动跳过 |
| 组卷优化 | 固定组卷：筛选栏 + 全选可见 + 右侧预览面板（拖拽排序、实时总分） |
| 组卷优化 | 随机组卷：生成预览 + 换一批 |
| 章节关联 | `questions` 表新增 `section` 字段，支持按章节出题 |

---

## 待开发事项

- [ ] 项目脚手架搭建（前后端）
- [ ] 数据库表创建（12 张表）
- [ ] 企业微信 OAuth 登录
- [ ] 用户管理 + 部门管理
- [ ] 课程分类 + 课程 CRUD
- [ ] 视频上传 OBS + 视频播放器
- [ ] 课程编辑页（视频章节管理 + 考试绑定）
- [ ] 题库 CRUD（5 种题型 + 关键词）
- [ ] 考试管理 + 组卷（固定 + 随机）
- [ ] 考试页面 + 自动打分
- [ ] 学员端「我的课程」+ 视频播放
- [ ] 学习进度上报 + 记录
- [ ] 端到端联调 + 基础测试
- [ ] 课程分配（按人/部门搜索多选）
- [ ] 学员进度（管理后台）+ 导出 Excel
- [ ] 个人学习档案（学员端）
---

## 2026-09-20 全量安全与正确性修复

由一次全量代码审查（静态审查 + 真实 MySQL 冒烟 + 并发压测 + 漏洞 PoC 复现）驱动，
集中修复了 2 个阻断级、8 个高危、以及若干功能缺陷与性能问题。详情见
`code-architecture-map.md` §6「全量修复记录」。

### 阻断级（P0）

| # | 问题 | 修复 |
|---|------|------|
| 1 | **考试评分可绕过**：`submit_exam` 的换算分母只累计「学生实际提交的题目」，5 题卷只交 1 题即可算出 100 分并通过（已 PoC 复现） | 分母改为「本次作答题目快照的分值之和」，未作答按 0 分计入；并限定提交题目必须属于本次快照 |
| 2 | **SSO 免密登录必然 500**：`sso.py` 查询 `User.workcode_hash`，但该字段既不在 ORM 模型也不在数据库（真实 MySQL 也没有该列） | 改用已有的 `employee_id` / `username` 查询；移除每次登录都执行的运行时 `ALTER TABLE` |
| 3 | **前后端端口错配**：前端 `/api` 代理指向 8002，而 8002 被「海创光电招聘系统」占用，平台实际不可用 | 代理目标改为 `VITE_PROXY_TARGET`，默认 `localhost:8100` |

### 高危（P1）

- 考试 `start_time` / `end_time` / `status` 服务端完全不校验 → 已截止考试仍可作答
- 复用未完成记录时重置 `started_at` → 刷新即可把倒计时归零；随机组卷每次刷新换一套题
- `GET /api/courses/{id}` 只校验登录 → 学员可读未分配课程（含视频 obs_key），配合视频接口可越权播放
- `/api/videos/stream/{file}` 主 token 分支不校验文件名与归属 → 越权播放任意视频
- 登录限流键取自客户端可伪造的 `X-Forwarded-For` → 实测伪造 8 个 IP 全部绕过；且反向代理部署时全公司共享 5 次/分钟额度
- 企微回调未知 `state` 仅打 warning 就继续登录 → CSRF 防护形同虚设
- `/api/questions/template` 无任何鉴权
- 删除考试会级联物理删除全部历史成绩，且无二次确认

### 功能缺陷

- `grade_question` 对选择题硬编码 10 分 → 试卷每题配分被忽略（已有测试把这个缺陷写成了断言，一并修正）
- 前端未作答判断题提交 `false` → 正确答案为「错误」时留空反而得分
- 课程叶子部门同名时按名字反查会算错人 → 统一改用 `department_id`
- 一名课程被创建第二个考试时静默覆盖 `course.exam_id`，旧考试变孤儿
- 删除视频/课程不清理 OSS 对象，存储只增不减
- PPT 转换的 PDF 在删除知识节点时不清理
- `Task.due_date` 直接与字符串比较，依赖数据库隐式转换

### 性能与工程质量

- 前端零代码分割，单包 2.68MB（gzip 774KB）→ 路由级按需加载后首屏约 86KB（gzip），**降幅约 89%**
- 部门树 / 知识节点树构建为 O(n²) → 降为 O(n)；分类树递归由 N+1 查询改为一次加载
- `admin_progress_overview` 加载全部学员的全部考试记录 → 在 SQL 层限定相关考试
- `/api/courses`、`/api/exams`、`/api/papers` 新增可选分页（`page`/`page_size` + `X-Total-Count`）
- 模块级字典（用户缓存 / 限流桶 / SSO code）无淘汰 → 增加上限与惰性清理
- 数据库新增唯一约束（`learning_progress`、`course_assignments`）与复合索引
- `server/test.db`、`server/app.db` 曾被 git 跟踪，跑测试即污染 diff → 已移出索引并加入 `.gitignore`
- SSO 回调路径在前端 dev 下必然 404 → 后端新增 `/api/sso/exchange` 别名，前后端前缀统一
- favicon 在 dev 下出现双 base 前缀 404 → 用 Vite 插件在 HTML 最终化阶段归一化
- ErrorBoundary 增加 `componentDidCatch` 与全局 `unhandledrejection` / `error` 监听

### 测试

- 新增 `server/tests/test_security_fixes.py`：20 个回归用例固化上述修复
- 修正 `tests/test_exam_flow.py` 中把缺陷当期望值的断言
- 修复 `tests/test_exam_flow.py` 的 `setup_exam` 未设置 `status="published"`（新规则下学员无法开考）
- 当前：`pytest tests/` → **33 passed**

### 未修复（需产品/运维决策）

- JWT 仍存 localStorage（XSS 面）→ 建议改 httpOnly Cookie + refresh token + CSP
- `.env` 中的阿里云 OSS 长期 AccessKey 建议轮换为 RAM 子账号 + STS
- `log_service.write_log()` 的即时 commit 属有意设计（保证审计日志不丢），未改动
- 多 worker 部署时，内存态的限流/缓存/SSO code 会各 worker 独立 → 需引入 Redis
- 前端 `<StrictMode>` 仍关闭（与命令式 video.js 冲突，详细原因见 `web/src/main.tsx`）
