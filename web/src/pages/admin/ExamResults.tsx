/**
 * 考试成绩查看页（管理端）
 *
 * 数据来自 GET /exams/{id}/results（后端聚合，口径见 exam_service.aggregate_exam_results）：
 * - 汇总卡：应考 / 已交卷 / 通过 / 作答中 / 未参考 / 平均最高分
 * - 成绩表：一人一行（多次作答取最高分），可展开每次作答并查看答卷
 * - 答卷抽屉：按题目快照逐题比对（与学员端回顾同一套后端逻辑）
 * - 未参考名单 + Excel 导出（成绩 + 未参考双 Sheet）
 */
import { Fragment, useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api, downloadFile } from "../../lib/api";
import { notify } from "../../components/ui/Toast";
import { TYPE_LABELS, DIFF_LABELS } from "../../components/exam/QuestionPickerPanel";

interface Attempt {
  id: string; attempt_number: number; score: number; passed: boolean;
  started_at: string | null; submitted_at: string | null;
}
interface ResultRow {
  user_id: string; name: string; employee_id: string | null; department: string | null;
  assigned: boolean; attempts: Attempt[];
  best_score: number | null; passed: boolean; in_progress: boolean; attempt_count: number;
}
interface Summary {
  assigned: number; submitted_users: number; passed_users: number;
  in_progress_users: number; absent_users: number; avg_score: number | null;
}
interface ResultsData {
  exam: {
    id: string; title: string; status: string; duration: number;
    total_score: number; pass_score: number;
    start_time: string | null; end_time: string | null;
    course_id: string; course_title: string | null;
  };
  summary: Summary;
  rows: ResultRow[];
  absent: { user_id: string; name: string; employee_id: string | null; department: string | null }[];
}

interface ReviewQuestion {
  id: string; type: string; stem: string; options: Record<string, string> | null;
  difficulty: string; score: number;
  student_answer: string | string[] | boolean | null;
  correct_answer: Record<string, unknown> | null;
  keywords: string[] | null;
  is_correct: boolean; got_score: number; max_score: number;
}
interface ReviewData {
  exam_title: string; total_score: number; score: number; passed: boolean;
  pass_score: number; attempt_number: number;
  started_at: string | null; submitted_at: string | null;
  user_name: string; employee_id: string | null; department: string | null;
  questions: ReviewQuestion[];
}

const STATUS_LABELS: Record<string, string> = { draft: "草稿", published: "已发布", ended: "已结束" };
const STATUS_COLORS: Record<string, string> = {
  draft: "k-tag", published: "k-tag k-tag-success",
  ended: "k-tag k-tag-danger",
};

const fmt = (iso: string | null | undefined) => (iso ? iso.replace("T", " ").slice(0, 16) : "—");

/** 从正确答案 JSON 提取答案值，兼容 {"correct": ...} / {"answer": ...} 两种格式 */
function correctValue(ca: Record<string, unknown> | null): unknown {
  if (!ca) return null;
  return "answer" in ca ? ca.answer : ca.correct;
}

/** 答案值 → 可展示文本 */
function answerText(v: unknown): string {
  if (v === null || v === undefined || v === "") return "（未作答）";
  if (Array.isArray(v)) return v.join("、");
  if (typeof v === "boolean") return v ? "正确" : "错误";
  return String(v);
}

/** 判断某选项是否为正确答案（单选/多选，兼容 {"correct":[...]} 与 {"A":true,...} 两种存储） */
function isOptionCorrect(cv: unknown, key: string): boolean {
  if (Array.isArray(cv)) return cv.includes(key);
  if (cv && typeof cv === "object") return Boolean((cv as Record<string, unknown>)[key]);
  return String(cv) === key;
}

/** 判断某选项是否被学员选中 */
function isOptionChosen(sa: unknown, key: string): boolean {
  if (Array.isArray(sa)) return sa.includes(key);
  return String(sa) === key;
}

