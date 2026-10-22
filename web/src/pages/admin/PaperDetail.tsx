import { useState, useEffect, useMemo, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Search } from "lucide-react";
import { api } from "../../lib/api";

interface PaperData {
  id: string; title: string; category_id: string | null;
  paper_type: string; total_score: number; status: string;
  mandatory_questions: { question_id: string; score: number }[] | null;
  random_rules: { type: string; difficulty: string; count: number; score: number }[] | null;
  source_banks: string[] | null;
}
interface QuestionItem {
  id: string; type: string; stem: string; options: Record<string, string> | null;
  difficulty: string; category_id?: string;
}
interface TreeNode {
  id: string; name: string; parent_id: string | null;
  children: TreeNode[];
}
interface FlatCategory {
  id: string; name: string; parent_id: string | null;
}

const TYPE_LABELS: Record<string, string> = {
  single_choice: "单选", multi_choice: "多选", true_false: "判断",
  fill_blank: "填空", essay: "问答",
};
const DIFF_LABELS: Record<string, string> = { easy: "简单", medium: "中等", hard: "困难" };
const ALL_TYPES = ["single_choice", "multi_choice", "true_false", "fill_blank", "essay"] as const;

export default function PaperDetail() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [paper, setPaper] = useState<PaperData | null>(null);
  const [allQuestions, setAllQuestions] = useState<QuestionItem[]>([]);
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [flatCategories, setFlatCategories] = useState<FlatCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // 固定组卷
  const [selectedBankId, setSelectedBankId] = useState<string | null>(null);
  const [bankQuestions, setBankQuestions] = useState<QuestionItem[]>([]);
  const [selectedQuestions, setSelectedQuestions] = useState<Map<string, number>>(new Map());
  const [questionOrder, setQuestionOrder] = useState<string[]>([]);
  const [questionData, setQuestionData] = useState<Map<string, QuestionItem>>(new Map());

  // 随机组卷
  const [selectedBankIds, setSelectedBankIds] = useState<Set<string>>(new Set());
  const [rules, setRules] = useState<Record<string, { enabled: boolean; difficulties: Record<string, { count: number; score: number }> }>>({
    single_choice: { enabled: false, difficulties: { easy: { count: 0, score: 0 }, medium: { count: 0, score: 0 }, hard: { count: 0, score: 0 } } },
    multi_choice: { enabled: false, difficulties: { easy: { count: 0, score: 0 }, medium: { count: 0, score: 0 }, hard: { count: 0, score: 0 } } },
    true_false: { enabled: false, difficulties: { easy: { count: 0, score: 0 }, medium: { count: 0, score: 0 }, hard: { count: 0, score: 0 } } },
    fill_blank: { enabled: false, difficulties: { easy: { count: 0, score: 0 }, medium: { count: 0, score: 0 }, hard: { count: 0, score: 0 } } },
    essay: { enabled: false, difficulties: { easy: { count: 0, score: 0 }, medium: { count: 0, score: 0 }, hard: { count: 0, score: 0 } } },
  });

  // 随机预览
  const [previewQuestions, setPreviewQuestions] = useState<(QuestionItem & { score: number })[] | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  // 加载数据
  useEffect(() => {
    Promise.all([
      api<PaperData>(`/papers/${id}`),
      api<{ items: QuestionItem[] }>("/questions?page_size=200"),
      api<TreeNode[]>("/question-categories/tree"),
      api<FlatCategory[]>("/question-categories/flat"),
    ]).then(([paperData, questionsData, treeData, catsData]) => {
      setPaper(paperData);
      setAllQuestions(questionsData.items);
      setTree(treeData);
      setFlatCategories(catsData);

      if (paperData.paper_type === "fixed" && paperData.mandatory_questions) {
        const map = new Map<string, number>();
        const order: string[] = [];
        const dataMap = new Map<string, QuestionItem>();
        paperData.mandatory_questions.forEach(mq => {
          map.set(mq.question_id, mq.score);
          order.push(mq.question_id);
          const q = questionsData.items.find(q2 => q2.id === mq.question_id);
          if (q) dataMap.set(q.id, q);
        });
        setSelectedQuestions(map);
        setQuestionOrder(order);
        setQuestionData(dataMap);
      }
      if (paperData.paper_type === "random") {
        if (paperData.source_banks) {
          setSelectedBankIds(new Set(paperData.source_banks));
        }
        if (paperData.random_rules) {
          const newRules = { ...rules };
          paperData.random_rules.forEach(r => {
            if (!newRules[r.type]) return;
            newRules[r.type] = {
              enabled: true,
              difficulties: {
                ...newRules[r.type].difficulties,
                [r.difficulty]: { count: r.count, score: r.score },
              },
            };
          });
          setRules(newRules);
        }
      }
      setLoading(false);
    });
  }, [id]);

  // 切换题库时加载题目
  useEffect(() => {
    if (!selectedBankId) { setBankQuestions([]); return; }
    api<{ items: QuestionItem[] }>(`/questions?category_id=${selectedBankId}&page_size=200`)
      .then(data => setBankQuestions(data.items));
  }, [selectedBankId]);

  const toggleQuestion = useCallback((qid: string) => {
    const isAdding = !selectedQuestions.has(qid);

    setSelectedQuestions(prev => {
      const next = new Map(prev);
      if (isAdding) {
        next.set(qid, 10);
      } else {
        next.delete(qid);
      }
      return next;
    });

    setQuestionOrder(prev => {
      if (isAdding) return [...prev, qid];
      return prev.filter(id => id !== qid);
    });

    if (isAdding) {
      const q = bankQuestions.find(q2 => q2.id === qid);
      if (q) {
        setQuestionData(prev => {
          const next = new Map(prev);
          next.set(qid, q);
          return next;
        });
      }
    } else {
      setQuestionData(prev => {
        const next = new Map(prev);
        next.delete(qid);
        return next;
      });
    }
  }, [selectedQuestions, bankQuestions]);

  const setQuestionScore = useCallback((qid: string, score: number) => {
    setSelectedQuestions(prev => {
      const next = new Map(prev);
      next.set(qid, score);
      return next;
    });
  }, []);

  const moveQuestion = useCallback((qid: string, dir: "up" | "down") => {
    setQuestionOrder(prev => {
      const idx = prev.indexOf(qid);
      if (idx === -1) return prev;
      const next = [...prev];
      if (dir === "up" && idx > 0) [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
      else if (dir === "down" && idx < prev.length - 1) [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
      return next;
    });
  }, []);

  const totalScore = useMemo(() => {
    if (!paper) return 0;
    if (paper.paper_type === "fixed") {
      return Array.from(selectedQuestions.values()).reduce((a, b) => a + b, 0);
    }
    return Object.values(rules).reduce((sum, r) => {
      if (!r.enabled) return sum;
      return sum + Object.values(r.difficulties).reduce((s, d) => s + d.count * d.score, 0);
    }, 0);
  }, [paper, selectedQuestions, rules]);

  const getCategoryPath = (catId: string | null): string => {
    if (!catId) return "-";
    const parts: string[] = [];
    let current = flatCategories.find(c => c.id === catId);
    while (current) {
      parts.unshift(current.name);
      current = current!.parent_id ? flatCategories.find(c => c.id === current!.parent_id) : undefined;
    }
    return parts.join(" - ");
  };

  // 树组件
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [searchText, setSearchText] = useState("");

  const toggleExpand = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

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
    setExpandedIds(new Set(collectIds(filteredTree)));
  }, [searchText]);

  const renderTree = (nodes: TreeNode[], depth: number = 0, isRandom: boolean) => {
    return nodes.map(node => {
      const isExpanded = expandedIds.has(node.id);
      const isSelected = isRandom ? selectedBankIds.has(node.id) : selectedBankId === node.id;
      const hasChildren = node.children.length > 0;

      return (
        <div key={node.id}>
          <div
            className={`flex items-center gap-1 py-1.5 px-2 cursor-pointer hover:bg-bg-layout rounded text-sm ${
              isSelected ? "bg-primary/10 text-primary font-medium" : ""
            }`}
            style={{ paddingLeft: `${8 + depth * 16}px` }}
            onClick={() => {
              if (isRandom) {
                if (!hasChildren) {
                  setSelectedBankIds(prev => {
                    const next = new Set(prev);
                    next.has(node.id) ? next.delete(node.id) : next.add(node.id);
                    return next;
                  });
                }
              } else {
                setSelectedBankId(node.id);
              }
              if (hasChildren) toggleExpand(node.id);
            }}
          >
            {hasChildren ? (
              <button onClick={e => { e.stopPropagation(); toggleExpand(node.id); }}
                className="p-0.5 shrink-0 text-text-secondary">
                {isExpanded ? "▼" : "▶"}
              </button>
            ) : (
              <span className="w-5 shrink-0" />
            )}
            <span className="truncate">{node.name}</span>
          </div>
          {isExpanded && hasChildren && renderTree(node.children, depth + 1, isRandom)}
        </div>
      );
    });
  };

  // 生成预览
  const generatePreview = async () => {
    if (!paper) return;
    const result: (QuestionItem & { score: number })[] = [];

    if (paper.paper_type === "fixed") {
      questionOrder.forEach(qid => {
        const score = selectedQuestions.get(qid) || 10;
        const q = questionData.get(qid);
        result.push({
          id: qid,
          type: q?.type || "",
          stem: q?.stem || "(题目已删除)",
          options: q?.options || null,
          difficulty: q?.difficulty || "",
          score,
        });
      });
    } else {
      const bankIds = [...selectedBankIds];
      const promises = bankIds.map(bid => api<{ items: QuestionItem[] }>(`/questions?category_id=${bid}&page_size=200`));
      const results = await Promise.all(promises);
      const allBankQuestions = results.flatMap(r => r.items);

      Object.entries(rules).forEach(([type, rule]) => {
        if (rule.enabled) {
          const typeQuestions = allBankQuestions.filter(q => q.type === type);
          Object.entries(rule.difficulties).forEach(([diff, d]) => {
            if (d.count <= 0) return;
            const diffQuestions = typeQuestions.filter(q => q.difficulty === diff);
            const shuffled = [...diffQuestions].sort(() => Math.random() - 0.5);
            for (let i = 0; i < d.count; i++) {
              const q = shuffled[i % shuffled.length];
              if (q) {
                result.push({ ...q, score: d.score });
              } else {
                result.push({
                  id: `${type}-${diff}-${i}`, type: type as any, stem: `[${TYPE_LABELS[type]}] ${DIFF_LABELS[diff]} - 题库中暂无此类题目`,
                  options: null, difficulty: diff, score: d.score,
                });
              }
            }
          });
        }
      });
    }
    setPreviewQuestions(result);
    setShowPreview(true);
  };

  const handleSave = async () => {
    if (!paper || !id) return;
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        title: paper.title,
        category_id: paper.category_id,
        paper_type: paper.paper_type,
        total_score: totalScore,
        status: paper.status,
      };

      if (paper.paper_type === "fixed") {
        body.mandatory_questions = questionOrder.map(qid => ({
          question_id: qid,
          score: selectedQuestions.get(qid) || 10,
        }));
        body.random_rules = null;
        body.source_banks = null;
      } else {
        body.mandatory_questions = null;
        body.random_rules = Object.entries(rules)
          .filter(([, r]) => r.enabled)
          .flatMap(([type, r]) =>
            Object.entries(r.difficulties)
              .filter(([, d]) => d.count > 0)
              .map(([difficulty, d]) => ({ type, difficulty, count: d.count, score: d.score }))
          );
        body.source_banks = [...selectedBankIds];
      }

      await api(`/papers/${id}`, { method: "PUT", body: JSON.stringify(body) });
      navigate("/admin/papers");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "未知错误";
      alert(`保存失败：${msg}`);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p className="k-empty">加载中...</p>;
  if (!paper) return <p className="k-empty">试卷不存在</p>;

  return (
    <div className="flex flex-col min-h-0">
      {/* 头部 */}
      <div className="flex items-center justify-between mb-4 pb-3 border-b border-border">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3">
            <input
              type="text" value={paper.title}
              onChange={e => setPaper({ ...paper, title: e.target.value })}
              className="text-xl font-bold text-primary bg-transparent border-none outline-none focus:border-b focus:border-primary/30 px-0 py-0 w-auto"
            />
            <span className={paper.status === "published" ? "k-tag k-tag-success" : "k-tag"}>
              {paper.status === "published" ? "已发布" : "草稿"}
            </span>
          </div>
          <p className="text-sm text-text-secondary mt-1">
            {getCategoryPath(paper.category_id)} | {paper.paper_type === "fixed" ? "固定组卷" : "随机组卷"} | 总分: {totalScore}分
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          {paper.paper_type === "random" && (
            <button onClick={generatePreview}
              className="k-btn k-btn-default k-btn-sm">
              生成预览
            </button>
          )}
          <button onClick={handleSave} disabled={saving}
            className="k-btn k-btn-primary k-btn-sm disabled:opacity-50">
            {saving ? "保存中..." : "保存"}
          </button>
          <button onClick={() => navigate("/admin/papers")}
            className="k-btn k-btn-default k-btn-sm">
            返回
          </button>
        </div>
      </div>

      {paper.paper_type === "fixed" ? (
        <div className="flex gap-4 flex-1 min-h-0">
          {/* 左侧题库树 */}
          <div className="w-48 shrink-0">
            <div className="k-search mb-2">
              <Search size={14} />
              <input
                type="text" placeholder="搜索题库..."
                value={searchText} onChange={e => setSearchText(e.target.value)}
              />
            </div>
            <div className="k-card max-h-[65vh] overflow-y-auto">
              {filteredTree.length === 0 ? (
                <p className="p-4 text-sm text-text-secondary text-center">暂无分类</p>
              ) : (
                <div className="py-1">{renderTree(filteredTree, 0, false)}</div>
              )}
            </div>
          </div>

          {/* 中间题目列表 */}
          <div className="flex-1 min-w-0">
            {!selectedBankId ? (
              <div className="k-card k-empty">
                请在左侧选择题库
              </div>
            ) : (
              <div className="k-table-wrap max-h-[65vh] overflow-y-auto">
                <table className="k-table k-table-sticky table-fixed">
                  <thead>
                    <tr>
                      <th className="w-8"></th>
                      <th>题干</th>
                      <th className="text-center w-16">题型</th>
                      <th className="text-center w-16">难度</th>
                      <th className="text-center w-20">分值</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bankQuestions.map(q => (
                      <tr key={q.id} className={selectedQuestions.has(q.id) ? "bg-primary/5" : ""}>
                        <td>
                          <input type="checkbox" checked={selectedQuestions.has(q.id)} onChange={() => toggleQuestion(q.id)} />
                        </td>
                        <td className="truncate max-w-xs">{q.stem}</td>
                        <td className="text-center whitespace-nowrap k-muted">{TYPE_LABELS[q.type]}</td>
                        <td className="text-center whitespace-nowrap k-muted">{DIFF_LABELS[q.difficulty]}</td>
                        <td className="text-center">
                          {selectedQuestions.has(q.id) && (
                            <input type="number" value={selectedQuestions.get(q.id) || 10}
                              onChange={e => setQuestionScore(q.id, parseInt(e.target.value) || 0)}
                              className="k-ctl w-14 text-center" min={1} />
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* 右侧已选面板 */}
          {questionOrder.length > 0 && (
            <div className="w-64 shrink-0">
              <div className="k-card p-3 sticky top-0">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-bold">已选题目 ({questionOrder.length}题)</span>
                  <span className={`text-xs font-bold ${totalScore === paper.total_score ? "text-success" : "text-warning"}`}>
                    {totalScore} / {paper.total_score}分
                  </span>
                </div>
                <div className="space-y-1 max-h-[60vh] overflow-y-auto">
                  {questionOrder.map((qid, i) => {
                    const q = questionData.get(qid) || allQuestions.find(q2 => q2.id === qid);
                    return (
                      <div key={qid} className="flex items-center gap-1 py-1.5 px-2 bg-bg-layout rounded text-xs group">
                        <div className="flex flex-col items-center shrink-0">
                          <button onClick={() => moveQuestion(qid, "up")} disabled={i === 0}
                            className="text-text-secondary hover:text-text-base disabled:opacity-30 leading-none">&uarr;</button>
                          <button onClick={() => moveQuestion(qid, "down")} disabled={i === questionOrder.length - 1}
                            className="text-text-secondary hover:text-text-base disabled:opacity-30 leading-none">&darr;</button>
                        </div>
                        <span className="text-text-secondary w-4 shrink-0 text-center">{i + 1}.</span>
                        <span className="flex-1 truncate">{q?.stem?.slice(0, 15) || qid.slice(0, 8)}</span>
                        <input type="number" value={selectedQuestions.get(qid) || 10}
                          onChange={e => setQuestionScore(qid, parseInt(e.target.value) || 0)}
                          className="k-ctl w-12 text-center" min={1} />
                        <span className="text-text-secondary text-xs">分</span>
                        <button onClick={() => toggleQuestion(qid)}
                          className="k-link k-link-danger opacity-0 group-hover:opacity-100 ml-1">&times;</button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 min-h-0 space-y-4">
          {/* 题库范围 */}
          <div className="k-card p-4">
            <h3 className="k-card-title mb-3">选题库范围</h3>
            <div className="flex gap-4">
              <div className="w-48 shrink-0">
                <div className="k-search mb-2">
                  <Search size={14} />
                  <input
                    type="text" placeholder="搜索题库..."
                    value={searchText} onChange={e => setSearchText(e.target.value)}
                  />
                </div>
                <div className="bg-bg-layout rounded border border-border max-h-40 overflow-y-auto">
                  {filteredTree.length === 0 ? (
                    <p className="p-3 text-sm text-text-secondary text-center">暂无分类</p>
                  ) : (
                    <div className="py-1">{renderTree(filteredTree, 0, true)}</div>
                  )}
                </div>
              </div>
              <div className="flex-1">
                <p className="text-xs text-text-secondary mb-2">已选题库（点击叶子节点切换选择）：</p>
                {selectedBankIds.size === 0 ? (
                  <p className="text-sm text-text-secondary">请在左侧选择题库</p>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {[...selectedBankIds].map(bid => (
                      <span key={bid} className="k-tag k-tag-primary">
                        {getCategoryPath(bid)}
                        <button onClick={() => setSelectedBankIds(prev => {
                          const next = new Set(prev);
                          next.delete(bid);
                          return next;
                        })} className="k-link k-link-danger">&times;</button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* 组卷策略 */}
          <div className="k-card p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="k-card-title">组卷策略（合计 {totalScore} 分）</h3>
              {totalScore !== paper.total_score && (
                <span className="text-xs text-warning">与目标总分({paper.total_score}分)不一致</span>
              )}
            </div>
            <div className="space-y-3">
              {ALL_TYPES.map(type => (
                <div key={type} className={`py-3 px-4 rounded-lg border ${rules[type].enabled ? "border-primary/30 bg-primary/5" : "border-border bg-bg-layout"}`}>
                  <label className="flex items-center gap-2 text-sm cursor-pointer mb-2">
                    <input
                      type="checkbox"
                      checked={rules[type].enabled}
                      onChange={e => setRules(prev => ({
                        ...prev,
                        [type]: { ...prev[type], enabled: e.target.checked },
                      }))}
                    />
                    <span className="font-medium">{TYPE_LABELS[type]}</span>
                  </label>
                  {rules[type].enabled && (
                    <div className="space-y-1.5 ml-6">
                      {(Object.entries(DIFF_LABELS) as [string, string][]).map(([diffKey, diffLabel]) => (
                        <div key={diffKey} className="flex items-center gap-2">
                          <span className="text-xs text-text-secondary w-8">{diffLabel}</span>
                          <span className="text-xs text-text-secondary">抽</span>
                          <input
                            type="number" value={rules[type].difficulties[diffKey].count || ""}
                            onChange={e => setRules(prev => ({
                              ...prev,
                              [type]: {
                                ...prev[type],
                                difficulties: {
                                  ...prev[type].difficulties,
                                  [diffKey]: { ...prev[type].difficulties[diffKey], count: parseInt(e.target.value) || 0 },
                                },
                              },
                            }))}
                            className="k-ctl w-14 text-center" min={0}
                          />
                          <span className="text-xs text-text-secondary">题，每题</span>
                          <input
                            type="number" value={rules[type].difficulties[diffKey].score || ""}
                            onChange={e => setRules(prev => ({
                              ...prev,
                              [type]: {
                                ...prev[type],
                                difficulties: {
                                  ...prev[type].difficulties,
                                  [diffKey]: { ...prev[type].difficulties[diffKey], score: parseInt(e.target.value) || 0 },
                                },
                              },
                            }))}
                            className="k-ctl w-14 text-center" min={0}
                          />
                          <span className="text-xs text-text-secondary">分</span>
                          <span className="text-xs text-text-secondary ml-auto">
                            = {rules[type].difficulties[diffKey].count * rules[type].difficulties[diffKey].score} 分
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 预览弹窗 */}
      {showPreview && previewQuestions && (
        <div className="k-overlay" onClick={() => setShowPreview(false)}>
          <div className="k-modal k-scroll max-w-lg max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="k-title text-primary">试卷预览（{previewQuestions.length} 题，{previewQuestions.reduce((s, q) => s + q.score, 0)} 分）</h3>
              {paper.paper_type === "random" && (
                <button onClick={generatePreview} className="k-link">换一批</button>
              )}
            </div>
            <div className="space-y-3">
              {previewQuestions.map((q, i) => (
                <div key={`${q.id}-${i}`} className="py-2 px-3 bg-bg-layout rounded text-sm">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-bold text-primary">{i + 1}.</span>
                    <span className="text-xs text-text-secondary">[{TYPE_LABELS[q.type]}]</span>
                    <span className="text-xs text-text-secondary">{DIFF_LABELS[q.difficulty]}</span>
                    <span className="text-xs text-primary ml-auto">{q.score}分</span>
                  </div>
                  <p>{q.stem}</p>
                </div>
              ))}
            </div>
            <div className="k-modal-actions">
              <button onClick={() => setShowPreview(false)} className="k-btn k-btn-default k-btn-sm">关闭</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}