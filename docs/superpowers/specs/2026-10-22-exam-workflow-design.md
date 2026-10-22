# 建考链路提效设计（导入试题 / 组卷 / 考试管理）

- 日期：2026-10-22
- 状态：已确认（方案 A）
- 范围：管理后台试题→试卷→考试操作流；不动数据模型、不做数据库迁移（Phase 0 除外）

## 1. 背景与问题

管理员组织一场考试的现行链路冗长，痛点定位（经确认）：

| # | 痛点 | 根因 |
|---|---|---|
| 1 | 下载 Excel 模板 → 外部 AI 填题 → 回传导入，文件来回倒腾 | 平台自带「AI 出题」功能只存在于本地未提交的工作区代码，线上从未部署；服务器亦无 LLM_API_KEY |
| 2 | 试题管理 / 试卷管理 / 考试管理三页来回跳 | 一键建考向导（同样未部署）之外，向导第②步缺就地补题入口；考试「查看组卷」页只读，编辑必须跳去试卷管理 |
| 3 | 建考试必须先建课程并把学员分配到课程 | `POST /exams/quick-create` 强依赖 course_id，考生 = 课程分配人群，选人环节在向导之外 |

已确认的产品语义：分配粒度保持「课程」级。建考时选中的考生将同时被分配到考试所属课程（可见该课课件），此连带效果已获接受。

## 2. Phase 0：提交并部署存量功能（前置，不属于本设计的新增开发）

「AI 出题 + 一键建考」已完成开发且本地 228 个 pytest 全绿（2026-10-22 验证），但全部处于未提交状态：

- 后端：`app/llm/`、`app/routers/ai.py`、`app/schemas/ai_question.py`、`app/services/ai_question_service.py`、`app/services/exam_service.py`、`alembic/versions/b4d8f0a27c31_add_source_banks_to_exam_papers.py`、`tests/test_ai_*.py`、`test_exam_quick_create.py`、`test_questions_bulk_create.py`，及 config/main/models/exams/questions/student_exam/schemas 的修改
- 前端：`components/exam/`、`components/question/`、`pages/admin/ExamQuickCreate.tsx`，及 ExamManage / QuestionBank / QuestionManage 的修改

步骤：

1. 按现有工作流在本地 main 提交（commit message 英文）
2. 部署后端（git pull → alembic upgrade head → chown www-data → 重启 `learning-platform.service`）
3. 构建并部署前端（npm run build → rsync dist/）
4. 服务器 `.env` 配置 `LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL`（与本地 server/.env 同供应商；key 不入库不入文档）
5. 配置 key 前先在服务器 curl 供应商 API 验证出网连通性；不通则改选国内可达供应商并同步调整本地配置

验收：线上 `GET /api/learning-platform/ai/status` 返回 `{"enabled": true}`；试题管理页「AI 出题」按钮可点。

## 3. 向导内就地补题（痛点 1 + 2）

- 把 `web/src/pages/admin/QuestionManage.tsx` 内的 Excel 导入弹窗（showImport/importResult 一段，含模板下载）抽为 `web/src/components/question/ImportQuestionsModal.tsx`，行为与接口（`GET /questions/template`、`POST /questions/import`）不变；QuestionManage 改为引用该组件
- `ExamQuickCreate.tsx` 第②步头部「题库不够？去导入试题」链接升级为三个就地动作：
  - AI 出题：直接挂载现有 `AIGenerateModal`（props：categories、defaultCategoryId=当前选题分类）
  - Excel 导入：挂载 `ImportQuestionsModal`（category_id=当前选题分类）
  - 单题新增：保留跳转试题管理页的链接作兜底
- 弹窗入库成功后向 `QuestionPickerPanel` 传递刷新信号（自增 number 型 `refreshKey` prop，effect 依赖它重拉题目列表），新题立即可选
- 风险与缓解：
  - 向导上叠弹窗的层级/焦点问题 → z-index 提级；弹窗打开期间禁用向导步骤按钮
  - AIGenerateModal 假设自身为最外层弹窗 → 实现时先在向导内实测一遍

## 4. 组卷查看页直达编辑（痛点 2）

- `web/src/pages/admin/ExamPaper.tsx` 头部操作区新增「去编辑试卷」按钮：`navigate('/admin/papers/' + exam.paper_id)`（路由 `/admin/papers/:id` → PaperDetail 已存在）
- `ExamOut` 已含 `paper_id`，后端零改动；`paper_id` 为空（试卷已删）时不渲染按钮，保留现有文案引导

## 5. 建考时直接选考生（痛点 3）

前端（`ExamQuickCreate.tsx` 第③步「确认发布」）：

- 选定课程后 `GET /courses/{course_id}/assignments` 拉取现有分配，chips 展示（只读，不可在本向导移除）
- 内嵌现有 `web/src/components/course/DeptUserPicker`（部门树 + 全公司名册，与课程分配弹窗同源）勾选新增考生，增量语义（只加不减，与 `POST /courses/{id}/assignments` 幂等行为一致）
- 固定提示文案：「选中人员将同时被分配到课程《X》，可学习该课程课件」

后端（`server/app/schemas/exam.py` + `server/app/routers/exams.py`）：

- `ExamQuickCreate` 新增 `assign_user_ids: list[str] | None = None`
- `quick_create_exam` 事务内建考成功后，对其中尚无分配记录的用户补写 `CourseAssignment`（复用 `assign_course` 端点的先查再插幂等模式）；任何一步失败整体回滚（考试、组卷、分配同事务）
- `ExamQuickCreateOut` 新增 `assigned_new: int`；向导完成提示「已同步分配 N 名学员到课程《X》」
- 考生口径不变：学员端可见性、开考校验、department_scope 判定全部沿用现状，不新增旁路

## 6. 测试与验收

| 层 | 内容 |
|---|---|
| 后端 pytest | 扩展 `tests/test_exam_quick_create.py`：① 带 `assign_user_ids` 建考后生成对应 CourseAssignment 行；② 对已分配用户重复提交不产生重复行；③ 事务中途失败（如课程不存在）分配不残留；④ `assigned_new` 计数正确 |
| 前端构建 | `npm run build` 通过 |
| 手工走查（本地） | 向导全链路：第②步 AI 生成并勾选题 → 新题即时可勾选；Excel 导入同理；第③步选人 → 发布后以学员账号确认课程与考试均可见；组卷查看页跳转 PaperDetail |
| 线上 | 按 memory 中既有部署流程发布；`/api/learning-platform/ai/status` enabled；真实建一场 2 题小试考试端到端验证，验证后删除测试数据 |

## 7. 明确不做

- 不做「粘贴文本智能解析导入」（方案 B 内容）：Phase 0 部署后内置 AI 出题可用，Excel 倒腾动机消失；若两周后仍有外部存量题目导入需求再立项
- 不合并题库/试卷/考试三个菜单页（方案 C）
- 不引入考试级考生名单表（维持课程级分配）
- 不改 Excel 模板列结构与现有试卷管理页行为
