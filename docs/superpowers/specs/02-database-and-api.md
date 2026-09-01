# 企业在线学习平台 -- 数据库与 API 设计参考

> 配套文档: [01-platform-architecture.md](./01-platform-architecture.md)

---

## 目录

1. [数据库表设计](#1-数据库表设计)
2. [API 接口设计](#2-api-接口设计)
3. [状态枚举定义](#3-状态枚举定义)

---

## 1. 数据库表设计

### 1.1 用户与组织

```sql
-- 部门表
CREATE TABLE departments (
    id          BIGSERIAL PRIMARY KEY,
    name        VARCHAR(100) NOT NULL,
    parent_id   BIGINT REFERENCES departments(id),
    sort_order  INT DEFAULT 0,
    created_at  TIMESTAMP DEFAULT NOW(),
    updated_at  TIMESTAMP DEFAULT NOW()
);

-- 岗位表
CREATE TABLE positions (
    id            BIGSERIAL PRIMARY KEY,
    name          VARCHAR(100) NOT NULL,
    department_id BIGINT REFERENCES departments(id),
    created_at    TIMESTAMP DEFAULT NOW()
);

-- 用户表
CREATE TABLE users (
    id                  BIGSERIAL PRIMARY KEY,
    username            VARCHAR(50) UNIQUE NOT NULL,
    name                VARCHAR(100) NOT NULL,
    employee_id         VARCHAR(50) UNIQUE,
    password_hash       VARCHAR(255) NOT NULL,
    department_id       BIGINT REFERENCES departments(id),
    position_id         BIGINT REFERENCES positions(id),
    virtual_superior_id BIGINT REFERENCES users(id),
    avatar              VARCHAR(500),
    signature           VARCHAR(200),
    company             VARCHAR(200),
    status              VARCHAR(20) DEFAULT 'active',  -- active, frozen, expired
    created_at          TIMESTAMP DEFAULT NOW(),
    updated_at          TIMESTAMP DEFAULT NOW()
);

-- 角色表
CREATE TABLE roles (
    id          BIGSERIAL PRIMARY KEY,
    name        VARCHAR(50) NOT NULL,     -- 系统管理员, 讲师, 培训管理员, 学员
    level       VARCHAR(10),              -- L1, L2, L3
    type        VARCHAR(20) DEFAULT 'admin',  -- admin, student
    created_at  TIMESTAMP DEFAULT NOW()
);

-- 用户-角色关联表
CREATE TABLE user_roles (
    id      BIGSERIAL PRIMARY KEY,
    user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
    role_id BIGINT REFERENCES roles(id) ON DELETE CASCADE,
    UNIQUE(user_id, role_id)
);

-- 群组表
CREATE TABLE groups (
    id          BIGSERIAL PRIMARY KEY,
    name        VARCHAR(100) NOT NULL,
    description TEXT,
    created_at  TIMESTAMP DEFAULT NOW()
);

-- 群组-用户关联表
CREATE TABLE group_members (
    id       BIGSERIAL PRIMARY KEY,
    group_id BIGINT REFERENCES groups(id) ON DELETE CASCADE,
    user_id  BIGINT REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(group_id, user_id)
);
```

### 1.2 课程体系

```sql
-- 课程分类表
CREATE TABLE course_categories (
    id         BIGSERIAL PRIMARY KEY,
    name       VARCHAR(50) NOT NULL,      -- 领导力, 综合管理, ...
    sort_order INT DEFAULT 0
);

-- 讲师表
CREATE TABLE instructors (
    id            BIGSERIAL PRIMARY KEY,
    name          VARCHAR(100) NOT NULL,
    title         VARCHAR(100),
    level         VARCHAR(50),            -- 预备讲师, 正式讲师
    avatar        VARCHAR(500),
    intro         TEXT,
    course_count  INT DEFAULT 0,
    student_count INT DEFAULT 0,
    created_at    TIMESTAMP DEFAULT NOW()
);

-- 课程表
CREATE TABLE courses (
    id                   BIGSERIAL PRIMARY KEY,
    title                VARCHAR(200) NOT NULL,
    cover_image          VARCHAR(500),
    category_id          BIGINT REFERENCES course_categories(id),
    instructor_id        BIGINT REFERENCES instructors(id),
    duration             DECIMAL(5,1),     -- 学时
    credits              DECIMAL(5,1),     -- 学分
    completion_condition VARCHAR(30) DEFAULT 'course_study',
        -- course_study, course_evaluation, after_test, course_exam
    course_type          VARCHAR(20) DEFAULT 'optional',  -- optional, required
    recommend_status     VARCHAR(20) DEFAULT 'normal',    -- recommended, normal
    discussion_count     INT DEFAULT 0,
    like_count           INT DEFAULT 0,
    favorite_count       INT DEFAULT 0,
    rating               DECIMAL(2,1),
    status               VARCHAR(20) DEFAULT 'published',
    publish_date         TIMESTAMP DEFAULT NOW(),
    created_at           TIMESTAMP DEFAULT NOW(),
    updated_at           TIMESTAMP DEFAULT NOW()
);

-- 专题/专题速递
CREATE TABLE topics (
    id          BIGSERIAL PRIMARY KEY,
    name        VARCHAR(200) NOT NULL,
    cover_image VARCHAR(500),
    description TEXT,
    created_at  TIMESTAMP DEFAULT NOW()
);

-- 专题-课程关联
CREATE TABLE topic_courses (
    id         BIGSERIAL PRIMARY KEY,
    topic_id   BIGINT REFERENCES topics(id) ON DELETE CASCADE,
    course_id  BIGINT REFERENCES courses(id) ON DELETE CASCADE,
    sort_order INT DEFAULT 0,
    UNIQUE(topic_id, course_id)
);
```

### 1.3 题库与试题

```sql
-- 题库分类表
CREATE TABLE question_bank_categories (
    id         BIGSERIAL PRIMARY KEY,
    name       VARCHAR(100) NOT NULL,
    parent_id  BIGINT REFERENCES question_bank_categories(id),
    created_at TIMESTAMP DEFAULT NOW()
);

-- 题库表
CREATE TABLE question_banks (
    id                        BIGSERIAL PRIMARY KEY,
    name                      VARCHAR(200) NOT NULL,
    category_id               BIGINT REFERENCES question_bank_categories(id),
    creator_id                BIGINT REFERENCES users(id),
    single_choice_count       INT DEFAULT 0,
    multi_choice_count        INT DEFAULT 0,
    true_false_count          INT DEFAULT 0,
    fill_blank_count          INT DEFAULT 0,
    essay_count               INT DEFAULT 0,
    true_false_correct_count  INT DEFAULT 0,
    multi_fill_blank_count    INT DEFAULT 0,
    comprehensive_count       INT DEFAULT 0,
    created_at                TIMESTAMP DEFAULT NOW(),
    updated_at                TIMESTAMP DEFAULT NOW()
);

-- 题库授权表
CREATE TABLE bank_authorizations (
    id       BIGSERIAL PRIMARY KEY,
    bank_id  BIGINT REFERENCES question_banks(id) ON DELETE CASCADE,
    user_id  BIGINT REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(bank_id, user_id)
);

-- 试题表
CREATE TABLE questions (
    id          BIGSERIAL PRIMARY KEY,
    bank_id     BIGINT REFERENCES question_banks(id) ON DELETE CASCADE,
    type        VARCHAR(30) NOT NULL,
        -- single_choice, multi_choice, true_false,
        -- fill_blank, essay, true_false_correct,
        -- multi_fill_blank, comprehensive
    stem        TEXT NOT NULL,          -- 题干
    options     JSONB,                  -- 选项 [{label: "A", content: "..."}]
    answer      JSONB NOT NULL,         -- 答案 {correct: ["A"], explanation: "..."}
    difficulty  VARCHAR(10) DEFAULT 'medium',  -- easy, medium, hard
    score       DECIMAL(5,1) DEFAULT 1.0,
    tags        TEXT[],                 -- 知识点标签
    creator_id  BIGINT REFERENCES users(id),
    is_deleted  BOOLEAN DEFAULT FALSE,  -- 回收站标记
    created_at  TIMESTAMP DEFAULT NOW(),
    updated_at  TIMESTAMP DEFAULT NOW()
);

-- 索引
CREATE INDEX idx_questions_bank_id ON questions(bank_id);
CREATE INDEX idx_questions_type ON questions(type);
CREATE INDEX idx_questions_tags ON questions USING GIN(tags);
```

### 1.4 试卷与考试

```sql
-- 试卷表
CREATE TABLE exam_papers (
    id          BIGSERIAL PRIMARY KEY,
    name        VARCHAR(200) NOT NULL,
    type        VARCHAR(20) DEFAULT 'fixed',  -- fixed, random
    total_score DECIMAL(6,1) DEFAULT 0,
    duration    INT DEFAULT 60,               -- 考试时长(分钟)
    config      JSONB NOT NULL,               -- 组卷配置
    creator_id  BIGINT REFERENCES users(id),
    created_at  TIMESTAMP DEFAULT NOW(),
    updated_at  TIMESTAMP DEFAULT NOW()
);

-- 考试分类表
CREATE TABLE exam_categories (
    id         BIGSERIAL PRIMARY KEY,
    name       VARCHAR(100) NOT NULL,
    parent_id  BIGINT REFERENCES exam_categories(id),
    created_at TIMESTAMP DEFAULT NOW()
);

-- 考试表
CREATE TABLE exams (
    id            BIGSERIAL PRIMARY KEY,
    code          VARCHAR(30) UNIQUE NOT NULL,  -- 考试编号
    name          VARCHAR(200) NOT NULL,
    category_id   BIGINT REFERENCES exam_categories(id),
    paper_id      BIGINT REFERENCES exam_papers(id),
    source        VARCHAR(50),                   -- 时光易培, 安排课程, ...
    type          VARCHAR(20) DEFAULT 'online',  -- online, offline
    start_time    TIMESTAMP NOT NULL,
    end_time      TIMESTAMP NOT NULL,
    status        VARCHAR(20) DEFAULT 'draft',
        -- draft, reviewing, not_started, in_progress, ended, cancelled
    creator_id    BIGINT REFERENCES users(id),
    created_at    TIMESTAMP DEFAULT NOW(),
    updated_at    TIMESTAMP DEFAULT NOW()
);
```

### 1.5 人才测评

```sql
-- 测评项目表
CREATE TABLE assessment_projects (
    id             BIGSERIAL PRIMARY KEY,
    name           VARCHAR(200) NOT NULL,
    product_type   VARCHAR(100),           -- 匹配产品
    template_type  VARCHAR(30),            -- skill, personality, value, logic
    theory         VARCHAR(30),            -- OCEAN, DISC, MBTI, PDP, WVI
    description    TEXT,
    deadline       TIMESTAMP,
    progress       INT DEFAULT 0,
    status         VARCHAR(20) DEFAULT 'draft',
        -- draft, not_started, in_progress, disabled, ended
    source         VARCHAR(50) DEFAULT '人才测评',
    creator_id     BIGINT REFERENCES users(id),
    created_at     TIMESTAMP DEFAULT NOW(),
    updated_at     TIMESTAMP DEFAULT NOW()
);
```

### 1.6 激励体系

```sql
-- 学分记录表
CREATE TABLE credit_records (
    id          BIGSERIAL PRIMARY KEY,
    user_id     BIGINT REFERENCES users(id),
    amount      DECIMAL(5,1) NOT NULL,
    source      VARCHAR(30),           -- course, exam, activity
    source_id   BIGINT,                -- 关联课程/考试 ID
    description TEXT,
    created_at  TIMESTAMP DEFAULT NOW()
);

-- 积分记录表
CREATE TABLE point_records (
    id          BIGSERIAL PRIMARY KEY,
    user_id     BIGINT REFERENCES users(id),
    amount      INT NOT NULL,
    type        VARCHAR(20),           -- earn, spend
    source      VARCHAR(50),
    description TEXT,
    created_at  TIMESTAMP DEFAULT NOW()
);

-- 学分排行榜快照表
CREATE TABLE leaderboard_snapshots (
    id           BIGSERIAL PRIMARY KEY,
    period_type  VARCHAR(10) NOT NULL,   -- week, month, quarter, year
    period_value VARCHAR(20) NOT NULL,   -- 2026-W35, 2026-08, 2026-Q3, 2026
    company      VARCHAR(200),
    rank_data    JSONB NOT NULL,         -- [{user_id, rank, credits}]
    created_at   TIMESTAMP DEFAULT NOW()
);
```

### 1.7 证书管理

```sql
-- 证书类别表
CREATE TABLE certificate_categories (
    id         BIGSERIAL PRIMARY KEY,
    name       VARCHAR(100) NOT NULL,
    parent_id  BIGINT REFERENCES certificate_categories(id),
    created_at TIMESTAMP DEFAULT NOW()
);

-- 证书表
CREATE TABLE certificates (
    id              BIGSERIAL PRIMARY KEY,
    name            VARCHAR(200) NOT NULL,
    code            VARCHAR(50) UNIQUE NOT NULL,  -- 证书编号
    category_id     BIGINT REFERENCES certificate_categories(id),
    source          VARCHAR(30) DEFAULT 'online', -- online, offline
    validity        VARCHAR(50) DEFAULT 'permanent', -- permanent, 1_year, ...
    issuing_agency  VARCHAR(200),                  -- 发证机构
    creator_id      BIGINT REFERENCES users(id),
    created_at      TIMESTAMP DEFAULT NOW()
);

-- 证书获得记录表
CREATE TABLE certificate_recipients (
    id              BIGSERIAL PRIMARY KEY,
    certificate_id  BIGINT REFERENCES certificates(id) ON DELETE CASCADE,
    user_id         BIGINT REFERENCES users(id) ON DELETE CASCADE,
    obtained_at     TIMESTAMP DEFAULT NOW(),
    UNIQUE(certificate_id, user_id)
);
```

### 1.8 知识管理

```sql
-- 知识分类表
CREATE TABLE knowledge_categories (
    id         BIGSERIAL PRIMARY KEY,
    name       VARCHAR(100) NOT NULL,
    parent_id  BIGINT REFERENCES knowledge_categories(id),
    created_at TIMESTAMP DEFAULT NOW()
);

-- 知识表
CREATE TABLE knowledge_articles (
    id          BIGSERIAL PRIMARY KEY,
    title       VARCHAR(200) NOT NULL,
    content     TEXT,
    category_id BIGINT REFERENCES knowledge_categories(id),
    tags        TEXT[],
    is_top      BOOLEAN DEFAULT FALSE,
    is_recommended BOOLEAN DEFAULT FALSE,
    type        VARCHAR(30),           -- article, video, file
    status      VARCHAR(20) DEFAULT 'published',
    creator_id  BIGINT REFERENCES users(id),
    created_at  TIMESTAMP DEFAULT NOW(),
    updated_at  TIMESTAMP DEFAULT NOW()
);
```

### 1.9 培训管理

```sql
-- 培训计划表 (安排课程)
CREATE TABLE training_plans (
    id          BIGSERIAL PRIMARY KEY,
    name        VARCHAR(200) NOT NULL,
    code        VARCHAR(50) UNIQUE,
    category_id BIGINT REFERENCES plan_categories(id),
    status      VARCHAR(20) DEFAULT 'draft',
    tags        TEXT[],
    start_date  DATE,
    end_date    DATE,
    creator_id  BIGINT REFERENCES users(id),
    created_at  TIMESTAMP DEFAULT NOW()
);

-- 培训项目表 (时光易培)
CREATE TABLE training_projects (
    id          BIGSERIAL PRIMARY KEY,
    name        VARCHAR(200) NOT NULL,
    code        VARCHAR(50) UNIQUE,
    category    VARCHAR(100),
    type        VARCHAR(50),           -- 混合式/线上/线下
    plan_id     BIGINT REFERENCES training_plans(id),
    status      VARCHAR(20) DEFAULT 'draft',
    tags        TEXT[],
    start_date  DATE,
    end_date    DATE,
    creator_id  BIGINT REFERENCES users(id),
    created_at  TIMESTAMP DEFAULT NOW()
);

-- 调查表
CREATE TABLE surveys (
    id                BIGSERIAL PRIMARY KEY,
    name              VARCHAR(200) NOT NULL,
    code              VARCHAR(50) UNIQUE,
    questionnaire_id  BIGINT,           -- 关联问卷
    source            VARCHAR(50),      -- 时光易培, 安排课程, ...
    status            VARCHAR(20) DEFAULT 'draft', -- draft, in_progress, ended
    collect_status    VARCHAR(20) DEFAULT 'collecting', -- collecting, finished
    start_date        DATE,
    end_date          DATE,
    creator_id        BIGINT REFERENCES users(id),
    created_at        TIMESTAMP DEFAULT NOW()
);

-- 直播间表
CREATE TABLE live_rooms (
    id          BIGSERIAL PRIMARY KEY,
    name        VARCHAR(200) NOT NULL,
    category_id BIGINT,
    status      VARCHAR(20),           -- 直播中/已结束/未开始
    delay_type  VARCHAR(20),           -- 实时/延迟
    scene       VARCHAR(50),           -- 培训/会议/活动
    admin_id    BIGINT REFERENCES users(id),
    tags        TEXT[],
    creator_id  BIGINT REFERENCES users(id),
    created_at  TIMESTAMP DEFAULT NOW()
);
```

### 1.10 360评估

```sql
-- 360评估项目表
CREATE TABLE evaluation_360 (
    id          BIGSERIAL PRIMARY KEY,
    name        VARCHAR(200) NOT NULL,
    code        VARCHAR(50) UNIQUE,
    type        VARCHAR(30) DEFAULT '360',  -- 360, competency(胜任力)
    template_id BIGINT,                     -- 模板ID
    status      VARCHAR(20) DEFAULT 'draft',
    creator_id  BIGINT REFERENCES users(id),
    created_at  TIMESTAMP DEFAULT NOW()
);
```

### 1.11 练习与竞赛

```sql
-- 练习表
CREATE TABLE exercises (
    id          BIGSERIAL PRIMARY KEY,
    name        VARCHAR(200) NOT NULL,
    bank_id     BIGINT REFERENCES question_banks(id),
    config      JSONB,               -- 练习配置
    status      VARCHAR(20) DEFAULT 'draft',
    creator_id  BIGINT REFERENCES users(id),
    created_at  TIMESTAMP DEFAULT NOW()
);

-- 竞赛表
CREATE TABLE contests (
    id          BIGSERIAL PRIMARY KEY,
    name        VARCHAR(200) NOT NULL,
    paper_id    BIGINT REFERENCES exam_papers(id),
    rules       JSONB,               -- 竞赛规则
    start_time  TIMESTAMP,
    end_time    TIMESTAMP,
    status      VARCHAR(20) DEFAULT 'draft',
    creator_id  BIGINT REFERENCES users(id),
    created_at  TIMESTAMP DEFAULT NOW()
);

-- 竞赛排行榜表
CREATE TABLE contest_leaderboards (
    id          BIGSERIAL PRIMARY KEY,
    contest_id  BIGINT REFERENCES contests(id) ON DELETE CASCADE,
    user_id     BIGINT REFERENCES users(id),
    score       DECIMAL(6,1),
    duration    INT,                 -- 答题用时(秒)
    rank        INT,
    created_at  TIMESTAMP DEFAULT NOW()
);
```

### 1.7 资讯与动态

```sql
-- 资讯表
CREATE TABLE news (
    id          BIGSERIAL PRIMARY KEY,
    title       VARCHAR(200) NOT NULL,
    content     TEXT,
    category    VARCHAR(20) DEFAULT 'company',  -- company, system
    publish_date DATE,
    created_at  TIMESTAMP DEFAULT NOW()
);

-- 学习动态表
CREATE TABLE activity_logs (
    id          BIGSERIAL PRIMARY KEY,
    user_id     BIGINT REFERENCES users(id),
    action      VARCHAR(30),           -- study_course, complete_course, ...
    target_type VARCHAR(30),           -- course, exam, assessment
    target_id   BIGINT,
    target_name VARCHAR(200),
    detail      JSONB,
    created_at  TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_activity_logs_user_id ON activity_logs(user_id);
CREATE INDEX idx_activity_logs_created_at ON activity_logs(created_at);
```

---

## 2. API 接口设计

### 2.1 通用规范

```
Base URL: /api/v1
Content-Type: application/json
Auth: Bearer {token}

分页请求:
  GET /api/v1/resource?page=1&pageSize=10&sort=created_at&order=desc

分页响应:
  {
    "code": 0,
    "data": {
      "list": [...],
      "pagination": {
        "page": 1,
        "pageSize": 10,
        "total": 50,
        "totalPages": 5
      }
    }
  }
```

### 2.2 用户管理 API

```
GET    /api/v1/users                      # 用户列表 (支持搜索/筛选/分页)
         ?keyword=        # 工号/姓名/用户名
         &departmentId=
         &positionId=
         &status=
         &roleId=
POST   /api/v1/users                      # 新增用户
GET    /api/v1/users/:id                  # 用户详情
PUT    /api/v1/users/:id                  # 编辑用户
POST   /api/v1/users/batch-freeze         # 批量冻结
POST   /api/v1/users/batch-activate       # 批量激活
POST   /api/v1/users/batch-reset-password # 批量重置密码
POST   /api/v1/users/batch-edit           # 批量编辑
POST   /api/v1/users/import               # 导入用户 (Excel)
GET    /api/v1/users/export               # 导出用户 (Excel)

GET    /api/v1/departments                # 部门树
POST   /api/v1/departments                # 新增部门
PUT    /api/v1/departments/:id            # 编辑部门
DELETE /api/v1/departments/:id            # 删除部门

GET    /api/v1/positions                  # 岗位列表
POST   /api/v1/positions                  # 新增岗位
PUT    /api/v1/positions/:id              # 编辑岗位

GET    /api/v1/roles                      # 角色列表
GET    /api/v1/roles/:id/permissions      # 角色权限
PUT    /api/v1/roles/:id/permissions      # 设置角色权限
POST   /api/v1/user-roles/assign          # 分配角色
POST   /api/v1/user-roles/batch-remove    # 批量移除角色

GET    /api/v1/groups                     # 群组列表
POST   /api/v1/groups                     # 新增群组
PUT    /api/v1/groups/:id/members         # 管理群组成员
```

### 2.3 课程管理 API

```
GET    /api/v1/courses                    # 课程列表 (支持多维度筛选)
         ?categoryId=
         &status=          # unselected, selected, applying, rejected
         &completionCondition=
         &recommendStatus=
         &sort=            # publish_date, popularity, rating
         &keyword=
POST   /api/v1/courses                    # 新增课程
GET    /api/v1/courses/:id                # 课程详情
PUT    /api/v1/courses/:id                # 编辑课程
GET    /api/v1/courses/recommended        # 猜你喜欢
GET    /api/v1/courses/latest             # 最新课程
GET    /api/v1/courses/hot                # 最热课程

GET    /api/v1/course-categories          # 课程分类列表
GET    /api/v1/instructors                # 讲师列表
GET    /api/v1/instructors/:id            # 讲师详情
GET    /api/v1/instructors/top            # 最受好评讲师

GET    /api/v1/topics                     # 专题列表
GET    /api/v1/topics/:id                 # 专题详情 (含课程列表)
```

### 2.4 题库与试题 API

```
GET    /api/v1/question-banks             # 题库列表
         ?keyword=
         &creatorName=
         &categoryId=
POST   /api/v1/question-banks             # 新增题库
PUT    /api/v1/question-banks/:id         # 编辑题库
DELETE /api/v1/question-banks/:id         # 删除题库
POST   /api/v1/question-banks/import      # 批量导入题库
PUT    /api/v1/question-banks/:id/auth    # 管理授权

GET    /api/v1/question-bank-categories   # 题库分类树

GET    /api/v1/questions                  # 试题列表
         ?bankId=
         &stem=            # 题干搜索
         &tags=            # 知识点
         &type=            # 题型
         &page=&pageSize=
POST   /api/v1/questions                  # 新增试题
GET    /api/v1/questions/:id              # 试题详情
PUT    /api/v1/questions/:id              # 编辑试题
POST   /api/v1/questions/batch-move       # 试题调动
POST   /api/v1/questions/batch-copy       # 试题复制
POST   /api/v1/questions/batch-trash      # 放入回收站
POST   /api/v1/questions/import           # 导入试题
GET    /api/v1/questions/export           # 导出试题
```

### 2.5 考试管理 API

```
GET    /api/v1/exam-papers                # 试卷列表
POST   /api/v1/exam-papers                # 创建试卷
GET    /api/v1/exam-papers/:id            # 试卷详情
PUT    /api/v1/exam-papers/:id            # 编辑试卷

GET    /api/v1/exams                      # 考试列表
         ?code=
         &name=
         &creatorName=
         &paperName=
         &status=          # 支持多选
POST   /api/v1/exams                      # 新增考试
GET    /api/v1/exams/:id                  # 考试详情
PUT    /api/v1/exams/:id                  # 编辑考试
POST   /api/v1/exams/:id/submit-review    # 提交审核
POST   /api/v1/exams/:id/start            # 开始考试
POST   /api/v1/exams/:id/end              # 结束考试
POST   /api/v1/exams/:id/cancel           # 作废考试
POST   /api/v1/exams/:id/copy             # 复制考试
GET    /api/v1/exams/:id/monitor          # 监控数据
GET    /api/v1/exams/:id/statistics       # 统计数据

GET    /api/v1/exam-categories            # 考试分类树
```

### 2.6 成绩管理 API

```
GET    /api/v1/exam-results               # 成绩列表
         ?examId=
         &userId=
         &departmentId=
GET    /api/v1/exam-results/:id           # 成绩详情 (含答题记录)
GET    /api/v1/exam-results/export        # 导出成绩
```

### 2.7 人才测评 API

```
GET    /api/v1/assessments                # 测评项目列表
         ?name=
         &productType=
         &status=
         &creatorName=
         &source=
         &startDate=&endDate=
POST   /api/v1/assessments                # 新增测评项目
GET    /api/v1/assessments/:id            # 测评项目详情
PUT    /api/v1/assessments/:id            # 编辑测评项目
DELETE /api/v1/assessments/:id            # 删除测评项目
POST   /api/v1/assessments/:id/copy       # 复制测评项目
POST   /api/v1/assessments/:id/disable    # 停用测评项目

GET    /api/v1/assessments/templates      # 测评模板列表 (快速创建用)
POST   /api/v1/assessments/quick-create   # 快速创建 (基于模板)
```

### 2.8 学员端 API

```
# 首页
GET    /api/v1/student/dashboard           # 首页数据聚合
         # 返回: banner, 待办任务, 每月新课, 分类课程, 学分榜, 资讯, 讲师

# 学习任务
GET    /api/v1/student/tasks               # 我的任务列表
GET    /api/v1/student/tasks/calendar      # 日历视图数据
         ?year=&month=

# 学习记录
GET    /api/v1/student/activities          # 学习动态
         ?startDate=&endDate=&type=
GET    /api/v1/student/portfolio           # 学分档案
GET    /api/v1/student/points              # 积分记录
GET    /api/v1/student/certificates        # 我的证书
GET    /api/v1/student/medals              # 我的勋章
GET    /api/v1/student/competencies        # 岗位胜任力

# 排行榜
GET    /api/v1/leaderboard                 # 学分榜
         ?period=          # week, month, quarter, year
         &company=

# 资讯
GET    /api/v1/news                        # 资讯列表
         ?category=        # company, system
```

---

### 2.9 讲师管理 API

```
GET    /api/v1/instructors                 # 讲师列表
         ?keyword=        # 姓名/工号/擅长领域/标签
         &status=         # 启用/禁用
         &accountStatus=  # 启用/禁用
         &positionAttr=   # 全职/兼职
         &level=          # 讲师等级
         &source=         # 内部/外部
         &departmentId=
POST   /api/v1/instructors                 # 新增讲师
GET    /api/v1/instructors/:id             # 讲师详情
PUT    /api/v1/instructors/:id             # 编辑讲师
POST   /api/v1/instructors/:id/freeze      # 冻结讲师
POST   /api/v1/instructors/batch-recommend # 推荐讲师
POST   /api/v1/instructors/batch-unrecommend # 取消推荐
POST   /api/v1/instructors/import          # 导入讲师
GET    /api/v1/instructors/export          # 导出讲师
PUT    /api/v1/instructors/:id/showcase    # 风采管理
GET    /api/v1/instructor-levels           # 等级设置
GET    /api/v1/instructor-categories       # 讲师分类树
```

### 2.10 证书管理 API

```
GET    /api/v1/certificates                # 证书列表
         ?keyword=        # 编号/名称/发证机构
         &source=         # 证书来源
         &creatorName=
         &categoryId=
POST   /api/v1/certificates                # 新增证书
GET    /api/v1/certificates/:id            # 证书详情
PUT    /api/v1/certificates/:id            # 编辑证书
GET    /api/v1/certificates/:id/recipients # 获得情况
GET    /api/v1/certificates/export-recipients # 批量导出获得人员
GET    /api/v1/certificate-categories      # 证书类别
```

### 2.11 知识管理 API

```
GET    /api/v1/knowledge                   # 知识列表
         ?name=
         &tags=
         &isTop=
         &status=
         &type=
         &categoryId=
POST   /api/v1/knowledge                   # 新增知识
GET    /api/v1/knowledge/:id               # 知识详情
PUT    /api/v1/knowledge/:id               # 编辑知识
DELETE /api/v1/knowledge/:id               # 删除知识 (停用管理)
GET    /api/v1/knowledge-categories        # 知识分类树
```

### 2.12 培训管理 API

```
# 安排课程
GET    /api/v1/training-plans              # 计划列表
         ?participantName=
         &nameOrCode=
         &status=
         &tags=
         &startDate=&endDate=
POST   /api/v1/training-plans              # 新增计划
GET    /api/v1/training-plans/:id          # 计划详情
PUT    /api/v1/training-plans/:id          # 编辑计划

# 时光易培 (混合式培训项目)
GET    /api/v1/training-projects           # 项目列表
         ?keyword=        # 编号/名称/创建人
         &category=       # 项目分类
         &type=           # 项目类型
         &planId=         # 所属计划
         &status=
         &tags=
POST   /api/v1/training-projects           # 创建项目
GET    /api/v1/training-projects/:id       # 项目详情

# 专题速递
GET    /api/v1/subject-express             # 专题列表
         ?name=
         &tags=
         &categoryId=
POST   /api/v1/subject-express             # 新增专题
GET    /api/v1/subject-express/:id         # 专题详情

# 直播管理
GET    /api/v1/live-rooms                  # 直播间列表
         ?status=
         &delayType=
         &nameOrAdmin=
         &scene=
         &tags=
         &categoryId=
POST   /api/v1/live-rooms                  # 创建直播间
GET    /api/v1/live-rooms/:id              # 直播间详情

# 调查管理
GET    /api/v1/surveys                     # 调查列表
         ?codeOrName=
         &creatorName=
         &status=
         &questionnaireName=
         &source=
POST   /api/v1/surveys                     # 新增调查
POST   /api/v1/surveys/from-template       # 从模板新增
POST   /api/v1/surveys/:id/publish         # 发布
GET    /api/v1/surveys/:id/monitor         # 监控
GET    /api/v1/surveys/:id/data            # 数据
GET    /api/v1/surveys/:id/qrcode          # 二维码
```

### 2.13 360评估 API

```
GET    /api/v1/evaluations-360             # 360评估列表
         ?codeOrName=
         &creatorName=
         &type=           # 360评估/胜任力评估
         &status=
POST   /api/v1/evaluations-360             # 创建评估
GET    /api/v1/evaluations-360/:id         # 评估详情
POST   /api/v1/evaluations-360/:id/auth    # 添加授权
DELETE /api/v1/evaluations-360/:id/auth    # 移除授权
GET    /api/v1/evaluations-360/templates   # 模板库
```

### 2.14 试卷管理 API

```
GET    /api/v1/exam-papers                 # 试卷列表
POST   /api/v1/exam-papers                 # 创建试卷
GET    /api/v1/exam-papers/:id             # 试卷详情
PUT    /api/v1/exam-papers/:id             # 编辑试卷
DELETE /api/v1/exam-papers/:id             # 删除试卷(回收站)
POST   /api/v1/exam-papers/from-bank       # 从题库组卷
```

### 2.15 成绩管理 API

```
GET    /api/v1/exam-results                # 成绩列表
         ?examId=
         &userId=
         &departmentId=
         &scoreMin=&scoreMax=
         &status=          # 通过/未通过
GET    /api/v1/exam-results/:id            # 成绩详情(含答题记录)
GET    /api/v1/exam-results/export         # 导出成绩
GET    /api/v1/exam-results/statistics     # 成绩统计
```

### 2.16 练习管理 API

```
GET    /api/v1/exercises                   # 练习列表
POST   /api/v1/exercises                   # 创建练习
GET    /api/v1/exercises/:id               # 练习详情
PUT    /api/v1/exercises/:id               # 编辑练习
DELETE /api/v1/exercises/:id               # 删除(回收站)
```

### 2.17 竞赛管理 API

```
GET    /api/v1/contests                    # 竞赛列表
POST   /api/v1/contests                    # 创建竞赛
GET    /api/v1/contests/:id                # 竞赛详情
PUT    /api/v1/contests/:id                # 编辑竞赛
GET    /api/v1/contests/:id/leaderboard    # 竞赛排行榜
```

### 2.18 报表中心 API

```
GET    /api/v1/reports/bi                  # BI看板数据
GET    /api/v1/reports/big-data            # 大数据看板
GET    /api/v1/reports/projects            # 项目报表
GET    /api/v1/reports/student-archives    # 学员档案报表
GET    /api/v1/reports/maturity            # 成熟度模型
```

---

## 3. 状态枚举定义

### 3.1 用户状态
```
active    - 激活
frozen    - 冻结
expired   - 已过期
```

### 3.2 课程状态 (学员视角)
```
unselected  - 未选课程
selected    - 已选课程
applying    - 申请中
rejected    - 申请失败
```

### 3.3 结业条件
```
course_study       - 课程学习 (学完即可)
course_evaluation  - 课程评估 (需完成评估)
after_test         - 课后测试 (需通过测试)
course_exam        - 课程考试 (需通过考试)
```

### 3.4 考试状态
```
draft        - 草稿
reviewing    - 审核中
not_started  - 未开始
in_progress  - 考试中
ended        - 已结束
cancelled    - 已作废
```

### 3.5 测评项目状态
```
draft        - 草稿
not_started  - 未开始
in_progress  - 进行中
disabled     - 停用
ended        - 已结束
```

### 3.6 试题难度
```
easy    - 简单
medium  - 中等
hard    - 困难
```

### 3.7 试题类型
```
single_choice        - 单选题
multi_choice         - 多选题
true_false           - 判断题
fill_blank           - 填空题
essay                - 问答题
true_false_correct   - 判断改错题
multi_fill_blank     - 多项填空题
comprehensive        - 综合题
```

### 3.8 推荐状态
```
recommended - 推荐
normal      - 普通
```

### 3.9 课程类型
```
optional - 自选课程
required - 必修课程
```

### 3.10 测评模板类型
```
skill       - 能力测评
personality - 人格测评
value       - 价值观测评
logic       - 逻辑推理测评
```

### 3.11 测评理论模型
```
OCEAN - 大五人格 (开放性/尽责性/外向性/宜人性/情绪性)
DISC  - 四型性格 (主导型/影响型/稳健型/谨慎型)
MBTI  - 16型人格
PDP   - 行为风格
WVI   - 职业价值观
```