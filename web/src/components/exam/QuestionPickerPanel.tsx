/**
 * 题库选题面板（一键建考向导 / 组卷共用）
 *
 * 左：题库分类树（可搜索、可展开）
 * 中：题目列表（题型/难度/关键词筛选，勾选 + 「全选可见」）
 * 右：已选题面板（逐题分值、批量设分值、实时合计）
 *
 * score=0 表示「未设分值」，由后端按目标总分自动平摊。
 */
import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Search } from "lucide-react";
import { api } from "../../lib/api";

export interface PickedQuestion {
  question_id: string;
  stem: string;
  type: string;
  difficulty: string;
  score: number;
}

interface TreeNode {
  id: string; name: string; parent_id: string | null; children: TreeNode[];
}
interface QuestionRow {
  id: string; type: string; stem: string; difficulty: string;
}

export const TYPE_LABELS: Record<string, string> = {
  single_choice: "单选题", multi_choice: "多选题", true_false: "判断题",
  fill_blank: "填空题", essay: "问答题",
};
export const DIFF_LABELS: Record<string, string> = { easy: "简单", medium: "中等", hard: "困难" };
export const ALL_TYPES = ["single_choice", "multi_choice", "true_false", "fill_blank", "essay"] as const;

interface Props {
  onChange: (categoryId: string | null, items: PickedQuestion[]) => void;
  /** 空题库时的引导（如「去导入试题」按钮由父组件渲染） */
  onBankEmpty?: (categoryId: string) => void;
  /** 变化时重拉题目列表（向导内就地补题后立即看到新题） */
  refreshKey?: number;
  /** 复制考试预填：打开面板时直接带入题库分类与已选题列表 */
  initialBankId?: string | null;
  initialItems?: PickedQuestion[];
}

