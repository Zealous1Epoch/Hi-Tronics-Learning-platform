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

const TYPE_LABELS: Record<string, string> = {
  single_choice: "单选题", multi_choice: "多选题", true_false: "判断题",
  fill_blank: "填空题", essay: "问答题",
};

export default function ExamPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const courseId = searchParams.get("courseId");
  const [examData, setExamData] = useState<ExamData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [result, setResult] = useState<GradingResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [timeLeft, setTimeLeft] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const handleSubmitRef = useRef<() => void>(() => {});

  // 答案状态
  const [answers, setAnswers] = useState<Record<string, string | string[] | boolean>>({});
  const [multiSelect, setMultiSelect] = useState<Record<string, string[]>>({});

  useEffect(() => {
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
  }, [id]);

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

  if (submitted && result) {
    return (
      <div className="max-w-lg mx-auto">
        <div className="bg-bg-base rounded-lg border border-border p-8 text-center">
          <h2 className="text-xl font-bold text-primary mb-4">考试结束</h2>
          <div className="text-4xl font-bold text-primary mb-2">
            {result.score} <span className="text-lg text-text-secondary">/ {result.total_score}</span>
          </div>
          <p className={`text-sm mb-6 ${result.passed ? "text-green-600" : "text-red-500"}`}>
            {result.passed ? "恭喜通过!" : `未通过（及格线: ${result.pass_score}分）`}
          </p>
          <div className="text-left text-sm text-text-secondary space-y-1 mb-6">
            {result.grading_details.map((g, i) => (
              <div key={i} className="flex justify-between">
                <span>第 {i + 1} 题</span>
                <span className={g.score >= g.max_score ? "text-green-600" : "text-red-500"}>
                  {g.score} / {g.max_score} 分
                </span>
              </div>
            ))}
          </div>
          <button onClick={() => navigate(courseId ? `/student/courses/${courseId}` : "/student/courses")} className="px-6 py-2 bg-primary text-white rounded-md text-sm">
            返回课程
          </button>
        </div>
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