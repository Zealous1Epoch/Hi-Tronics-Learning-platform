import { useState, useEffect } from "react";
import { api } from "../../lib/api";
import { ChevronRight, ChevronDown, Search } from "lucide-react";

interface TreeNode {
  id: string; name: string; parent_id: string | null;
  children: TreeNode[];
}
interface QuestionItem {
  id: string; type: string; stem: string; options: Record<string, string> | null;
  difficulty: string; category_id?: string;
}
interface PaperItem {
  id: string; title: string; category_id: string | null;
  paper_type: string; total_score: number; status: string;
  mandatory_questions: { question_id: string; score: number }[] | null;
  random_rules: { type: string; difficulty: string; count: number; score: number }[] | null;
}
interface FlatCategory {
  id: string; name: string; parent_id: string | null;
}

interface Props {
  paper: PaperItem | null;
  defaultCategoryId: string | null;
  onDone: () => void;
  onClose: () => void;
}

const TYPE_LABELS: Record<string, string> = {
  single_choice: "单选题", multi_choice: "多选题", true_false: "判断题",
  fill_blank: "填空题", essay: "简答题",
};
const DIFF_LABELS: Record<string, string> = { easy: "简单", medium: "中等", hard: "困难" };
const STEPS = ["基础信息", "选择题目", "组卷策略", "预览微调"];

const ALL_TYPES = ["single_choice", "multi_choice", "true_false", "fill_blank", "essay"] as const;

