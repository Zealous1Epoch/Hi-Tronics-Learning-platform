import { useState, useEffect } from "react";
import { api } from "../../lib/api";

interface CategoryNode {
  id: string; name: string;
  children: CategoryNode[];
}
interface QuestionItem {
  id: string; type: string; stem: string; options: Record<string, string> | null;
  difficulty: string; tags: string[] | null; section: string | null;
}
interface PaperItem {
  id: string; title: string; category_id: string | null;
  paper_type: string; total_score: number; status: string;
  mandatory_questions: { question_id: string; score: number }[] | null;
  random_rules: { type: string; difficulty: string; count: number; score: number; category_id?: string | null }[] | null;
}
interface FlatCategory {
  id: string; name: string; parent_id: string | null;
}

interface Props {
  paper: PaperItem | null;
  categories: CategoryNode[];
  onDone: () => void;
  onClose: () => void;
}

const TYPE_LABELS: Record<string, string> = {
  single_choice: "单选", multi_choice: "多选", true_false: "判断",
  fill_blank: "填空", essay: "问答",
};
const DIFF_LABELS: Record<string, string> = { easy: "简单", medium: "中等", hard: "困难" };
const STEPS = ["基础信息", "选择必考题", "组卷策略", "预览微调"];

export default function PaperCreate({ paper, categories, onDone, onClose }: Props) {
  const isEdit = paper !== null;

  // 步骤状态
  const [step, setStep] = useState(0);

  // 步骤 1: 基础信息
  const [title, setTitle] = useState(paper?.title || "");
  const [categoryId, setCategoryId] = useState<string | null>(paper?.category_id || null);
  const [paperType, setPaperType] = useState(paper?.paper_type || "fixed");

  // 步骤 2: 选必考题
  const [questions, setQuestions] = useState<QuestionItem[]>([]);
  const [selectedMQs, setSelectedMQs] = useState<Map<string, number>>(new Map());
  const [mqOrder, setMqOrder] = useState<string[]>([]);
  const [filterType, setFilterType] = useState("");
  const [filterDiff, setFilterDiff] = useState("");
  const [filterSearch, setFilterSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [flatCategories, setFlatCategories] = useState<FlatCategory[]>([]);

  // 步骤 3: 随机策略
  const [rules, setRules] = useState<{
    type: string; difficulty: string; count: number; score: number; category_id: string | null;
  }[]>([]);

  // 步骤 4: 预览
  const [previewQuestions, setPreviewQuestions] = useState<QuestionItem[] | null>(null);

  const [saving, setSaving] = useState(false);

  // 初始化编辑数据
  useEffect(() => {
    if (paper && paper.mandatory_questions) {
      const map = new Map<string, number>();
      const order: string[] = [];
      paper.mandatory_questions.forEach((mq) => {
        map.set(mq.question_id, mq.score);
        order.push(mq.question_id);
      });
      setSelectedMQs(map);
      setMqOrder(order);
    }
    if (paper && paper.random_rules) {
      setRules(paper.random_rules.map((r) => ({
        type: r.type, difficulty: r.difficulty, count: r.count, score: r.score,
        category_id: r.category_id || null,
      })));
    }
  }, [paper]);

  // 加载题库
  useEffect(() => {
    Promise.all([
      api<QuestionItem[]>("/questions"),
      api<FlatCategory[]>("/question-categories/flat"),
    ]).then(([qs, cats]) => {
      setQuestions(qs);
      setFlatCategories(cats);
    });
  }, []);

  // 步骤 2 筛选
  const filteredQuestions = questions.filter((q) => {
    if (filterType && q.type !== filterType) return false;
    if (filterDiff && q.difficulty !== filterDiff) return false;
    if (filterCategory && (q as any).category_id !== filterCategory) return false;
    if (filterSearch && !q.stem.includes(filterSearch)) return false;
    return true;
  });

  const toggleQuestion = (qid: string) => {
    setSelectedMQs((prev) => {
      const next = new Map(prev);
      if (next.has(qid)) {
        next.delete(qid);
        setMqOrder((o) => o.filter((id) => id !== qid));
      } else {
        next.set(qid, 10);
        setMqOrder((o) => [...o, qid]);
      }
      return next;
    });
  };

  const setMqScore = (qid: string, score: number) => {
    setSelectedMQs((prev) => {
      const next = new Map(prev);
      next.set(qid, score);
      return next;
    });
  };

  const mqTotalScore = Array.from(selectedMQs.values()).reduce((a, b) => a + b, 0);

  // 步骤 3
  const addRule = () => {
    setRules([...rules, { type: "single_choice", difficulty: "medium", count: 5, score: 10, category_id: null }]);
  };

  const updateRule = (i: number, field: string, value: string | number | null) => {
    setRules(rules.map((r, j) => (j === i ? { ...r, [field]: value } : r)));
  };

  const removeRule = (i: number) => {
    setRules(rules.filter((_, j) => j !== i));
  };

  const ruleTotalScore = rules.reduce((sum, r) => sum + r.count * r.score, 0);

  // 步骤 4: 生成预览
  const generatePreview = () => {
    // 必考题
    const mqIds = mqOrder;
    const mqItems = mqIds
      .map((qid) => questions.find((q) => q.id === qid))
      .filter(Boolean) as QuestionItem[];

    if (paperType === "fixed") {
      setPreviewQuestions(mqItems);
      return;
    }

    // 随机组卷：必考题 + 随机抽题
    const result: QuestionItem[] = [...mqItems];
    rules.forEach((rule) => {
      let pool = questions.filter(
        (q) => q.type === rule.type && q.difficulty === rule.difficulty
      );
      // 按题库分类筛选
      if (rule.category_id) {
        pool = pool.filter((q) => (q as any).category_id === rule.category_id);
      }
      // 排除已选题目
      const existingIds = new Set(result.map((q) => q.id));
      pool = pool.filter((q) => !existingIds.has(q.id));
      const shuffled = [...pool].sort(() => Math.random() - 0.5);
      const selected = shuffled.slice(0, Math.min(rule.count, pool.length));
      result.push(...selected);
    });
    setPreviewQuestions(result);
  };

  // 步骤 4 操作
  const moveQuestion = (idx: number, direction: "up" | "down") => {
    if (!previewQuestions) return;
    const next = [...previewQuestions];
    if (direction === "up" && idx > 0) {
      [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
    } else if (direction === "down" && idx < next.length - 1) {
      [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
    }
    setPreviewQuestions(next);
  };

  const removeFromPreview = (idx: number) => {
    if (!previewQuestions) return;
    setPreviewQuestions(previewQuestions.filter((_, i) => i !== idx));
  };

  const totalScore = paperType === "fixed"
    ? mqTotalScore
    : mqTotalScore + ruleTotalScore;

  const canNext = () => {
    if (step === 0) return title.trim() !== "";
    if (step === 1) return selectedMQs.size > 0;
    if (step === 2) return paperType === "fixed" || rules.length > 0;
    return true;
  };

  const handleNext = () => {
    if (step === 1 && paperType === "random") {
      setStep(2); // 进组卷策略
    } else if (step === 1 && paperType === "fixed") {
      generatePreview();
      setStep(3); // 跳过步骤 3，直接预览
    } else if (step === 2) {
      generatePreview();
      setStep(3);
    } else {
      setStep(step + 1);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    const mandatoryQuestions = mqOrder.map((question_id) => ({
      question_id,
      score: selectedMQs.get(question_id) || 10,
    }));

    const body = {
      title,
      category_id: categoryId,
      paper_type: paperType,
      mandatory_questions: mandatoryQuestions,
      random_rules: paperType === "random" ? rules : null,
      total_score: totalScore,
      status: "draft",
    };

    if (isEdit) {
      await api(`/papers/${paper.id}`, { method: "PUT", body: JSON.stringify(body) });
    } else {
      await api("/papers", { method: "POST", body: JSON.stringify(body) });
    }
    setSaving(false);
    onDone();
  };

  const handlePublish = async () => {
    setSaving(true);
    const mandatoryQuestions = mqOrder.map((question_id) => ({
      question_id,
      score: selectedMQs.get(question_id) || 10,
    }));

    const body = {
      title,
      category_id: categoryId,
      paper_type: paperType,
      mandatory_questions: mandatoryQuestions,
      random_rules: paperType === "random" ? rules : null,
      total_score: totalScore,
      status: "published",
    };

    if (isEdit) {
      await api(`/papers/${paper.id}`, { method: "PUT", body: JSON.stringify(body) });
    } else {
      await api("/papers", { method: "POST", body: JSON.stringify(body) });
    }
    setSaving(false);
    onDone();
  };

  return (
    <div className="fixed inset-0 bg-black/30 flex items-start justify-center pt-16 z-50" onClick={onClose}>
      <div className="bg-bg-base rounded-lg shadow-xl w-full max-w-5xl max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        {/* 头部 */}
        <div className="px-6 py-4 border-b border-border flex items-center justify-between">
          <h3 className="font-bold text-lg">{isEdit ? "编辑试卷" : "新增试卷"}</h3>
          <button onClick={onClose} className="text-text-secondary hover:text-text-base text-lg">&times;</button>
        </div>

        {/* 步骤条 */}
        <div className="px-6 py-4 border-b border-border">
          <div className="flex items-center">
            {STEPS.map((label, i) => {
              const isActive = i === step;
              const isDone = i < step;
              const isSkip = paperType === "fixed" && i === 2;
              return (
                <div key={i} className="flex items-center">
                  {i > 0 && (
                    <div className={`w-8 h-px mx-2 ${isDone ? "bg-primary" : "bg-border"}`} />
                  )}
                  <div className={`flex items-center gap-1.5 text-sm ${
                    isSkip ? "text-border" : isActive ? "text-primary font-bold" : isDone ? "text-primary" : "text-text-secondary"
                  }`}>
                    <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs ${
                      isSkip ? "bg-border text-white" : isActive ? "bg-primary text-white" : isDone ? "bg-primary text-white" : "bg-border text-text-secondary"
                    }`}>
                      {isSkip ? "-" : isDone ? "✓" : i + 1}
                    </span>
                    <span className={isSkip ? "line-through" : ""}>{label}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 内容区 */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {/* 步骤 1: 基础信息 */}
          {step === 0 && (
            <div className="max-w-md space-y-4">
              <div>
                <label className="block text-sm text-text-secondary mb-1">试卷名称</label>
                <input
                  type="text" value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="输入试卷名称"
                  className="w-full border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm text-text-secondary mb-1">试卷类别</label>
                <select
                  value={categoryId || ""}
                  onChange={(e) => setCategoryId(e.target.value || null)}
                  className="w-full border border-border rounded-md px-3 py-2 text-sm"
                >
                  <option value="">未分类</option>
                  {flattenCats(categories).map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm text-text-secondary mb-1">试卷类型</label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="radio" name="paperType"
                      checked={paperType === "fixed"}
                      onChange={() => setPaperType("fixed")}
                    />
                    固定试卷
                  </label>
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="radio" name="paperType"
                      checked={paperType === "random"}
                      onChange={() => setPaperType("random")}
                    />
                    随机试卷
                  </label>
                </div>
                <p className="text-xs text-text-secondary mt-1">
                  {paperType === "fixed"
                    ? "手动指定所有题目，每份试卷完全相同"
                    : "按规则随机抽题，可指定必考题确保核心知识点覆盖"}
                </p>
              </div>
            </div>
          )}

          {/* 步骤 2: 选择必考题 */}
          {step === 1 && (
            <div className="flex gap-4">
              <div className="flex-1 min-w-0">
                {/* 筛选 */}
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
                    <option value="">全部题型</option>
                    {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                  <select value={filterDiff} onChange={(e) => setFilterDiff(e.target.value)}
                    className="border border-border rounded-md px-2 py-1 text-sm">
                    <option value="">全部难度</option>
                    {Object.entries(DIFF_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                  <input
                    type="text" placeholder="搜索题干..." value={filterSearch}
                    onChange={(e) => setFilterSearch(e.target.value)}
                    className="flex-1 border border-border rounded-md px-2 py-1 text-sm"
                  />
                </div>

                <div className="max-h-[50vh] overflow-y-auto border border-border rounded-lg">
                  <table className="w-full text-sm">
                    <thead className="bg-bg-layout sticky top-0">
                      <tr>
                        <th className="px-3 py-2 w-8"></th>
                        <th className="text-left px-3 py-2 text-text-secondary font-normal">题干</th>
                        <th className="text-left px-3 py-2 text-text-secondary font-normal w-14">题型</th>
                        <th className="text-left px-3 py-2 text-text-secondary font-normal w-14">难度</th>
                        <th className="text-left px-3 py-2 text-text-secondary font-normal w-20">分值</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredQuestions.map((q) => (
                        <tr key={q.id} className={`border-b border-border/50 ${selectedMQs.has(q.id) ? "bg-primary/5" : "hover:bg-bg-layout"}`}>
                          <td className="px-3 py-2">
                            <input type="checkbox" checked={selectedMQs.has(q.id)}
                              onChange={() => toggleQuestion(q.id)} />
                          </td>
                          <td className="px-3 py-2 truncate max-w-xs">{q.stem}</td>
                          <td className="px-3 py-2 text-text-secondary text-xs">{TYPE_LABELS[q.type]}</td>
                          <td className="px-3 py-2 text-text-secondary text-xs">{DIFF_LABELS[q.difficulty]}</td>
                          <td className="px-3 py-2">
                            {selectedMQs.has(q.id) && (
                              <input type="number" value={selectedMQs.get(q.id) || 10}
                                onChange={(e) => setMqScore(q.id, parseInt(e.target.value) || 0)}
                                className="w-14 border border-border rounded-md px-1.5 py-0.5 text-xs text-right" min={1} />
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* 已选面板 */}
              {mqOrder.length > 0 && (
                <div className="w-64 flex-shrink-0">
                  <div className="bg-bg-base rounded-lg border border-border p-3 sticky top-0">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-bold">已选必考题</span>
                      <span className="text-xs text-primary font-bold">{mqTotalScore} 分</span>
                    </div>
                    <p className="text-xs text-text-secondary mb-2">
                      {paperType === "fixed" ? "固定试卷：全部考题" : "随机试卷：保底出现的题"}
                    </p>
                    <div className="space-y-1 max-h-[40vh] overflow-y-auto">
                      {mqOrder.map((qid, i) => {
                        const q = questions.find((q) => q.id === qid);
                        if (!q) return null;
                        return (
                          <div key={qid} className="flex items-center gap-2 py-1 px-2 bg-bg-layout rounded text-xs">
                            <span className="text-text-secondary w-5">{i + 1}.</span>
                            <span className="flex-1 truncate">{q.stem.slice(0, 15)}</span>
                            <span className="text-text-secondary">{selectedMQs.get(qid)}分</span>
                            <button onClick={() => toggleQuestion(qid)} className="text-red-400 hover:text-red-600">&times;</button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 步骤 3: 组卷策略（仅随机试卷） */}
          {step === 2 && paperType === "random" && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <span className="text-sm font-bold">随机组卷规则</span>
                  <span className="text-sm text-text-secondary ml-2">
                    （必考题 {mqTotalScore} 分 + 随机题 {ruleTotalScore} 分 = {totalScore} 分）
                  </span>
                </div>
                <button onClick={addRule} className="text-sm text-primary hover:underline">添加规则</button>
              </div>
              {rules.length === 0 ? (
                <div className="bg-bg-base rounded-lg p-8 border border-border text-center text-text-secondary text-sm">
                  点击"添加规则"开始配置随机抽题策略
                </div>
              ) : (
                <div className="space-y-2">
                  {rules.map((r, i) => (
                    <div key={i} className="flex items-center gap-2 py-2 px-3 bg-bg-base rounded-md border border-border text-sm">
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
                      <select value={r.category_id || ""} onChange={(e) => updateRule(i, "category_id", e.target.value || null)}
                        className="border border-border rounded-md px-2 py-1 text-sm">
                        <option value="">不限分类</option>
                        {flatCategories.map((c) => (
                          <option key={c.id} value={c.id}>{c.parent_id ? "  " : ""}{c.name}</option>
                        ))}
                      </select>
                      <span className="text-text-secondary ml-2">= {r.count * r.score}分</span>
                      <button onClick={() => removeRule(i)} className="ml-auto text-xs text-red-500 hover:underline">删除</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 步骤 4: 预览 */}
          {step === 3 && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-bold">
                  试卷预览（{previewQuestions?.length || 0} 题，{totalScore} 分）
                </span>
                {paperType === "random" && (
                  <button onClick={generatePreview} className="text-sm text-primary hover:underline">
                    换一批随机题
                  </button>
                )}
              </div>
              {!previewQuestions || previewQuestions.length === 0 ? (
                <div className="bg-bg-base rounded-lg p-8 border border-border text-center text-text-secondary text-sm">
                  点击"生成预览"查看试卷
                </div>
              ) : (
                <div className="space-y-2 max-h-[50vh] overflow-y-auto">
                  {previewQuestions.map((q, i) => {
                    const isMandatory = mqOrder.includes(q.id);
                    const score = selectedMQs.get(q.id) || 10;
                    return (
                      <div key={`${q.id}-${i}`} className="flex items-center gap-3 py-2 px-3 bg-bg-base rounded-lg border border-border text-sm group">
                        <div className="flex flex-col items-center">
                          <button onClick={() => moveQuestion(i, "up")} disabled={i === 0}
                            className="text-text-secondary hover:text-text-base disabled:opacity-30 leading-none text-xs">&uarr;</button>
                          <button onClick={() => moveQuestion(i, "down")} disabled={i === previewQuestions.length - 1}
                            className="text-text-secondary hover:text-text-base disabled:opacity-30 leading-none text-xs">&darr;</button>
                        </div>
                        <span className="text-text-secondary w-5 text-center">{i + 1}</span>
                        <span className={`text-xs px-1.5 py-0.5 rounded ${isMandatory ? "bg-primary/10 text-primary" : "bg-border text-text-secondary"}`}>
                          {TYPE_LABELS[q.type]} {isMandatory ? "必考" : "随机"}
                        </span>
                        <span className="flex-1 truncate">{q.stem}</span>
                        <span className="text-xs text-text-secondary">{DIFF_LABELS[q.difficulty]}</span>
                        <input type="number" value={score}
                          onChange={(e) => setMqScore(q.id, parseInt(e.target.value) || 0)}
                          className="w-14 border border-border rounded-md px-1.5 py-0.5 text-xs text-right" min={1} />
                        <span className="text-xs text-text-secondary">分</span>
                        <button onClick={() => removeFromPreview(i)}
                          className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-600">&times;</button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* 底部按钮 */}
        <div className="px-6 py-4 border-t border-border flex items-center justify-between">
          <div>
            {step > 0 && (
              <button onClick={() => setStep(step - 1)}
                className="px-4 py-2 rounded-md text-sm border border-border hover:bg-bg-layout">
                上一步
              </button>
            )}
          </div>
          <div className="flex gap-3">
            <button onClick={onClose} className="px-4 py-2 rounded-md text-sm border border-border hover:bg-bg-layout">
              取消
            </button>
            {step < 3 ? (
              <button onClick={handleNext} disabled={!canNext()}
                className="px-4 py-2 rounded-md text-sm bg-primary text-white hover:bg-primary-light disabled:opacity-50">
                下一步
              </button>
            ) : (
              <>
                <button onClick={handleSave} disabled={saving}
                  className="px-4 py-2 rounded-md text-sm border border-border hover:bg-bg-layout">
                  {saving ? "保存中..." : "保存草稿"}
                </button>
                <button onClick={handlePublish} disabled={saving}
                  className="px-4 py-2 rounded-md text-sm bg-primary text-white hover:bg-primary-light disabled:opacity-50">
                  {saving ? "保存中..." : "保存并发布"}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function flattenCats(cats: CategoryNode[], depth = 0): { id: string; name: string }[] {
  return cats.flatMap((c) => [
    { id: c.id, name: "  ".repeat(depth) + c.name },
    ...flattenCats(c.children, depth + 1),
  ]);
}