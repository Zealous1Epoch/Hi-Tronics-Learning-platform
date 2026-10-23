/**
 * 题库选题面板（一键建考向导 / 组卷共用）
 *
 * 左：题库分类树（可搜索、可展开）
 * 右：上下两区——题目列表（题型/难度/关键词筛选，勾选 + 「全选可见」可反选），
 *     其下为「已选题·分值设置」（逐题分值、批量设分值、实时合计）
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

  // 「全选可见」双向切换：可见题未全选 → 补齐；已全选 → 取消这批的选择
  const allVisibleSelected = questions.length > 0 && questions.every((q) => sel.has(q.id));
  const toggleSelectAllVisible = () => {
    if (questions.length === 0) return;
    if (allVisibleSelected) {
      const ids = new Set(questions.map((q) => q.id));
      setSel((prev) => {
        const next = new Map(prev);
        for (const id of ids) next.delete(id);
        return next;
      });
      setOrder((o) => o.filter((id) => !ids.has(id)));
    } else {
      const missing = questions.filter((q) => !sel.has(q.id));
      setSel((prev) => {
        const next = new Map(prev);
        for (const q of missing) {
          next.set(q.id, { question_id: q.id, stem: q.stem, type: q.type, difficulty: q.difficulty, score: 0 });
        }
        return next;
      });
      setOrder((o) => [...o, ...missing.map((q) => q.id)]);
    }
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
            className={`k-tree-item ${bankId === node.id ? "is-active" : ""}`}
            style={{ paddingLeft: `${10 + depth * 14}px` }}
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
        <div className="k-search mb-2">
          <Search size={14} />
          <input
            type="text" placeholder="搜索题库..." value={treeSearch}
            onChange={(e) => setTreeSearch(e.target.value)}
          />
        </div>
        <div className="k-card k-scroll max-h-[66vh] overflow-y-auto py-1">
          {tree.length === 0 ? (
            <p className="text-xs text-text-secondary text-center py-6">题库为空，请先导入试题</p>
          ) : (
            renderTree(filteredTree)
          )}
        </div>
      </div>

      {/* 右：上=题目列表，下=已选题分值设置 */}
      <div className="flex-1 min-w-0 flex flex-col gap-3">
        <div className="k-filter-bar">
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}
            className="k-ctl">
            <option value="">全部题型</option>
            {ALL_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
          </select>
          <select value={diffFilter} onChange={(e) => setDiffFilter(e.target.value)}
            className="k-ctl">
            <option value="">全部难度</option>
            <option value="easy">简单</option>
            <option value="medium">中等</option>
            <option value="hard">困难</option>
          </select>
          <input
            type="text" placeholder="搜索题干..." value={kw} onChange={(e) => setKw(e.target.value)}
            className="k-ctl flex-1 min-w-0"
          />
          <button onClick={toggleSelectAllVisible} disabled={questions.length === 0}
            title={allVisibleSelected ? "取消勾选当前筛选出的全部题目" : "勾选当前筛选出的全部题目"}
            className="k-btn k-btn-default k-btn-sm shrink-0 disabled:opacity-40">
            {allVisibleSelected ? "取消全选" : "全选可见"}
          </button>
        </div>
        <div className="k-card k-scroll max-h-[36vh] overflow-y-auto">
          {!bankId ? (
            <p className="k-empty">请在左侧选择题库分类</p>
          ) : loadingList ? (
            <p className="k-empty">加载中...</p>
          ) : questions.length === 0 ? (
            <p className="k-empty">该分类下暂无符合条件的题目</p>
          ) : (
            <table className="k-table k-table-sticky table-fixed">
              <thead>
                <tr>
                  <th className="w-8"></th>
                  <th>题干</th>
                  <th className="text-center w-16">题型</th>
                  <th className="text-center w-14">难度</th>
                </tr>
              </thead>
              <tbody>
                {questions.map((q) => (
                  <tr key={q.id} className={`cursor-pointer ${sel.has(q.id) ? "bg-accent-fill" : ""}`}
                    onClick={() => toggle(q)}>
                    <td>
                      <input type="checkbox" checked={sel.has(q.id)} onChange={() => toggle(q)} onClick={(e) => e.stopPropagation()} />
                    </td>
                    <td className="truncate">{q.stem}</td>
                    <td className="text-center whitespace-nowrap k-muted">{TYPE_LABELS[q.type] || q.type}</td>
                    <td className="text-center whitespace-nowrap k-muted">{DIFF_LABELS[q.difficulty] || q.difficulty}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* 已选题·分值设置：放在题目列表下方，全宽展开不拥挤 */}
        <div className="k-card p-3 max-h-[32vh] flex flex-col">
          <div className="flex items-center justify-between mb-2">
            <span className="k-card-title">已选 {picked.length} 题 · 分值设置</span>
            <span className="text-xs font-bold text-primary tabular-nums">{unsetCount > 0 ? `已定 ${sumScore} 分` : `合计 ${sumScore} 分`}</span>
          </div>
          {picked.length > 0 && unsetCount > 0 && (
            <div className="flex items-center gap-2 mb-2 text-xs">
              <span className="text-text-secondary shrink-0">批量分值</span>
              <input type="number" min={1} value={batchScore} onChange={(e) => setBatchScore(e.target.value)}
                placeholder="分值" className="k-ctl w-20 text-center" />
              <button onClick={applyBatchScore} className="k-btn k-btn-default k-btn-sm whitespace-nowrap">
                全部设为
              </button>
              <span className="text-text-secondary">尚有 {unsetCount} 题未设分值；留空的题将按目标总分自动平摊。</span>
            </div>
          )}
          {picked.length > 0 && (
            <div className="flex items-center gap-2 px-2 pb-1 text-[11px] text-text-secondary">
              <span className="w-6 shrink-0 text-right">#</span>
              <span className="flex-1 min-w-0">题干</span>
              <span className="w-16 shrink-0 text-center">题型</span>
              <span className="w-14 shrink-0 text-center">难度</span>
              <span className="w-20 shrink-0 text-center">分值</span>
              <span className="w-4 shrink-0" />
            </div>
          )}
          <div className="space-y-1 overflow-y-auto k-scroll flex-1 min-h-0">
            {picked.length === 0 ? (
              <p className="text-xs text-text-secondary text-center py-8">在上方勾选题目（或点「全选可见」），即可在此逐题设置分值</p>
            ) : (
              picked.map((q, i) => (
                <div key={q.question_id} className="flex items-center gap-2 py-1.5 px-2 bg-bg-layout rounded text-xs">
                  <span className="text-text-secondary w-6 shrink-0 text-right">{i + 1}</span>
                  <span className="flex-1 min-w-0 truncate" title={q.stem}>{q.stem}</span>
                  <span className="w-16 shrink-0 text-center text-text-secondary">{TYPE_LABELS[q.type] || q.type}</span>
                  <span className="w-14 shrink-0 text-center text-text-secondary">{DIFF_LABELS[q.difficulty] || q.difficulty}</span>
                  <input
                    type="number" min={0} value={q.score || ""} placeholder="未设"
                    onChange={(e) => setScore(q.question_id, parseInt(e.target.value) || 0)}
                    className="k-ctl w-20 shrink-0 text-center"
                  />
                  <button onClick={() => toggle({ id: q.question_id } as QuestionRow)}
                    title="移除" className="k-link k-link-danger shrink-0">&times;</button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
