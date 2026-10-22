import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "../../lib/api";

interface QuestionItem {
  id: string; type: string; stem: string; difficulty: string; tags: string[] | null;
}
interface ExamInfo {
  id: string; title: string; paper_type: string; total_score: number; duration: number;
  paper_id: string | null;
}
interface PaperData {
  id: string; exam_id: string; questions: { question_id: string; score: number }[] | null;
  random_rules: { type: string; difficulty: string; count: number; score: number }[] | null;
}

const TYPE_LABELS: Record<string, string> = {
  single_choice: "单选", multi_choice: "多选", true_false: "判断",
  fill_blank: "填空", essay: "问答",
};
const DIFF_LABELS: Record<string, string> = { easy: "简单", medium: "中等", hard: "困难" };

export default function ExamPaper() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [exam, setExam] = useState<ExamInfo | null>(null);
  const [questions, setQuestions] = useState<QuestionItem[]>([]);
  const [paper, setPaper] = useState<PaperData | null>(null);
  const [loading, setLoading] = useState(true);

  // 随机预览
  const [previewQuestions, setPreviewQuestions] = useState<QuestionItem[] | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  useEffect(() => {
    Promise.all([
      api<ExamInfo>(`/exams/${id}`),
      api<{ items: QuestionItem[] }>("/questions?page_size=200"),
      api<PaperData>(`/exams/${id}/paper`),
    ]).then(([examData, questionsData, paperData]) => {
      setExam(examData);
      setQuestions(questionsData.items);
      setPaper(paperData);
      setLoading(false);
    });
  }, [id]);

  const handlePreview = () => {
    if (!paper?.random_rules) return;
    const result: QuestionItem[] = [];
    paper.random_rules.forEach((rule) => {
      const pool = questions.filter(
        (q) => q.type === rule.type && q.difficulty === rule.difficulty
      );
      const shuffled = [...pool].sort(() => Math.random() - 0.5);
      const selected = shuffled.slice(0, Math.min(rule.count, pool.length));
      result.push(...selected);
    });
    setPreviewQuestions(result.sort(() => Math.random() - 0.5));
    setShowPreview(true);
  };

  if (loading) return <p className="text-text-secondary">加载中...</p>;
  if (!exam) return <p className="text-text-secondary">考试不存在</p>;

  const fixedQuestions = (paper?.questions || []).map((q) => ({
    ...q,
    detail: questions.find((q2) => q2.id === q.question_id),
  }));

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-bold text-primary">组卷: {exam.title}</h2>
          <p className="text-sm text-text-secondary mt-1">
            组卷方式: {exam.paper_type === "fixed" ? "固定组卷" : "随机组卷"} | 目标总分: {exam.total_score}分 | 时长: {exam.duration}分钟
          </p>
          <p className="text-xs text-text-secondary mt-2">
            此页面为只读视图。如需修改组卷内容，请前往{" "}
            <button onClick={() => navigate("/admin/papers")} className="text-primary underline hover:text-primary-light">
              试卷管理
            </button>{" "}
            编辑同名的试卷。
          </p>
        </div>
        <div className="flex gap-2">
          {exam.paper_id && (
            <button onClick={() => navigate(`/admin/papers/${exam.paper_id}`)}
              className="px-4 py-2 rounded-md text-sm border border-border hover:bg-bg-layout">
              去编辑试卷
            </button>
          )}
          {exam.paper_type === "random" && (
            <button onClick={handlePreview} className="px-4 py-2 border border-primary text-primary rounded-md text-sm hover:bg-primary/5">
              生成预览
            </button>
          )}
          <button onClick={() => navigate("/admin/exams")}
            className="px-4 py-2 rounded-md text-sm border border-border hover:bg-bg-layout">
            返回
          </button>
        </div>
      </div>

      {exam.paper_type === "fixed" ? (
        <div className="bg-bg-base rounded-lg border border-border p-4">
          <h3 className="font-bold text-sm mb-3">
            题目列表（共 {fixedQuestions.length} 题，合计 {fixedQuestions.reduce((s, q) => s + q.score, 0)} 分）
          </h3>
          {fixedQuestions.length === 0 ? (
            <p className="text-sm text-text-secondary">暂无题目</p>
          ) : (
            <div className="space-y-1">
              {fixedQuestions.map((q, i) => (
                <div key={q.question_id} className="flex items-center gap-2 py-2 px-3 bg-bg-layout rounded text-sm">
                  <span className="text-text-secondary w-5 shrink-0">{i + 1}.</span>
                  <span className="text-xs text-text-secondary shrink-0">[{TYPE_LABELS[q.detail?.type || ""]}]</span>
                  <span className="flex-1 truncate">{q.detail?.stem || "(题目已删除)"}</span>
                  <span className="text-xs text-text-secondary shrink-0">{DIFF_LABELS[q.detail?.difficulty || ""]}</span>
                  <span className="text-text-secondary shrink-0 ml-2">{q.score}分</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="bg-bg-base rounded-lg border border-border p-4">
          <h3 className="font-bold text-sm mb-3">
            随机组卷规则（合计 {paper?.random_rules?.reduce((sum, r) => sum + r.count * r.score, 0) || 0} 分）
          </h3>
          {(!paper?.random_rules || paper.random_rules.length === 0) ? (
            <p className="text-sm text-text-secondary">暂无规则</p>
          ) : (
            <div className="space-y-2">
              {paper.random_rules.map((r, i) => (
                <div key={i} className="flex items-center gap-2 py-2 px-3 bg-bg-layout rounded-md text-sm">
                  <span className="text-text-secondary">{i + 1}.</span>
                  <span className="text-text-secondary">题型: {TYPE_LABELS[r.type]}</span>
                  <span className="text-text-secondary">难度: {DIFF_LABELS[r.difficulty]}</span>
                  <span className="text-text-secondary">抽 {r.count} 题</span>
                  <span className="text-text-secondary">每题 {r.score} 分</span>
                  <span className="text-text-secondary font-medium">= {r.count * r.score} 分</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 随机预览弹窗 */}
      {showPreview && previewQuestions && (
        <div className="fixed inset-0 bg-black/30 flex items-start justify-center pt-20 z-50" onClick={() => setShowPreview(false)}>
          <div className="bg-bg-base rounded-lg shadow-xl p-6 w-full max-w-lg max-h-[70vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold">试卷预览（{previewQuestions.length} 题）</h3>
              <button onClick={handlePreview} className="text-sm text-primary hover:underline">换一批</button>
            </div>
            <div className="space-y-3">
              {previewQuestions.map((q, i) => (
                <div key={q.id} className="py-2 px-3 bg-bg-layout rounded text-sm">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-bold text-primary">{i + 1}.</span>
                    <span className="text-xs text-text-secondary">[{TYPE_LABELS[q.type]}]</span>
                    <span className="text-xs text-text-secondary">{DIFF_LABELS[q.difficulty]}</span>
                  </div>
                  <p>{q.stem}</p>
                </div>
              ))}
            </div>
            <div className="flex justify-end mt-4">
              <button onClick={() => setShowPreview(false)} className="px-4 py-2 rounded-md text-sm border border-border hover:bg-bg-layout">关闭</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}