export default function ExamResults() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<ResultsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [downloading, setDownloading] = useState(false);
  // 答卷抽屉
  const [review, setReview] = useState<ReviewData | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);

  useEffect(() => {
    if (!id) return;
    api<ResultsData>(`/exams/${id}/results`)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "加载失败"))
      .finally(() => setLoading(false));
  }, [id]);

  const toggleExpand = (userId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId); else next.add(userId);
      return next;
    });
  };

  const openReview = async (resultId: string) => {
    setReviewLoading(true);
    try {
      setReview(await api<ReviewData>(`/exams/${id}/results/${resultId}`));
    } catch (e: unknown) {
      notify.error(e instanceof Error ? e.message : "加载答卷失败");
    } finally {
      setReviewLoading(false);
    }
  };

  const handleExport = async () => {
    setDownloading(true);
    try {
      await downloadFile(`/exams/${id}/results/export`, "考试成绩.xlsx");
    } catch (e: unknown) {
      notify.error(e instanceof Error ? e.message : "导出失败");
    } finally {
      setDownloading(false);
    }
  };

  if (loading) return <p className="k-empty">加载中...</p>;
  if (error || !data) return <p className="text-danger">{error || "数据为空"}</p>;

  const { exam, summary, rows, absent } = data;

  const statCards: { label: string; value: string | number; tone?: string }[] = [
    { label: "应考", value: `${summary.assigned} 人` },
    { label: "已交卷", value: `${summary.submitted_users} 人` },
    { label: "通过", value: `${summary.passed_users} 人`, tone: "text-success" },
    { label: "作答中", value: `${summary.in_progress_users} 人`, tone: "text-warning" },
    { label: "未参考", value: `${summary.absent_users} 人`, tone: summary.absent_users > 0 ? "text-danger" : undefined },
    { label: "平均最高分", value: summary.avg_score !== null ? `${summary.avg_score} 分` : "—" },
  ];

  return (
    <div>
      {/* 头部 */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <h2 className="k-title text-[22px] text-primary flex items-center gap-2">
            成绩：{exam.title}
            <span className={`font-normal ${STATUS_COLORS[exam.status] || "k-tag"}`}>
              {STATUS_LABELS[exam.status] || exam.status}
            </span>
          </h2>
          <p className="text-sm text-text-secondary mt-1">
            课程《{exam.course_title || "—"}》 · 总分 {exam.total_score} / 及格 {exam.pass_score} · 时长 {exam.duration} 分钟
            {(exam.start_time || exam.end_time) && <> · 开放 {fmt(exam.start_time)} ~ {fmt(exam.end_time)}</>}
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <button onClick={handleExport} disabled={downloading}
            className="k-btn k-btn-primary disabled:opacity-50">
            {downloading ? "导出中..." : "导出 Excel"}
          </button>
          <button onClick={() => navigate("/admin/exams")}
            className="k-btn k-btn-default">
            返回考试管理
          </button>
        </div>
      </div>

      {/* 汇总卡 */}
      <div className="grid grid-cols-6 gap-3 mb-4">
        {statCards.map((c) => (
          <div key={c.label} className="k-card px-3 py-2.5 text-center">
            <p className="text-xs text-text-secondary">{c.label}</p>
            <p className={`text-lg font-bold ${c.tone || "text-text-base"}`}>{c.value}</p>
          </div>
        ))}
      </div>

      {/* 成绩表 */}
      <div className="k-table-wrap overflow-hidden mb-4">
        <table className="k-table table-fixed">
          <thead>
            <tr>
              <th className="w-8"></th>
              <th className="w-24">姓名</th>
              <th className="w-20">工号</th>
              <th>部门</th>
              <th className="text-center w-20">最高分</th>
              <th className="text-center w-28">结果</th>
              <th className="text-center w-16">次数</th>
              <th className="text-center w-20">操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={8} className="text-center k-muted">暂无作答记录</td></tr>
            )}
            {rows.map((r) => {
              const isOpen = expanded.has(r.user_id);
              return (
                <Fragment key={r.user_id}>
                  <tr className={`cursor-pointer ${r.assigned ? "" : "opacity-70"}`}
                    onClick={() => toggleExpand(r.user_id)}>
                    <td className="k-muted text-xs">{isOpen ? "▾" : "▸"}</td>
                    <td className="k-strong truncate">
                      {r.name}
                      {!r.assigned && (
                        <span className="ml-1 text-xs text-warning" title="不在当前课程分配名单中（可能已被移出）">外部</span>
                      )}
                    </td>
                    <td className="k-muted truncate">{r.employee_id || "—"}</td>
                    <td className="k-muted truncate">{r.department || "—"}</td>
                    <td className="text-center font-bold">{r.best_score ?? "—"}</td>
                    <td className="text-center whitespace-nowrap">
                      {r.attempt_count > 0 ? (
                        <span className={r.passed ? "k-tag k-tag-success" : "k-tag k-tag-danger"}>
                          {r.passed ? "通过" : "未通过"}
                        </span>
                      ) : (
                        <span className="k-tag k-tag-warning">作答中</span>
                      )}
                      {r.in_progress && r.attempt_count > 0 && (
                        <span className="ml-1 text-xs text-warning" title="另有未交卷的作答">（+中）</span>
                      )}
                    </td>
                    <td className="text-center k-muted">{r.attempt_count}</td>
                    <td className="text-center">
                      {r.attempts.length > 0 && (
                        <button
                          onClick={(e) => { e.stopPropagation(); toggleExpand(r.user_id); }}
                          className="k-link">
                          {isOpen ? "收起" : "明细"}
                        </button>
                      )}
                    </td>
                  </tr>
                  {isOpen && r.attempts.map((a) => (
                    <tr key={a.id} className="bg-bg-layout/40 text-xs">
                      <td></td>
                      <td className="k-muted">第 {a.attempt_number} 次</td>
                      <td className="k-muted" colSpan={2}>
                        开始 {fmt(a.started_at)}{a.submitted_at ? ` · 交卷 ${fmt(a.submitted_at)}` : " · 未交卷"}
                      </td>
                      <td className="text-center font-medium">{a.submitted_at ? a.score : "—"}</td>
                      <td className="text-center" colSpan={2}>
                        {a.submitted_at ? (a.passed ? "通过" : "未通过") : "作答中"}
                      </td>
                      <td className="text-center">
                        {a.submitted_at && (
                          <button onClick={(e) => { e.stopPropagation(); openReview(a.id); }}
                            disabled={reviewLoading}
                            className="k-link disabled:opacity-50">
                            查看答卷
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 未参考名单 */}
      <div className="k-card p-4">
        <h3 className="text-sm font-bold mb-2">未参考（{absent.length} 人）</h3>
        {absent.length === 0 ? (
          <p className="text-sm text-text-secondary">分配名单内无缺考</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {absent.map((u) => (
              <span key={u.user_id} className="k-tag" title={u.department || ""}>
                {u.name}{u.department ? ` · ${u.department}` : ""}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* 答卷抽屉 */}
      {review && (
        <div className="fixed inset-0 bg-black/30 flex items-start justify-end z-50" onClick={() => setReview(null)}>
          <div className="bg-bg-base h-full w-full max-w-2xl shadow-xl flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-border flex items-center justify-between">
              <div>
                <h3 className="font-bold">{review.user_name} · 第 {review.attempt_number} 次答卷</h3>
                <p className="text-xs text-text-secondary mt-0.5">
                  得分 <b className={review.passed ? "text-success" : "text-danger"}>{review.score}</b> / {review.total_score}
                  （及格 {review.pass_score}） · 交卷 {fmt(review.submitted_at)}
                </p>
              </div>
              <button onClick={() => setReview(null)} className="text-text-secondary hover:text-text-base text-xl leading-none">&times;</button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              {review.questions.map((q, i) => {
                const cv = correctValue(q.correct_answer);
                return (
                  <div key={`${q.id}-${i}`} className={`border rounded-lg p-3 text-sm ${q.is_correct ? "border-success/40" : "border-danger/40"}`}>
                    <div className="flex items-center gap-2 mb-1.5 text-xs text-text-secondary">
                      <b className="text-text-base">{i + 1}.</b>
                      <span>[{TYPE_LABELS[q.type] || q.type}]</span>
                      <span>{DIFF_LABELS[q.difficulty] || q.difficulty}</span>
                      <span className={`ml-auto font-bold ${q.is_correct ? "text-success" : "text-danger"}`}>
                        {q.got_score} / {q.max_score} 分
                      </span>
                    </div>
                    <p className="mb-2">{q.stem}</p>
                    {q.options && (
                      <div className="space-y-1 mb-2">
                        {Object.entries(q.options).map(([key, text]) => {
                          const correct = isOptionCorrect(cv, key);
                          const chosen = isOptionChosen(q.student_answer, key);
                          return (
                            <div key={key} className={`px-2 py-1 rounded border text-xs flex items-center gap-1.5 ${
                              correct ? "bg-success/10 border-success/40" : chosen ? "bg-danger/10 border-danger/40" : "border-border/50"
                            }`}>
                              <span className="font-medium w-4">{key}.</span>
                              <span className="flex-1">{String(text)}</span>
                              {correct && !chosen && <span className="text-success">正确答案</span>}
                              {correct && chosen && <span className="text-success">✓ 正确答案（该生所选）</span>}
                              {chosen && !correct && <span className="text-danger">✗ 该生所选</span>}
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {q.type === "essay" && (
                      <div className="text-xs space-y-1">
                        <p><span className="text-text-secondary">该生作答：</span>{answerText(q.student_answer)}</p>
                        {q.keywords && q.keywords.length > 0 && (
                          <p><span className="text-text-secondary">得分关键词：</span>{q.keywords.join("、")}</p>
                        )}
                      </div>
                    )}
                    {(q.type === "true_false" || q.type === "fill_blank") && (
                      <p className="text-xs">
                        <span className="text-text-secondary">该生答案：</span>{answerText(q.student_answer)}
                        <span className="text-text-secondary ml-3">正确答案：</span>{answerText(cv)}
                      </p>
                    )}
                  </div>
                );
              })}
              {review.questions.length === 0 && (
                <p className="k-empty">该次作答无可展示的题目（题目可能已被删除）</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
