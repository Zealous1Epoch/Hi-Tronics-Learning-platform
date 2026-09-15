import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../../lib/api";

interface ExamQuestion {
  id: string; type: string; stem: string; options: Record<string, string> | null;
  score: number;
}
interface ExamData {
  result_id: string; exam_title: string; duration: number;
  total_score: number; questions: ExamQuestion[]; attempt_number: number;
}
interface GradingResult {
  score: number; total_score: number; passed: boolean; pass_score: number;
  grading_details: { question_id: string; score: number; max_score: number }[];
}
interface ReviewQuestion {
  id: string; type: string; stem: string; options: Record<string, string> | null;
  score: number; student_answer: any; correct_answer: Record<string, any>;
  keywords: string[] | null;
  is_correct: boolean; got_score: number; max_score: number;
}
interface ReviewData {
  exam_title: string; total_score: number; score: number;
  passed: boolean; pass_score: number; attempt_number: number;
  submitted_at: string;
  questions: ReviewQuestion[];
}

const TYPE_LABELS: Record<string, string> = {
  single_choice: "单选题", multi_choice: "多选题", true_false: "判断题",
  fill_blank: "填空题", essay: "问答题",
};

export default function ExamPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const courseId = searchParams.get("courseId");
  const reviewId = searchParams.get("review");
  const [examData, setExamData] = useState<ExamData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [result, setResult] = useState<GradingResult | null>(null);
  const [reviewData, setReviewData] = useState<ReviewData | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [expandedQuestions, setExpandedQuestions] = useState<Set<number>>(new Set());
  const [timeLeft, setTimeLeft] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const handleSubmitRef = useRef<() => void>(() => {});

  // 答案状态
  const [answers, setAnswers] = useState<Record<string, string | string[] | boolean>>({});
  const [multiSelect, setMultiSelect] = useState<Record<string, string[]>>({});

  useEffect(() => {
    if (reviewId) {
      // 回顾模式：直接拉取 review 数据，跳过开始考试
      api<ReviewData>(`/student/exams/${id}/review/${reviewId}`)
        .then((data) => {
          setReviewData(data);
          setSubmitted(true);
          setResult({
            score: data.score,
            total_score: data.total_score,
            passed: data.passed,
            pass_score: data.pass_score,
            grading_details: data.questions.map(q => ({
              question_id: q.id,
              score: q.got_score,
              max_score: q.max_score,
            })),
          });
          setLoading(false);
        })
        .catch((err) => {
          setError(err.message);
          setLoading(false);
        });
      return;
    }

    api<ExamData>(`/student/exams/${id}/start`)
      .then((data) => {
        setExamData(data);
        setTimeLeft(data.duration * 60);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [id, reviewId]);

  // 倒计时（使用 ref 避免闭包陷阱）
  useEffect(() => {
    handleSubmitRef.current = handleSubmit;
  });

  useEffect(() => {
    if (!examData || submitted) return;
    timerRef.current = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timerRef.current!);
          handleSubmitRef.current();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [examData, submitted]);

  // 交卷后拉取错题回顾
  useEffect(() => {
    if (submitted && examData) {
      api<ReviewData>(`/student/exams/${id}/review/${examData.result_id}`)
        .then(setReviewData)
        .catch(() => {});
    }
  }, [submitted, id, examData]);

  const handleSingleChoice = (qid: string, value: string) => {
    setAnswers((prev) => ({ ...prev, [qid]: value }));
  };

  const handleMultiChoice = (qid: string, option: string) => {
    setMultiSelect((prev) => {
      const current = prev[qid] || [];
      const next = current.includes(option)
        ? current.filter((o) => o !== option)
        : [...current, option];
      setAnswers((a) => ({ ...a, [qid]: next }));
      return { ...prev, [qid]: next };
    });
  };

  const handleTextAnswer = (qid: string, value: string) => {
    setAnswers((prev) => ({ ...prev, [qid]: value }));
  };

  const handleBoolAnswer = (qid: string, value: boolean) => {
    setAnswers((prev) => ({ ...prev, [qid]: value }));
  };

  const handleSubmit = async () => {
    if (submitting || submitted) return;
    setSubmitting(true);
    if (timerRef.current) clearInterval(timerRef.current);

    const answerList = examData!.questions.map((q) => ({
      question_id: q.id,
      answer: answers[q.id] ?? (q.type === "multi_choice" ? [] : q.type === "true_false" ? false : ""),
    }));

    try {
      const res = await api<GradingResult>(`/student/exams/${id}/submit`, {
        method: "POST",
        body: JSON.stringify({ answers: answerList }),
      });
      setResult(res);
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "交卷失败");
    } finally {
      setSubmitting(false);
    }
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  };

  if (loading) return <p className="text-text-secondary">加载试卷...</p>;
  if (error) return (
    <div className="bg-bg-base rounded-lg p-12 border border-border text-center">
      <p className="text-red-500 mb-4">{error}</p>
      <button onClick={() => navigate(courseId ? `/student/courses/${courseId}` : "/student/courses")} className="text-primary hover:underline">返回课程</button>
    </div>
  );

  const formatAnswer = (q: ReviewQuestion, answer: any): string => {
    if (answer === null || answer === undefined || answer === '') return '未作答';
    if (q.type === 'true_false') return answer ? '正确' : '错误';
    const opts = q.options;
    if (q.type === 'single_choice' && opts && typeof answer === 'string') {
      const optText = opts[answer];
      return optText ? `${answer}. ${optText}` : answer;
    }
    if (q.type === 'multi_choice' && Array.isArray(answer) && opts) {
      return answer.map(a => {
        const optText = opts[a];
        return optText ? `${a}. ${optText}` : a;
      }).join('、');
    }
    return String(answer);
  };

  // 从 correct_answer JSON 中提取值，兼容 {"answer": ...} 和 {"correct": ...} 两种 key
  const getCorrectVal = (ca: Record<string, any> | null) =>
    ca ? (ca.answer ?? ca.correct) : undefined;

  const formatCorrectAnswer = (q: ReviewQuestion): string => {
    const opts = q.options;
    const ca = q.correct_answer as Record<string, any> | null;
    if (q.type === 'true_false') {
      const val = getCorrectVal(ca);
      return val === true || val === 'true' ? '正确' : '错误';
    }
    if (q.type === 'single_choice') {
      const ans = getCorrectVal(ca);
      if (ans === null || ans === undefined) return '';
      if (typeof ans === 'string') {
        if (opts) {
          const optText = opts[ans];
          return optText ? `${ans}. ${optText}` : ans;
        }
        return ans;
      }
      return String(ans);
    }
    if (q.type === 'multi_choice') {
      // 兼容两种格式：{"correct": ["A", "B"]} 或 {"A": True, "B": False, ...}
      let correctKeys: string[];
      if (ca && Array.isArray(ca.correct)) {
        correctKeys = ca.correct;
      } else {
        correctKeys = Object.entries(ca || {})
          .filter(([, v]) => v)
          .map(([k]) => k);
      }
      if (opts) {
        return correctKeys.map(k => {
          const optText = opts[k];
          return optText ? `${k}. ${optText}` : k;
        }).join('、');
      }
      return correctKeys.join('、');
    }
    if (q.type === 'fill_blank') return String(getCorrectVal(ca) ?? '');
    if (q.type === 'essay') {
      const kws = q.keywords || [];
      return kws.length ? `关键词：${kws.join('、')}` : '（关键词评分）';
    }
    return '';
  };

  const toggleQuestion = (idx: number) => {
    setExpandedQuestions(prev => {
      const next = new Set(prev);
      next.has(idx) ? next.delete(idx) : next.add(idx);
      return next;
    });
  };

  if (submitted && result) {
    return (
      <div className="max-w-3xl mx-auto space-y-6">
        {/* 分数摘要 */}
        <div className="bg-bg-base rounded-lg border border-border p-8 text-center">
          <h2 className="text-xl font-bold text-primary mb-4">考试结束</h2>
          <div className="text-4xl font-bold text-primary mb-2">
            {result.score} <span className="text-lg text-text-secondary">/ {result.total_score}</span>
          </div>
          <p className={`text-sm mb-6 ${result.passed ? "text-green-600" : "text-primary"}`}>
            {result.passed ? "恭喜通过!" : `未通过（及格线: ${result.pass_score}分）`}
          </p>
          <button onClick={() => navigate(courseId ? `/student/courses/${courseId}` : "/student/courses")} className="px-6 py-2 bg-primary text-white rounded-md text-sm">
            返回课程
          </button>
        </div>

        {/* 答题回顾（折叠式） */}
        {reviewData && (
          <div className="bg-bg-base rounded-lg border border-border">
            <div className="px-4 py-3 border-b border-border/40">
              <h3 className="text-sm font-bold text-primary">答题回顾</h3>
            </div>
            <div className="divide-y divide-border/40">
              {reviewData.questions.map((q, i) => {
                const isExpanded = expandedQuestions.has(i);
                return (
                  <div key={q.id}>
                    {/* 折叠行：题号 + 类型 + 得分 */}
                    <button
                      onClick={() => toggleQuestion(i)}
                      className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-bg-layout/50 transition-colors"
                    >
                      <span className={`shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-xs border ${
                        q.is_correct ? "text-green-600 border-green-200 bg-green-50" : "text-primary border-primary/30 bg-primary/5"
                      }`}>
                        {q.is_correct ? "✓" : "✗"}
                      </span>
                      <span className="text-sm flex-1 min-w-0">
                        <span className="text-text-secondary mr-2">第 {i + 1} 题</span>
                        <span className="text-text-secondary/60 text-xs mr-2">[{TYPE_LABELS[q.type] || q.type}]</span>
                      </span>
                      <span className={`text-sm font-medium shrink-0 ${q.is_correct ? "text-green-600" : "text-primary"}`}>
                        {q.got_score} / {q.max_score} 分
                      </span>
                      <span className={`text-text-secondary/40 transition-transform text-xs ${isExpanded ? "rotate-90" : ""}`}>
                        &#9654;
                      </span>
                    </button>

                    {/* 展开详情 */}
                    {isExpanded && (
                      <div className="px-4 pb-4 pt-1 ml-10 space-y-2 border-t border-border/20">
                        <p className="text-sm">{q.stem}</p>

                        {q.type === "true_false" ? (
                          <div className="flex gap-6 text-sm">
                            <span>
                              <span className="text-text-secondary text-xs">你的答案：</span>
                              <span className={q.is_correct ? "text-green-600" : "text-primary"}>
                                {formatAnswer(q, q.student_answer)}
                              </span>
                            </span>
                            {!q.is_correct && (
                              <span>
                                <span className="text-text-secondary text-xs">正确答案：</span>
                                <span className="text-green-600">{formatCorrectAnswer(q)}</span>
                              </span>
                            )}
                          </div>
                        ) : (
                          <>
                            <div className="text-sm">
                              <span className="text-text-secondary text-xs">你的答案：</span>
                              <span className={q.is_correct ? "text-green-600" : "text-primary"}>
                                {formatAnswer(q, q.student_answer)}
                              </span>
                            </div>
                            {!q.is_correct && (
                              <div className="text-sm">
                                <span className="text-text-secondary text-xs">正确答案：</span>
                                <span className="text-green-600">{formatCorrectAnswer(q)}</span>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  }

  if (!examData) return null;

  return (
    <div className="max-w-3xl mx-auto">
      {/* 考试头部 */}
      <div className="bg-primary text-white rounded-lg p-4 mb-4 flex items-center justify-between">
        <div>
          <h2 className="font-bold">{examData.exam_title}</h2>
          <p className="text-sm text-white/70">第 {examData.attempt_number} 次考试</p>
        </div>
        <div className="text-right">
          <div className={`text-2xl font-mono font-bold ${timeLeft < 300 ? "text-red-300" : ""}`}>
            {formatTime(timeLeft)}
          </div>
          <p className="text-xs text-white/70">剩余时间</p>
        </div>
      </div>

      {/* 题目列表 */}
      <div className="space-y-4">
        {examData.questions.map((q, i) => (
          <div key={q.id} className="bg-bg-base rounded-lg border border-border p-4">
            <div className="flex items-start gap-2 mb-3">
              <span className="text-sm font-bold text-primary whitespace-nowrap mt-0.5">
                {i + 1}. [{TYPE_LABELS[q.type] || q.type}]
              </span>
              <span className="text-sm flex-1">{q.stem}</span>
              <span className="text-xs text-text-secondary whitespace-nowrap">{q.score}分</span>
            </div>

            {/* 单选题 */}
            {q.type === "single_choice" && q.options && (
              <div className="space-y-1.5 ml-8">
                {Object.entries(q.options).map(([key, val]) => (
                  <label key={key} className="flex items-center gap-2 py-1.5 px-3 rounded hover:bg-bg-layout cursor-pointer text-sm">
                    <input
                      type="radio" name={`q-${q.id}`}
                      checked={answers[q.id] === key}
                      onChange={() => handleSingleChoice(q.id, key)}
                    />
                    <span className="text-text-secondary mr-1">{key}.</span>
                    <span>{val}</span>
                  </label>
                ))}
              </div>
            )}

            {/* 多选题 */}
            {q.type === "multi_choice" && q.options && (
              <div className="space-y-1.5 ml-8">
                {Object.entries(q.options).map(([key, val]) => (
                  <label key={key} className="flex items-center gap-2 py-1.5 px-3 rounded hover:bg-bg-layout cursor-pointer text-sm">
                    <input
                      type="checkbox"
                      checked={(multiSelect[q.id] || []).includes(key)}
                      onChange={() => handleMultiChoice(q.id, key)}
                    />
                    <span className="text-text-secondary mr-1">{key}.</span>
                    <span>{val}</span>
                  </label>
                ))}
              </div>
            )}

            {/* 判断题 */}
            {q.type === "true_false" && (
              <div className="flex gap-4 ml-8">
                <label className="flex items-center gap-2 py-1.5 px-4 rounded border border-border hover:bg-bg-layout cursor-pointer text-sm">
                  <input type="radio" name={`q-${q.id}`}
                    checked={answers[q.id] === true}
                    onChange={() => handleBoolAnswer(q.id, true)} />
                  正确
                </label>
                <label className="flex items-center gap-2 py-1.5 px-4 rounded border border-border hover:bg-bg-layout cursor-pointer text-sm">
                  <input type="radio" name={`q-${q.id}`}
                    checked={answers[q.id] === false}
                    onChange={() => handleBoolAnswer(q.id, false)} />
                  错误
                </label>
              </div>
            )}

            {/* 填空题 */}
            {q.type === "fill_blank" && (
              <div className="ml-8">
                <input type="text" value={(answers[q.id] as string) || ""}
                  onChange={(e) => handleTextAnswer(q.id, e.target.value)}
                  placeholder="请输入答案"
                  className="w-full max-w-md border border-border rounded-md px-3 py-2 text-sm" />
              </div>
            )}

            {/* 问答题 */}
            {q.type === "essay" && (
              <div className="ml-8">
                <textarea value={(answers[q.id] as string) || ""}
                  onChange={(e) => handleTextAnswer(q.id, e.target.value)}
                  placeholder="请输入答案"
                  rows={4}
                  className="w-full border border-border rounded-md px-3 py-2 text-sm" />
              </div>
            )}
          </div>
        ))}
      </div>

      {/* 交卷按钮 */}
      <div className="mt-6 text-center">
        <button onClick={handleSubmit} disabled={submitting}
          className="px-8 py-3 bg-primary text-white rounded-md text-sm hover:bg-primary-light disabled:opacity-50">
          {submitting ? "提交中..." : "交卷"}
        </button>
      </div>
    </div>
  );
}