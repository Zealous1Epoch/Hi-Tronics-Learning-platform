import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "../../lib/api";

interface QuestionItem {
  id: string; type: string; stem: string; difficulty: string; tags: string[] | null;
}
interface FlatCategory {
  id: string; name: string; parent_id: string | null;
}
interface ExamInfo {
  id: string; title: string; paper_type: string; total_score: number; duration: number;
}
interface PaperData {
  id: string; exam_id: string; questions: { question_id: string; score: number }[] | null;
  random_rules: { type: string; difficulty: string; count: number; score: number }[] | null;
}

const TYPE_OPTIONS = [
  { value: "", label: "全部题型" },
  { value: "single_choice", label: "单选题" },
  { value: "multi_choice", label: "多选题" },
  { value: "true_false", label: "判断题" },
  { value: "fill_blank", label: "填空题" },
  { value: "essay", label: "问答题" },
];
const TYPE_LABELS: Record<string, string> = {
  single_choice: "单选", multi_choice: "多选", true_false: "判断",
  fill_blank: "填空", essay: "问答",
};
const DIFF_OPTIONS = [
  { value: "", label: "全部难度" },
  { value: "easy", label: "简单" },
  { value: "medium", label: "中等" },
  { value: "hard", label: "困难" },
];
const DIFF_LABELS: Record<string, string> = { easy: "简单", medium: "中等", hard: "困难" };

