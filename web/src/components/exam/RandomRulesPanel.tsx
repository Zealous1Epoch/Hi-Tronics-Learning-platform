/**
 * 随机组卷规则面板（一键建考向导用）
 *
 * 左：题库范围多选（不选 = 从全题库抽取；选中父级 = 服务端自动展开整链）
 * 右：题型 × 难度 抽题数量/每题分值
 * 「服务端预览」调 POST /exams/preview-draw——与学员端开考同一套抽题逻辑，
 * 所见即所得；题库缺题时给出明确提示而不是本地洗牌假装成功。
 */
import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { api } from "../../lib/api";
import { ALL_TYPES, TYPE_LABELS, DIFF_LABELS } from "./QuestionPickerPanel";

export interface RandomRule {
  type: string;
  difficulty: string;
  count: number;
  score: number;
}

interface TreeNode {
  id: string; name: string; parent_id: string | null; children: TreeNode[];
}
interface PreviewQuestion {
  id: string; type: string; stem: string; difficulty: string; score: number;
}

interface Props {
  onChange: (sourceBanks: string[], rules: RandomRule[]) => void;
}

export default function RandomRulesPanel({ onChange }: Props) {
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [banks, setBanks] = useState<Set<string>>(new Set());
  // rules[type][difficulty] = {count, score}
  const [rules, setRules] = useState<Record<string, Record<string, { count: number; score: number }>>>(() => {
    const init: Record<string, Record<string, { count: number; score: number }>> = {};
    for (const t of ALL_TYPES) init[t] = { easy: { count: 0, score: 0 }, medium: { count: 0, score: 0 }, hard: { count: 0, score: 0 } };
    return init;
  });

  const [preview, setPreview] = useState<{ questions: PreviewQuestion[]; total_score: number; shortages: string[] } | null>(null);
  const [previewing, setPreviewing] = useState(false);

  useEffect(() => {
    api<TreeNode[]>("/question-categories/tree").then(setTree).catch(() => setTree([]));
  }, []);

  const validRules: RandomRule[] = ALL_TYPES.flatMap((t) =>
    (["easy", "medium", "hard"] as const)
      .map((d) => ({ type: t, difficulty: d, count: rules[t][d].count, score: rules[t][d].score }))
      .filter((r) => r.count > 0)
  );

  useEffect(() => {
    onChange([...banks], validRules);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [banks, rules]);

  const total = validRules.reduce((s, r) => s + r.count * r.score, 0);

  const toggleBank = (id: string) => {
    setBanks((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const setField = (type: string, diff: string, field: "count" | "score", v: number) => {
    setRules((prev) => ({
      ...prev,
      [type]: { ...prev[type], [diff]: { ...prev[type][diff], [field]: v } },
    }));
  };

  const renderTree = (nodes: TreeNode[], depth = 0) =>
    nodes.map((node) => {
      const isExpanded = expandedIds.has(node.id);
      const hasChildren = node.children.length > 0;
      return (
        <div key={node.id}>
          <div
            className={`flex items-center gap-1 py-1.5 px-2 cursor-pointer hover:bg-bg-layout rounded text-sm ${
              banks.has(node.id) ? "bg-primary/10 text-primary font-medium" : ""
            }`}
            style={{ paddingLeft: `${8 + depth * 14}px` }}
            onClick={() => {
              toggleBank(node.id);
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
                onClick={(e) => {
                  e.stopPropagation();
                  setExpandedIds((prev) => {
                    const next = new Set(prev);
                    if (next.has(node.id)) next.delete(node.id); else next.add(node.id);
                    return next;
                  });
                }}
                className="p-0.5 shrink-0 text-text-secondary"
              >
                {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              </button>
            ) : (
              <span className="w-4 shrink-0" />
            )}
            <span className="truncate">{node.name}</span>
            {banks.has(node.id) && <span className="ml-auto text-xs text-primary shrink-0">✓</span>}
          </div>
          {isExpanded && hasChildren && renderTree(node.children, depth + 1)}
        </div>
      );
    });

  const handlePreview = async () => {
    setPreviewing(true);
    try {
      const data = await api<{ questions: PreviewQuestion[]; total_score: number; shortages: string[] }>(
        "/exams/preview-draw",
        { method: "POST", body: JSON.stringify({ random_rules: validRules, source_banks: [...banks].length ? [...banks] : null }) },
      );
      setPreview(data);
    } catch (e: unknown) {
      setPreview({ questions: [], total_score: 0, shortages: [e instanceof Error ? e.message : "预览失败"] });
    } finally {
      setPreviewing(false);
    }
  };

  return (
    <div className="flex gap-3">
      {/* 左：题库范围 */}
      <div className="w-44 shrink-0">
        <p className="text-xs text-text-secondary mb-1.5">抽题范围（不选 = 全题库）</p>
        <div className="border border-border rounded-lg max-h-[40vh] overflow-y-auto py-1">
          {tree.length === 0 ? (
            <p className="text-xs text-text-secondary text-center py-6">题库为空，请先导入试题</p>
          ) : renderTree(tree)}
        </div>
        {banks.size > 0 && (
          <button onClick={() => setBanks(new Set())} className="text-xs text-text-secondary hover:text-primary mt-1.5">
            清除范围（{banks.size}）
          </button>
        )}
      </div>

      {/* 右：规则 */}
      <div className="flex-1 min-w-0">
        <div className="space-y-2">
          {ALL_TYPES.map((type) => (
            <div key={type} className="border border-border rounded-lg px-3 py-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium w-16 shrink-0">{TYPE_LABELS[type]}</span>
                <div className="flex-1 flex items-center gap-4">
                  {(["easy", "medium", "hard"] as const).map((d) => (
                    <div key={d} className="flex items-center gap-1 text-xs">
                      <span className="text-text-secondary">{DIFF_LABELS[d]}</span>
                      <span className="text-text-secondary">抽</span>
                      <input
                        type="number" min={0}
                        value={rules[type][d].count || ""} placeholder="0"
                        onChange={(e) => setField(type, d, "count", parseInt(e.target.value) || 0)}
                        className="w-12 border border-border rounded px-1 py-0.5 text-center"
                      />
                      <span className="text-text-secondary">题×</span>
                      <input
                        type="number" min={0}
                        value={rules[type][d].score || ""} placeholder="0"
                        onChange={(e) => setField(type, d, "score", parseInt(e.target.value) || 0)}
                        className="w-12 border border-border rounded px-1 py-0.5 text-center"
                      />
                      <span className="text-text-secondary">分</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between mt-3">
          <span className="text-sm font-bold text-primary">合计 {total} 分（{validRules.reduce((s, r) => s + r.count, 0)} 题）</span>
          <button onClick={handlePreview} disabled={validRules.length === 0 || previewing}
            className="text-sm px-3 py-1.5 border border-primary text-primary rounded-md hover:bg-primary/5 disabled:opacity-40">
            {previewing ? "抽题中..." : "服务端预览抽题"}
          </button>
        </div>
        {validRules.some((r) => r.score <= 0) && (
          <p className="text-xs text-amber-600 mt-1">存在未设每题分值的规则，创建前请补充分值</p>
        )}
      </div>

      {/* 预览弹窗 */}
      {preview && (
        <div className="fixed inset-0 bg-black/30 flex items-start justify-center pt-20 z-[60]" onClick={() => setPreview(null)}>
          <div className="bg-bg-base rounded-lg shadow-xl p-5 w-full max-w-lg max-h-[70vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h4 className="font-bold">抽题预览（{preview.questions.length} 题 / {preview.total_score} 分）</h4>
              <div className="flex items-center gap-3">
                <button onClick={handlePreview} className="text-sm text-primary hover:underline">换一批</button>
                <button onClick={() => setPreview(null)} className="text-text-secondary hover:text-text-base text-lg">&times;</button>
              </div>
            </div>
            {preview.shortages.length > 0 && (
              <div className="mb-3 px-3 py-2 rounded-md bg-amber-50 text-amber-700 border border-amber-200 text-xs space-y-0.5">
                {preview.shortages.map((s, i) => <p key={i}>⚠ {s}</p>)}
              </div>
            )}
            <div className="space-y-2">
              {preview.questions.map((q, i) => (
                <div key={`${q.id}-${i}`} className="py-2 px-3 bg-bg-layout rounded text-sm">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="font-bold text-primary text-xs">{i + 1}.</span>
                    <span className="text-xs text-text-secondary">[{TYPE_LABELS[q.type]}]</span>
                    <span className="text-xs text-text-secondary">{DIFF_LABELS[q.difficulty]}</span>
                    <span className="text-xs text-text-secondary ml-auto">{q.score}分</span>
                  </div>
                  <p className="truncate">{q.stem}</p>
                </div>
              ))}
              {preview.questions.length === 0 && <p className="text-sm text-text-secondary text-center py-6">未抽到题目</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
