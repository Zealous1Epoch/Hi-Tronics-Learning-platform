# 学习进度展示优化

## 背景

当前进度条只显示视频完成百分比，无法区分视频和考试两个维度的进度。看完视频但没考试也会显示 100%，用户无法直观判断自己的真实学习状态。

## 改动范围

### 1. 后端：courses-with-progress 接口新增考试信息

`GET /api/student/courses-with-progress` 返回新增字段：

```json
{
  "exam_score": null | 82,
  "exam_passed": false,
  "exam_attempted": false,
  "exam_date": "2026-09-04" | null
}
```

### 2. 课程列表页（MyCourses.tsx）

卡片内展示两行：

```
[视频进度条 ====] 视频：2/5
考试：未开始 / 未通过（45分）/ 已通过（82分）
```

- 视频进度条：蓝色，显示已完成/总数
- 考试状态：灰色（未开始）/ 红色（未通过，显示分数）/ 绿色（已通过，显示分数）

### 3. 课程详情页（CourseDetail.tsx）

视频播放器上方新增进度卡片：

```
┌─────────────────────────────────────────┐
│ 视频进度    2/5  ████████░░░░  40%       │
│ 考试状态    未通过（45分）                │
│ 上次考试    2026-09-04                    │
└─────────────────────────────────────────┘
```

## 修改文件

| 文件 | 改动 |
|------|------|
| `server/app/routers/learning_progress.py` | courses-with-progress 新增 exam_score, exam_attempted, exam_date 字段 |
| `web/src/pages/student/MyCourses.tsx` | CourseCard 区分视频进度和考试状态 |
| `web/src/pages/student/CourseDetail.tsx` | 视频播放器上方加进度卡片 |