export default function ExamPaper() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [exam, setExam] = useState<ExamInfo | null>(null);
  const [questions, setQuestions] = useState<QuestionItem[]>([]);
  const [, setPaper] = useState<PaperData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // 固定组卷：选中的题目 + 分值 + 顺序
  const [selectedQuestions, setSelectedQuestions] = useState<Map<string, number>>(new Map());
  const [questionOrder, setQuestionOrder] = useState<string[]>([]);

  // 筛选
  const [flatCategories, setFlatCategories] = useState<FlatCategory[]>([]);
  const [filterType, setFilterType] = useState("");
  const [filterDiff, setFilterDiff] = useState("");
  const [filterCategory, setFilterCategory] = useState("");

  // 随机组卷规则
  const [rules, setRules] = useState<{ type: string; difficulty: string; count: number; score: number }[]>([]);

  // 随机预览
  const [previewQuestions, setPreviewQuestions] = useState<QuestionItem[] | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  useEffect(() => {
    Promise.all([
      api<ExamInfo>(`/exams/${id}`),
      api<QuestionItem[]>("/questions"),
      api<PaperData>(`/exams/${id}/paper`),
      api<FlatCategory[]>("/question-categories/flat"),
    ]).then(([examData, questionsData, paperData, catsData]) => {
      setFlatCategories(catsData);
      setExam(examData);
      setQuestions(questionsData);
      setPaper(paperData);

      if (examData.paper_type === "fixed" && paperData.questions) {
        const map = new Map<string, number>();
        const order: string[] = [];
        paperData.questions.forEach((q) => {
          map.set(q.question_id, q.score);
          order.push(q.question_id);
        });
        setSelectedQuestions(map);
        setQuestionOrder(order);
      }
      if (examData.paper_type === "random" && paperData.random_rules) {
        setRules(paperData.random_rules);
      }
      setLoading(false);
    });
  }, [id]);

  const toggleQuestion = (qid: string) => {
    setSelectedQuestions((prev) => {
      const next = new Map(prev);
      if (next.has(qid)) {
        next.delete(qid);
        setQuestionOrder((o) => o.filter((id) => id !== qid));
      } else {
        next.set(qid, 10);
        setQuestionOrder((o) => [...o, qid]);
      }
      return next;
    });
  };

  const setQuestionScore = (qid: string, score: number) => {
    setSelectedQuestions((prev) => {
      const next = new Map(prev);
      next.set(qid, score);
      return next;
    });
  };

  const selectAllVisible = () => {
    filteredQuestions.forEach((q) => {
      if (!selectedQuestions.has(q.id)) {
        setSelectedQuestions((prev) => {
          const next = new Map(prev);
          next.set(q.id, 10);
          return next;
        });
        setQuestionOrder((o) => [...o, q.id]);
      }
    });
  };

  const moveQuestion = (qid: string, direction: "up" | "down") => {
    setQuestionOrder((prev) => {
      const idx = prev.indexOf(qid);
      if (idx === -1) return prev;
      const next = [...prev];
      if (direction === "up" && idx > 0) {
        [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
      } else if (direction === "down" && idx < prev.length - 1) {
        [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
      }
      return next;
    });
  };

  const totalSelectedScore = Array.from(selectedQuestions.values()).reduce((a, b) => a + b, 0);

  const addRule = () => {
    setRules([...rules, { type: "single_choice", difficulty: "medium", count: 5, score: 10 }]);
  };

  const updateRule = (i: number, field: string, value: string | number) => {
    setRules(rules.map((r, j) => (j === i ? { ...r, [field]: value } : r)));
  };

  const removeRule = (i: number) => {
    setRules(rules.filter((_, j) => j !== i));
  };

  const totalRuleScore = rules.reduce((sum, r) => sum + r.count * r.score, 0);

  const handleSave = async () => {
    setSaving(true);
    if (exam?.paper_type === "fixed") {
      const questionList = questionOrder.map((question_id) => ({
        question_id,
        score: selectedQuestions.get(question_id) || 10,
      }));
      await api(`/exams/${id}/paper`, {
        method: "POST",
        body: JSON.stringify({ questions: questionList }),
      });
    } else {
      await api(`/exams/${id}/paper`, {
        method: "POST",
        body: JSON.stringify({ random_rules: rules }),
      });
    }
    setSaving(false);
    alert("组卷保存成功");
  };

  const handlePreview = () => {
    // 模拟随机抽题：从题库中按规则随机选取
    const result: QuestionItem[] = [];
    rules.forEach((rule) => {
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

  // 筛选后的题目
  const filteredQuestions = questions.filter((q) => {
    if (filterType && q.type !== filterType) return false;
    if (filterDiff && q.difficulty !== filterDiff) return false;
    if (filterCategory && (q as any).category_id !== filterCategory) return false;
    return true;
  });

  // 按题型分组
  const groupedQuestions: Record<string, QuestionItem[]> = {};
  filteredQuestions.forEach((q) => {
    if (!groupedQuestions[q.type]) groupedQuestions[q.type] = [];
    groupedQuestions[q.type].push(q);
  });

  // 获取已选题目详情（按 order 排序）
  const selectedQuestionItems = questionOrder
    .map((qid) => questions.find((q) => q.id === qid))
    .filter(Boolean) as QuestionItem[];

  if (loading) return <p className="text-text-secondary">加载中...</p>;
  if (!exam) return <p className="text-text-secondary">考试不存在</p>;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-bold text-primary">组卷: {exam.title}</h2>
          <p className="text-sm text-text-secondary mt-1">
            组卷方式: {exam.paper_type === "fixed" ? "固定组卷" : "随机组卷"} | 目标总分: {exam.total_score}分 | 时长: {exam.duration}分钟
          </p>
        </div>
        <div className="flex gap-2">
          {exam.paper_type === "random" && (
            <button onClick={handlePreview} className="px-4 py-2 border border-primary text-primary rounded-md text-sm hover:bg-primary/5">
              生成预览
            </button>
          )}
          <button onClick={handleSave} disabled={saving}
            className="px-4 py-2 bg-primary text-white rounded-md text-sm hover:bg-primary-light disabled:opacity-50">
            {saving ? "保存中..." : "保存组卷"}
          </button>
          <button onClick={() => navigate("/admin/exams")}
            className="px-4 py-2 rounded-md text-sm border border-border hover:bg-bg-layout">
            返回
          </button>
        </div>
      </div>

      {exam.paper_type === "fixed" ? (
        <div className="flex gap-4">
          {/* 左侧：选题区 */}
          <div className="flex-1 min-w-0">
            <div className="bg-bg-base rounded-lg border border-border p-4">
              {/* 筛选栏 */}
              <div className="flex gap-2 mb-3">
                <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}
                  className="border border-border rounded-md px-2 py-1 text-sm">
                  <option value="">全部分类</option>
                  {flatCategories.map((c) => (
                    <option key={c.id} value={c.id}>{c.parent_id ? "  " : ""}{c.name}</option>
                  ))}
                </select>
                <select value={filterType} onChange={(e) => setFilterType(e.target.value)}
                  className="border border-border rounded-md px-2 py-1 text-sm">
                  {TYPE_OPTIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
                <select value={filterDiff} onChange={(e) => setFilterDiff(e.target.value)}
                  className="border border-border rounded-md px-2 py-1 text-sm">
                  {DIFF_OPTIONS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
                </select>
                <button onClick={selectAllVisible}
                  className="px-3 py-1 border border-primary text-primary rounded-md text-xs hover:bg-primary/5">
                  全选可见 ({filteredQuestions.length})
                </button>
              </div>

              <div className="max-h-[60vh] overflow-y-auto">
                {Object.entries(groupedQuestions).map(([type, qs]) => (
                  <div key={type} className="mb-3">
                    <h4 className="text-xs font-bold text-text-secondary mb-1.5">
                      {TYPE_LABELS[type]} ({qs.length}题)
                    </h4>
                    <div className="space-y-0.5">
                      {qs.map((q) => (
                        <div key={q.id} className={`flex items-center gap-2 py-1.5 px-2 rounded text-sm ${selectedQuestions.has(q.id) ? "bg-primary/5" : "hover:bg-bg-layout"}`}>
                          <input type="checkbox" checked={selectedQuestions.has(q.id)}
                            onChange={() => toggleQuestion(q.id)} />
                          <span className="flex-1 truncate">{q.stem}</span>
                          <span className="text-xs text-text-secondary">{DIFF_LABELS[q.difficulty]}</span>
                          {selectedQuestions.has(q.id) && (
                            <input type="number" value={selectedQuestions.get(q.id) || 10}
                              onChange={(e) => setQuestionScore(q.id, parseInt(e.target.value) || 0)}
                              className="w-14 border border-border rounded-md px-1.5 py-0.5 text-xs text-right" min={1} />
                          )}
                          {selectedQuestions.has(q.id) && <span className="text-xs text-text-secondary">分</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* 右侧：预览面板 */}
          {selectedQuestionItems.length > 0 && (
            <div className="w-72 flex-shrink-0">
              <div className="bg-bg-base rounded-lg border border-border p-4 sticky top-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-bold text-sm">已选题目 ({selectedQuestionItems.length}题)</h3>
                  <span className={`text-xs font-bold ${totalSelectedScore === exam.total_score ? "text-green-600" : "text-yellow-600"}`}>
                    {totalSelectedScore} / {exam.total_score}分
                  </span>
                </div>
                <div className="space-y-1 max-h-[55vh] overflow-y-auto">
                  {selectedQuestionItems.map((q, i) => (
                    <div key={q.id} className="flex items-center gap-2 py-1.5 px-2 bg-bg-layout rounded text-xs group">
                      <div className="flex flex-col items-center">
                        <button onClick={() => moveQuestion(q.id, "up")} disabled={i === 0}
                          className="text-text-secondary hover:text-text-base disabled:opacity-30 leading-none">&uarr;</button>
                        <button onClick={() => moveQuestion(q.id, "down")} disabled={i === selectedQuestionItems.length - 1}
                          className="text-text-secondary hover:text-text-base disabled:opacity-30 leading-none">&darr;</button>
                      </div>
                      <span className="text-text-secondary w-5">{i + 1}.</span>
                      <span className="flex-1 truncate">{q.stem.slice(0, 20)}</span>
                      <span className="text-text-secondary whitespace-nowrap">{selectedQuestions.get(q.id)}分</span>
                      <button onClick={() => toggleQuestion(q.id)}
                        className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-600 ml-1">&times;</button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="bg-bg-base rounded-lg border border-border p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-sm">随机组卷规则（合计 {totalRuleScore} 分）</h3>
              <button onClick={addRule} className="text-sm text-primary hover:underline">添加规则</button>
            </div>
            {totalRuleScore !== exam.total_score && (
              <p className="text-xs text-yellow-600 mb-3">与目标总分({exam.total_score}分)不一致</p>
            )}
            {rules.length === 0 ? (
              <p className="text-sm text-text-secondary">暂无规则，点击"添加规则"开始配置</p>
            ) : (
              <div className="space-y-2">
                {rules.map((r, i) => (
                  <div key={i} className="flex items-center gap-2 py-2 px-3 bg-bg-layout rounded-md text-sm">
                    <select value={r.type} onChange={(e) => updateRule(i, "type", e.target.value)}
                      className="border border-border rounded-md px-2 py-1 text-sm">
                      {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                    <select value={r.difficulty} onChange={(e) => updateRule(i, "difficulty", e.target.value)}
                      className="border border-border rounded-md px-2 py-1 text-sm">
                      {Object.entries(DIFF_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                    <span className="text-text-secondary">抽</span>
                    <input type="number" value={r.count} onChange={(e) => updateRule(i, "count", parseInt(e.target.value) || 0)}
                      className="w-16 border border-border rounded-md px-2 py-1 text-sm text-right" min={1} />
                    <span className="text-text-secondary">题，每题</span>
                    <input type="number" value={r.score} onChange={(e) => updateRule(i, "score", parseInt(e.target.value) || 0)}
                      className="w-16 border border-border rounded-md px-2 py-1 text-sm text-right" min={1} />
                    <span className="text-text-secondary">分</span>
                    <span className="text-text-secondary ml-2">= {r.count * r.score}分</span>
                    <button onClick={() => removeRule(i)} className="ml-auto text-xs text-red-500 hover:underline">删除</button>
                  </div>
                ))}
              </div>
            )}
          </div>
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