export default function QuestionPickerPanel({ onChange, refreshKey, initialBankId, initialItems }: Props) {
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [treeSearch, setTreeSearch] = useState("");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [bankId, setBankId] = useState<string | null>(initialBankId ?? null);

  const [questions, setQuestions] = useState<QuestionRow[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [typeFilter, setTypeFilter] = useState("");
  const [diffFilter, setDiffFilter] = useState("");
  const [kw, setKw] = useState("");

  // 已选题：Map<qid, PickedQuestion>，order 保持加入顺序（复制考试时用 initialItems 预填）
  const [sel, setSel] = useState<Map<string, PickedQuestion>>(
    () => new Map((initialItems || []).map((q) => [q.question_id, q])),
  );
  const [order, setOrder] = useState<string[]>(() => (initialItems || []).map((q) => q.question_id));
  const [batchScore, setBatchScore] = useState("");

  useEffect(() => {
    api<TreeNode[]>("/question-categories/tree").then((t) => setTree(t)).catch(() => setTree([]));
  }, []);

  useEffect(() => {
    if (!bankId) { setQuestions([]); return; }
    setLoadingList(true);
    const params = new URLSearchParams({ category_id: bankId, page_size: "200" });
    if (typeFilter) params.set("type", typeFilter);
    if (diffFilter) params.set("difficulty", diffFilter);
    if (kw.trim()) params.set("search", kw.trim());
    api<{ items: QuestionRow[] }>(`/questions?${params.toString()}`)
      .then((d) => setQuestions(d.items))
      .catch(() => setQuestions([]))
      .finally(() => setLoadingList(false));
  }, [bankId, typeFilter, diffFilter, kw, refreshKey]);

  // 选择结果向父组件同步
  useEffect(() => {
    onChange(bankId, order.map((id) => sel.get(id)!).filter(Boolean));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bankId, sel, order]);

  const toggle = (q: QuestionRow) => {
    setSel((prev) => {
      const next = new Map(prev);
      if (next.has(q.id)) {
        next.delete(q.id);
        setOrder((o) => o.filter((id) => id !== q.id));
      } else {
        next.set(q.id, { question_id: q.id, stem: q.stem, type: q.type, difficulty: q.difficulty, score: 0 });
        setOrder((o) => [...o, q.id]);
      }
      return next;
    });
  };

  const selectAllVisible = () => {
    setSel((prev) => {
      const next = new Map(prev);
      const added: string[] = [];
      for (const q of questions) {
        if (!next.has(q.id)) {
          next.set(q.id, { question_id: q.id, stem: q.stem, type: q.type, difficulty: q.difficulty, score: 0 });
          added.push(q.id);
        }
      }
      if (added.length) setOrder((o) => [...o, ...added]);
      return next;
    });
  };

  const setScore = (qid: string, score: number) => {
    setSel((prev) => {
      const next = new Map(prev);
      const item = next.get(qid);
      if (item) next.set(qid, { ...item, score });
      return next;
    });
  };

  const applyBatchScore = () => {
    const v = parseInt(batchScore) || 0;
    if (v <= 0) return;
    setSel((prev) => {
      const next = new Map(prev);
      for (const id of order) {
        const item = next.get(id);
        if (item) next.set(id, { ...item, score: v });
      }
      return next;
    });
  };

  const picked = useMemo(() => order.map((id) => sel.get(id)!).filter(Boolean), [order, sel]);
  const sumScore = picked.reduce((s, q) => s + q.score, 0);
  const unsetCount = picked.filter((q) => q.score <= 0).length;

  // ── 树 ──
  const filterTree = (nodes: TreeNode[], term: string): TreeNode[] => {
    if (!term) return nodes;
    const lower = term.toLowerCase();
    const out: TreeNode[] = [];
    for (const n of nodes) {
      const kids = filterTree(n.children, lower);
      if (n.name.toLowerCase().includes(lower) || kids.length > 0) out.push({ ...n, children: kids });
    }
    return out;
  };
  const filteredTree = treeSearch ? filterTree(tree, treeSearch.toLowerCase()) : tree;

  const renderTree = (nodes: TreeNode[], depth = 0) =>
    nodes.map((node) => {
      const isExpanded = expandedIds.has(node.id);
      const hasChildren = node.children.length > 0;
      return (
        <div key={node.id}>
          <div
            className={`flex items-center gap-1 py-1.5 px-2 cursor-pointer hover:bg-bg-layout rounded text-sm ${
              bankId === node.id ? "bg-primary/10 text-primary font-medium" : ""
            }`}
            style={{ paddingLeft: `${8 + depth * 14}px` }}
            onClick={() => {
              setBankId(node.id);
              if (hasChildren) {
                setExpandedIds((prev) => {
                  const next = new Set(prev);
                  if (next.has(node.id)) next.delete(node.id); else next.add(node.id);
                  return next;
                });
              }
            }}
          >
            {hasChildren ? (
              <button
                onClick={(e) => { e.stopPropagation(); setExpandedIds((prev) => { const n = new Set(prev); if (n.has(node.id)) n.delete(node.id); else n.add(node.id); return n; }); }}
                className="p-0.5 shrink-0 text-text-secondary"
              >
                {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              </button>
            ) : (
              <span className="w-4 shrink-0" />
            )}
            <span className="truncate">{node.name}</span>
          </div>
          {isExpanded && hasChildren && renderTree(node.children, depth + 1)}
        </div>
      );
    });

  return (
    <div className="flex gap-3">
      {/* 左：分类树 */}
      <div className="w-44 shrink-0">
        <div className="relative mb-2">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-secondary" />
          <input
            type="text" placeholder="搜索题库..." value={treeSearch}
            onChange={(e) => setTreeSearch(e.target.value)}
            className="w-full border border-border rounded-md pl-7 pr-2 py-1.5 text-sm"
          />
        </div>
        <div className="border border-border rounded-lg max-h-[42vh] overflow-y-auto py-1">
          {tree.length === 0 ? (
            <p className="text-xs text-text-secondary text-center py-6">题库为空，请先导入试题</p>
          ) : (
            renderTree(filteredTree)
          )}
        </div>
      </div>

      {/* 中：题目列表 */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-2">
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}
            className="border border-border rounded-md px-2 py-1 text-xs">
            <option value="">全部题型</option>
            {ALL_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
          </select>
          <select value={diffFilter} onChange={(e) => setDiffFilter(e.target.value)}
            className="border border-border rounded-md px-2 py-1 text-xs">
            <option value="">全部难度</option>
            <option value="easy">简单</option>
            <option value="medium">中等</option>
            <option value="hard">困难</option>
          </select>
          <input
            type="text" placeholder="搜索题干..." value={kw} onChange={(e) => setKw(e.target.value)}
            className="flex-1 min-w-0 border border-border rounded-md px-2 py-1 text-xs"
          />
          <button onClick={selectAllVisible} disabled={questions.length === 0}
            className="text-xs px-2.5 py-1 border border-border rounded-md hover:bg-bg-layout shrink-0 disabled:opacity-40">
            全选可见
          </button>
        </div>
        <div className="border border-border rounded-lg max-h-[36vh] overflow-y-auto">
          {!bankId ? (
            <p className="text-sm text-text-secondary text-center py-12">请在左侧选择题库分类</p>
          ) : loadingList ? (
            <p className="text-sm text-text-secondary text-center py-12">加载中...</p>
          ) : questions.length === 0 ? (
            <p className="text-sm text-text-secondary text-center py-12">该分类下暂无符合条件的题目</p>
          ) : (
            <table className="w-full text-sm table-fixed">
              <thead className="bg-bg-layout sticky top-0">
                <tr>
                  <th className="px-3 py-2 w-8"></th>
                  <th className="text-left px-3 py-2 text-text-secondary font-normal">题干</th>
                  <th className="text-center px-3 py-2 text-text-secondary font-normal w-16">题型</th>
                  <th className="text-center px-3 py-2 text-text-secondary font-normal w-14">难度</th>
                </tr>
              </thead>
              <tbody>
                {questions.map((q) => (
                  <tr key={q.id} className={`border-b border-border/50 last:border-0 cursor-pointer ${sel.has(q.id) ? "bg-primary/5" : "hover:bg-bg-layout"}`}
                    onClick={() => toggle(q)}>
                    <td className="px-3 py-2">
                      <input type="checkbox" checked={sel.has(q.id)} onChange={() => toggle(q)} onClick={(e) => e.stopPropagation()} />
                    </td>
                    <td className="px-3 py-2 truncate text-text-base">{q.stem}</td>
                    <td className="px-3 py-2 text-center text-text-secondary text-xs whitespace-nowrap">{TYPE_LABELS[q.type] || q.type}</td>
                    <td className="px-3 py-2 text-center text-text-secondary text-xs whitespace-nowrap">{DIFF_LABELS[q.difficulty] || q.difficulty}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* 右：已选题 */}
      <div className="w-60 shrink-0">
        <div className="border border-border rounded-lg p-3 max-h-[42vh] flex flex-col">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-bold">已选 {picked.length} 题</span>
            <span className="text-xs font-bold text-primary">{unsetCount > 0 ? `已定 ${sumScore} 分` : `合计 ${sumScore} 分`}</span>
          </div>
          {picked.length > 0 && unsetCount > 0 && (
            <div className="flex items-center gap-1.5 mb-2 text-xs">
              <input type="number" min={1} value={batchScore} onChange={(e) => setBatchScore(e.target.value)}
                placeholder="分值" className="w-14 border border-border rounded-md px-1.5 py-1 text-center" />
              <button onClick={applyBatchScore} className="px-2 py-1 border border-border rounded-md hover:bg-bg-layout whitespace-nowrap">
                全部设为
              </button>
              <span className="text-text-secondary">（{unsetCount} 题未设，留空将按总分平摊）</span>
            </div>
          )}
          <div className="space-y-1 overflow-y-auto flex-1">
            {picked.length === 0 ? (
              <p className="text-xs text-text-secondary text-center py-8">勾选题目后出现在这里</p>
            ) : (
              picked.map((q, i) => (
                <div key={q.question_id} className="flex items-center gap-1.5 py-1 px-2 bg-bg-layout rounded text-xs">
                  <span className="text-text-secondary w-4 shrink-0">{i + 1}.</span>
                  <span className="flex-1 truncate" title={q.stem}>{q.stem}</span>
                  <input
                    type="number" min={0} value={q.score || ""} placeholder="—"
                    onChange={(e) => setScore(q.question_id, parseInt(e.target.value) || 0)}
                    onClick={(e) => e.stopPropagation()}
                    className="w-11 border border-border rounded px-1 py-0.5 text-center shrink-0"
                  />
                  <button onClick={() => toggle({ id: q.question_id } as QuestionRow)}
                    className="text-red-400 hover:text-red-600 shrink-0">&times;</button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