export default function PaperCreate({ paper, defaultCategoryId, onDone, onClose }: Props) {
  const isEdit = paper !== null;

  const [step, setStep] = useState(0);

  // 步骤 1: 基础信息
  const [title, setTitle] = useState(paper?.title || "");
  const [paperType, setPaperType] = useState(paper?.paper_type || "fixed");
  const [flatCategories, setFlatCategories] = useState<FlatCategory[]>([]);

  // 步骤 2: 选题
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [selectedBankId, setSelectedBankId] = useState<string | null>(null);
  const [selectedBankIds, setSelectedBankIds] = useState<Set<string>>(new Set());
  const [bankQuestions, setBankQuestions] = useState<QuestionItem[]>([]);
  const [selectedQuestions, setSelectedQuestions] = useState<Map<string, number>>(new Map());
  const [questionOrder, setQuestionOrder] = useState<string[]>([]);
  const [searchText, setSearchText] = useState("");

  // 步骤 3: 组卷策略
  const [rules, setRules] = useState<Record<string, { enabled: boolean; difficulty: string; count: number; score: number }>>({
    single_choice: { enabled: false, difficulty: "medium", count: 5, score: 10 },
    multi_choice: { enabled: false, difficulty: "medium", count: 5, score: 10 },
    true_false: { enabled: false, difficulty: "medium", count: 5, score: 5 },
    fill_blank: { enabled: false, difficulty: "medium", count: 5, score: 10 },
    essay: { enabled: false, difficulty: "medium", count: 2, score: 20 },
  });

  // 步骤 4: 预览
  const [previewQuestions, setPreviewQuestions] = useState<(QuestionItem & { score: number })[] | null>(null);

  const [saving, setSaving] = useState(false);

  // 初始化编辑数据
  useEffect(() => {
    if (paper && paper.mandatory_questions && paper.paper_type === "fixed") {
      const map = new Map<string, number>();
      const order: string[] = [];
      paper.mandatory_questions.forEach(mq => {
        map.set(mq.question_id, mq.score);
        order.push(mq.question_id);
      });
      setSelectedQuestions(map);
      setQuestionOrder(order);
    }
    if (paper && paper.random_rules) {
      const newRules = { ...rules };
      paper.random_rules.forEach(r => {
        newRules[r.type] = { enabled: true, difficulty: r.difficulty, count: r.count, score: r.score };
      });
      setRules(newRules);
    }
  }, [paper]);

  // 加载分类树
  useEffect(() => {
    Promise.all([
      api<TreeNode[]>("/question-categories/tree"),
      api<FlatCategory[]>("/question-categories/flat"),
    ]).then(([treeData, flatData]) => {
      setTree(treeData);
      setFlatCategories(flatData);
    });
  }, []);

  // 选中题库时加载题目
  useEffect(() => {
    if (!selectedBankId) { setBankQuestions([]); return; }
    api<QuestionItem[]>(`/questions?category_id=${selectedBankId}`).then(setBankQuestions);
  }, [selectedBankId]);

  // 步骤 2 自动展开
  useEffect(() => {
    if (!searchText) return;
    const collectIds = (nodes: TreeNode[]): string[] => {
      const ids: string[] = [];
      for (const node of nodes) {
        ids.push(node.id);
        ids.push(...collectIds(node.children));
      }
      return ids;
    };
    const filtered = searchText ? filterTree(tree, searchText) : tree;
    setExpandedIds(new Set(collectIds(filtered)));
  }, [searchText]);

  const filterTree = (nodes: TreeNode[], term: string): TreeNode[] => {
    if (!term) return nodes;
    const lower = term.toLowerCase();
    const result: TreeNode[] = [];
    for (const node of nodes) {
      const filteredChildren = filterTree(node.children, term);
      if (node.name.toLowerCase().includes(lower) || filteredChildren.length > 0) {
        result.push({ ...node, children: filteredChildren });
      }
    }
    return result;
  };

  const filteredTree = searchText ? filterTree(tree, searchText) : tree;

  const toggleExpand = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleQuestion = (qid: string) => {
    setSelectedQuestions(prev => {
      const next = new Map(prev);
      if (next.has(qid)) {
        next.delete(qid);
        setQuestionOrder(o => o.filter(id => id !== qid));
      } else {
        next.set(qid, 10);
        setQuestionOrder(o => [...o, qid]);
      }
      return next;
    });
  };

  const setQuestionScore = (qid: string, score: number) => {
    setSelectedQuestions(prev => {
      const next = new Map(prev);
      next.set(qid, score);
      return next;
    });
  };

  const getCategoryPath = (catId: string | null): string => {
    if (!catId) return "-";
    const parts: string[] = [];
    let current = flatCategories.find(c => c.id === catId);
    while (current) {
      parts.unshift(current.name);
      current = current.parent_id ? flatCategories.find(c => c.id === current.parent_id) : undefined;
    }
    return parts.join(" - ");
  };

  const renderTree = (nodes: TreeNode[], depth: number = 0) => {
    return nodes.map(node => {
      const isExpanded = expandedIds.has(node.id);
      const isSelected = paperType === "random"
        ? selectedBankIds.has(node.id)
        : selectedBankId === node.id;
      const hasChildren = node.children.length > 0;

      return (
        <div key={node.id}>
          <div
            className={`flex items-center gap-1 py-1.5 px-2 cursor-pointer hover:bg-bg-layout rounded text-sm ${
              isSelected ? "bg-primary/10 text-primary font-medium" : ""
            }`}
            style={{ paddingLeft: `${8 + depth * 16}px` }}
            onClick={() => {
              if (paperType === "random") {
                setSelectedBankIds(prev => {
                  const next = new Set(prev);
                  next.has(node.id) ? next.delete(node.id) : next.add(node.id);
                  return next;
                });
              } else {
                setSelectedBankId(node.id);
              }
              if (hasChildren) {
                setExpandedIds(prev => {
                  const next = new Set(prev);
                  next.has(node.id) ? next.delete(node.id) : next.add(node.id);
                  return next;
                });
              }
            }}
          >
            {hasChildren ? (
              <button onClick={e => { e.stopPropagation(); toggleExpand(node.id); }} className="p-0.5 shrink-0 text-text-secondary">
                {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>
            ) : (
              <span className="w-5 shrink-0" />
            )}
            <span className="truncate">{node.name}</span>
          </div>
          {isExpanded && hasChildren && renderTree(node.children, depth + 1)}
        </div>
      );
    });
  };

  // 生成预览
  const generatePreview = () => {
    const allQuestions: (QuestionItem & { score: number })[] = [];

    if (paperType === "fixed") {
      questionOrder.forEach(qid => {
        const score = selectedQuestions.get(qid) || 10;
        // 暂存所有题目用于预览
        allQuestions.push({ id: qid, type: "", stem: "", options: null, difficulty: "", score });
      });
    } else {
      Object.entries(rules).forEach(([type, rule]) => {
        if (rule.enabled) {
          for (let i = 0; i < rule.count; i++) {
            allQuestions.push({
              id: `${type}-${i}`, type, stem: `[${TYPE_LABELS[type]}] ${DIFF_LABELS[rule.difficulty]}`, options: null, difficulty: rule.difficulty, score: rule.score,
            });
          }
        }
      });
    }
    setPreviewQuestions(allQuestions);
  };

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
    ? Array.from(selectedQuestions.values()).reduce((a, b) => a + b, 0)
    : Object.values(rules).reduce((sum, r) => sum + (r.enabled ? r.count * r.score : 0), 0);

  const canNext = () => {
    if (step === 0) return title.trim() !== "";
    if (step === 1) return paperType === "fixed" ? selectedQuestions.size > 0 : selectedBankIds.size > 0;
    if (step === 2) return Object.values(rules).some(r => r.enabled);
    return true;
  };

  const handleNext = () => {
    if (step === 0) {
      setStep(1);
    } else if (step === 1 && paperType === "random") {
      setStep(2);
    } else if (step === 1 || step === 2) {
      generatePreview();
      setStep(3);
    } else {
      setStep(step + 1);
    }
  };

  const handlePrev = () => {
    if (step === 3 && paperType === "random") {
      setStep(2);
    } else {
      setStep(step - 1);
    }
  };

  const handleSave = async (status: string) => {
    setSaving(true);
    const body: Record<string, unknown> = {
      title,
      category_id: defaultCategoryId,
      paper_type: paperType,
      total_score: totalScore,
      status,
    };

    if (paperType === "fixed") {
      body.mandatory_questions = questionOrder.map(qid => ({
        question_id: qid,
        score: selectedQuestions.get(qid) || 10,
      }));
      body.random_rules = null;
    } else {
      body.mandatory_questions = null;
      body.random_rules = Object.entries(rules)
        .filter(([, r]) => r.enabled)
        .map(([type, r]) => ({ type, difficulty: r.difficulty, count: r.count, score: r.score }));
      body.source_banks = [...selectedBankIds];
    }

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
      <div className="bg-bg-base rounded-lg shadow-xl w-full max-w-6xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
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
                  {i > 0 && <div className={`w-8 h-px mx-2 ${isDone ? "bg-primary" : "bg-border"}`} />}
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
                  onChange={e => setTitle(e.target.value)}
                  placeholder="输入试卷名称"
                  className="w-full border border-border rounded-md px-3 py-2 text-sm"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm text-text-secondary mb-1">试卷类别</label>
                <input
                  type="text" value={getCategoryPath(defaultCategoryId)}
                  readOnly
                  className="w-full border border-border rounded-md px-3 py-2 text-sm bg-bg-layout text-text-secondary"
                />
              </div>
              <div>
                <label className="block text-sm text-text-secondary mb-1">试卷类型</label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input type="radio" name="paperType" checked={paperType === "fixed"} onChange={() => setPaperType("fixed")} />
                    固定试卷
                  </label>
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input type="radio" name="paperType" checked={paperType === "random"} onChange={() => setPaperType("random")} />
                    随机试卷
                  </label>
                </div>
                <p className="text-xs text-text-secondary mt-1">
                  {paperType === "fixed" ? "手动选择所有题目，每份试卷完全相同" : "按规则随机抽题，多份试卷题目不同"}
                </p>
              </div>
            </div>
          )}

          {/* 步骤 2: 选择题目 */}
          {step === 1 && paperType === "fixed" && (
            <div className="flex gap-4 h-full">
              {/* 左侧题库树 */}
              <div className="w-48 shrink-0">
                <div className="relative mb-2">
                  <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-secondary" />
                  <input
                    type="text" placeholder="搜索题库..."
                    value={searchText} onChange={e => setSearchText(e.target.value)}
                    className="w-full border border-border rounded-md pl-7 pr-3 py-1.5 text-sm"
                  />
                </div>
                <div className="bg-bg-base rounded-lg border border-border max-h-[50vh] overflow-y-auto">
                  <div className="py-1">{renderTree(filteredTree)}</div>
                </div>
              </div>

              {/* 右侧题目列表 */}
              <div className="flex-1 min-w-0">
                {!selectedBankId ? (
                  <div className="bg-bg-base rounded-lg p-12 border border-border text-center text-text-secondary">
                    请在左侧选择题库
                  </div>
                ) : (
                  <div className="max-h-[50vh] overflow-y-auto border border-border rounded-lg">
                    <table className="w-full text-sm">
                      <thead className="bg-bg-layout sticky top-0">
                        <tr>
                          <th className="px-3 py-2 w-8"></th>
                          <th className="text-left px-3 py-2 text-text-secondary font-normal">题干</th>
                          <th className="text-center px-3 py-2 text-text-secondary font-normal w-14">题型</th>
                          <th className="text-center px-3 py-2 text-text-secondary font-normal w-14">难度</th>
                          <th className="text-center px-3 py-2 text-text-secondary font-normal w-20">分值</th>
                        </tr>
                      </thead>
                      <tbody>
                        {bankQuestions.map(q => (
                          <tr key={q.id} className={`border-b border-border/50 ${selectedQuestions.has(q.id) ? "bg-primary/5" : "hover:bg-bg-layout"}`}>
                            <td className="px-3 py-2">
                              <input type="checkbox" checked={selectedQuestions.has(q.id)} onChange={() => toggleQuestion(q.id)} />
                            </td>
                            <td className="px-3 py-2 truncate max-w-xs">{q.stem}</td>
                            <td className="px-3 py-2 text-center text-text-secondary text-xs">{TYPE_LABELS[q.type]}</td>
                            <td className="px-3 py-2 text-center text-text-secondary text-xs">{DIFF_LABELS[q.difficulty]}</td>
                            <td className="px-3 py-2 text-center">
                              {selectedQuestions.has(q.id) && (
                                <input type="number" value={selectedQuestions.get(q.id) || 10}
                                  onChange={e => setQuestionScore(q.id, parseInt(e.target.value) || 0)}
                                  className="w-14 border border-border rounded-md px-1.5 py-0.5 text-xs text-center" min={1} />
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* 已选面板 */}
              {questionOrder.length > 0 && (
                <div className="w-56 shrink-0">
                  <div className="bg-bg-base rounded-lg border border-border p-3 sticky top-0">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-bold">已选题</span>
                      <span className="text-xs text-primary font-bold">{totalScore} 分</span>
                    </div>
                    <div className="space-y-1 max-h-[45vh] overflow-y-auto">
                      {questionOrder.map((qid, i) => (
                        <div key={qid} className="flex items-center gap-2 py-1 px-2 bg-bg-layout rounded text-xs">
                          <span className="text-text-secondary w-5">{i + 1}.</span>
                          <span className="flex-1 truncate">{bankQuestions.find(q => q.id === qid)?.stem.slice(0, 12) || qid.slice(0, 8)}</span>
                          <span className="text-text-secondary">{selectedQuestions.get(qid)}分</span>
                          <button onClick={() => toggleQuestion(qid)} className="text-red-400 hover:text-red-600">&times;</button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 步骤 2: 选题库（随机试卷） */}
          {step === 1 && paperType === "random" && (
            <div className="flex gap-4 h-full">
              {/* 左侧题库树 */}
              <div className="w-48 shrink-0">
                <div className="relative mb-2">
                  <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-secondary" />
                  <input
                    type="text" placeholder="搜索题库..."
                    value={searchText} onChange={e => setSearchText(e.target.value)}
                    className="w-full border border-border rounded-md pl-7 pr-3 py-1.5 text-sm"
                  />
                </div>
                <div className="bg-bg-base rounded-lg border border-border max-h-[50vh] overflow-y-auto">
                  <div className="py-1">{renderTree(filteredTree)}</div>
                </div>
              </div>

              {/* 右侧已选题库 */}
              <div className="flex-1 min-w-0">
                <div className="bg-bg-base rounded-lg border border-border p-4">
                  <h4 className="text-sm font-bold mb-3">已选题库范围</h4>
                  {selectedBankIds.size === 0 ? (
                    <p className="text-sm text-text-secondary">请在左侧点击题库进行选择</p>
                  ) : (
                    <div className="space-y-1">
                      {[...selectedBankIds].map(id => (
                        <div key={id} className="flex items-center gap-2 py-1.5 px-3 bg-bg-layout rounded text-sm">
                          <span className="flex-1">{getCategoryPath(id)}</span>
                          <button
                            onClick={() => setSelectedBankIds(prev => {
                              const next = new Set(prev);
                              next.delete(id);
                              return next;
                            })}
                            className="text-red-400 hover:text-red-600 text-xs"
                          >&times;</button>
                        </div>
                      ))}
                    </div>
                  )}
                  <p className="text-xs text-text-secondary mt-3">
                    策略将仅从以上题库中随机抽取题目
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* 步骤 3: 组卷策略（随机试卷） */}
          {step === 2 && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-bold">组卷策略</span>
                <span className="text-sm text-text-secondary">总分：{totalScore} 分</span>
              </div>
              <div className="space-y-2">
                {ALL_TYPES.map(type => (
                  <div key={type} className={`flex items-center gap-3 py-3 px-4 rounded-lg border ${rules[type].enabled ? "border-primary/30 bg-primary/5" : "border-border bg-bg-base"}`}>
                    <label className="flex items-center gap-2 text-sm cursor-pointer w-24">
                      <input
                        type="checkbox"
                        checked={rules[type].enabled}
                        onChange={e => setRules(prev => ({
                          ...prev,
                          [type]: { ...prev[type], enabled: e.target.checked },
                        }))}
                      />
                      {TYPE_LABELS[type]}
                    </label>
                    {rules[type].enabled && (
                      <>
                        <select
                          value={rules[type].difficulty}
                          onChange={e => setRules(prev => ({
                            ...prev,
                            [type]: { ...prev[type], difficulty: e.target.value },
                          }))}
                          className="border border-border rounded-md px-2 py-1 text-sm"
                        >
                          {Object.entries(DIFF_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                        </select>
                        <span className="text-text-secondary text-sm">抽</span>
                        <input
                          type="number" value={rules[type].count}
                          onChange={e => setRules(prev => ({
                            ...prev,
                            [type]: { ...prev[type], count: parseInt(e.target.value) || 0 },
                          }))}
                          className="w-16 border border-border rounded-md px-2 py-1 text-sm text-center" min={1}
                        />
                        <span className="text-text-secondary text-sm">题，每题</span>
                        <input
                          type="number" value={rules[type].score}
                          onChange={e => setRules(prev => ({
                            ...prev,
                            [type]: { ...prev[type], score: parseInt(e.target.value) || 0 },
                          }))}
                          className="w-16 border border-border rounded-md px-2 py-1 text-sm text-center" min={1}
                        />
                        <span className="text-text-secondary text-sm">分</span>
                        <span className="text-text-secondary text-xs ml-auto">= {rules[type].count * rules[type].score} 分</span>
                      </>
                    )}
                  </div>
                ))}
              </div>
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
                  {previewQuestions.map((q, i) => (
                    <div key={`${q.id}-${i}`} className="flex items-center gap-3 py-2 px-3 bg-bg-base rounded-lg border border-border text-sm group">
                      <div className="flex flex-col items-center">
                        <button onClick={() => moveQuestion(i, "up")} disabled={i === 0}
                          className="text-text-secondary hover:text-text-base disabled:opacity-30 leading-none text-xs">&uarr;</button>
                        <button onClick={() => moveQuestion(i, "down")} disabled={i === previewQuestions.length - 1}
                          className="text-text-secondary hover:text-text-base disabled:opacity-30 leading-none text-xs">&darr;</button>
                      </div>
                      <span className="text-text-secondary w-5 text-center">{i + 1}</span>
                      <span className="text-xs px-1.5 py-0.5 bg-primary/10 text-primary rounded">{TYPE_LABELS[q.type] || q.type}</span>
                      <span className="flex-1 truncate">{q.stem}</span>
                      <span className="text-xs text-text-secondary">{DIFF_LABELS[q.difficulty] || q.difficulty}</span>
                      <input
                        type="number" value={q.score}
                        onChange={e => {
                          const newScore = parseInt(e.target.value) || 0;
                          setPreviewQuestions(prev => prev ? prev.map((p, j) => j === i ? { ...p, score: newScore } : p) : null);
                        }}
                        className="w-14 border border-border rounded-md px-1.5 py-0.5 text-xs text-center" min={1}
                      />
                      <span className="text-xs text-text-secondary">分</span>
                      <button onClick={() => removeFromPreview(i)}
                        className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-600">&times;</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* 底部按钮 */}
        <div className="px-6 py-4 border-t border-border flex items-center justify-between">
          <div>
            {step > 0 && (
              <button onClick={handlePrev} className="px-4 py-2 rounded-md text-sm border border-border hover:bg-bg-layout">
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
                <button onClick={() => handleSave("draft")} disabled={saving}
                  className="px-4 py-2 rounded-md text-sm border border-border hover:bg-bg-layout">
                  {saving ? "保存中..." : "保存草稿"}
                </button>
                <button onClick={() => handleSave("published")} disabled={saving}
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