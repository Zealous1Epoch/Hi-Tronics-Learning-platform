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
  source_banks: string[] | null;
}
interface PreviewQuestion { id: string; type: string; stem: string; difficulty: string; score: number }

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

  // 服务端随机预览（与学员端开考同一套抽题逻辑，所见即所得）
  const [preview, setPreview] = useState<{ questions: PreviewQuestion[]; total_score: number; shortages: string[] } | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [previewing, setPreviewing] = useState(false);

  useEffect(() => {
    Promise.all([
      api<ExamInfo>(`/exams/${id}`),
      api<PaperData>(`/exams/${id}/paper`),
    ]).then(async ([examData, paperData]) => {
      setExam(examData);
      setPaper(paperData);
      setLoading(false);
      // 固定卷按 ID 精确拉题（不再全量拉 200 条在前端找，题多也不会缺）
      const qids = (paperData.questions || []).map((q) => q.question_id);
      if (qids.length) {
        try {
          const d = await api<{ items: QuestionItem[] }>(`/questions?ids=${encodeURIComponent(qids.join(","))}`);
          setQuestions(d.items);
        } catch { setQuestions([]); }
      }
    }).catch(() => setLoading(false));
  }, [id]);

  const handlePreview = async () => {
    if (!paper?.random_rules?.length) return;
    setPreviewing(true);
    try {
      const data = await api<{ questions: PreviewQuestion[]; total_score: number; shortages: string[] }>(
        "/exams/preview-draw",
        { method: "POST", body: JSON.stringify({ random_rules: paper.random_rules, source_banks: paper.source_banks || null }) },
      );
      setPreview(data);
      setShowPreview(true);
    } catch (e: unknown) {
      setPreview({ questions: [], total_score: 0, shortages: [e instanceof Error ? e.message : "预览失败"] });
      setShowPreview(true);
    } finally {
      setPreviewing(false);
    }
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
            <button onClick={handlePreview} disabled={previewing}
              className="px-4 py-2 border border-primary text-primary rounded-md text-sm hover:bg-primary/5 disabled:opacity-50">
              {previewing ? "抽题中..." : "抽题预览"}
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

      {/* 服务端抽题预览弹窗（与学员端开考同一抽题逻辑） */}
      {showPreview && preview && (
        <div className="fixed inset-0 bg-black/30 flex items-start justify-center pt-20 z-50" onClick={() => setShowPreview(false)}>
          <div className="bg-bg-base rounded-lg shadow-xl p-6 w-full max-w-lg max-h-[70vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold">抽题预览（{preview.questions.length} 题 / {preview.total_score} 分）</h3>
              <div className="flex items-center gap-3">
                <button onClick={handlePreview} disabled={previewing} className="text-sm text-primary hover:underline disabled:opacity-50">换一批</button>
                <button onClick={() => setShowPreview(false)} className="text-text-secondary hover:text-text-base text-lg">&times;</button>
              </div>
            </div>
            {preview.shortages.length > 0 && (
              <div className="mb-3 px-3 py-2 rounded-md bg-amber-50 text-amber-700 border border-amber-200 text-xs space-y-0.5">
                {preview.shortages.map((s, i) => <p key={i}>⚠ {s}</p>)}
              </div>
            )}
            <div className="space-y-3">
              {preview.questions.map((q, i) => (
                <div key={`${q.id}-${i}`} className="py-2 px-3 bg-bg-layout rounded text-sm">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-bold text-primary">{i + 1}.</span>
                    <span className="text-xs text-text-secondary">[{TYPE_LABELS[q.type]}]</span>
                    <span className="text-xs text-text-secondary">{DIFF_LABELS[q.difficulty]}</span>
                    <span className="text-xs text-text-secondary ml-auto">{q.score}分</span>
                  </div>
                  <p>{q.stem}</p>
                </div>
              ))}
              {preview.questions.length === 0 && (
                <p className="text-sm text-text-secondary text-center py-6">{preview.shortages.length ? "题库存量不足，未能抽出完整试卷，请按上方提示调整规则" : "未抽到题目"}</p>
              )}
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