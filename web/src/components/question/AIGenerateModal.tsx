import { useState } from "react";
import { api } from "../../lib/api";
import { notify } from "../ui/Toast";

export interface AIDraft {
  type: string;
  stem: string;
  options: Record<string, string> | null;
  answer: Record<string, unknown>;
  keywords: string[] | null;
  difficulty: string;
  category_id: string | null;
  dup_existing: boolean;
  _uid?: string;
}

interface GenerateResponse {
  drafts: AIDraft[];
  warnings: string[];
  meta: { elapsed_ms?: number; generated?: number; model?: string; [k: string]: unknown };
}

interface BulkResult {
  created: number;
  skipped: number;
  errors: string[];
}

interface CategoryOption {
  id: string;
  name: string;
}

interface Props {
  onClose: () => void;
  /** 入库成功后刷新列表 */
  onDone: () => void;
  /** 当前选中的题库分类（默认归属） */
  defaultCategoryId?: string | null;
  categories: CategoryOption[];
}

const TYPE_ROWS = [
  { key: "single_choice", label: "单选题" },
  { key: "multi_choice", label: "多选题" },
  { key: "true_false", label: "判断题" },
  { key: "fill_blank", label: "填空题" },
  { key: "essay", label: "问答题" },
] as const;

const TYPE_LABELS: Record<string, string> = {
  single_choice: "单选", multi_choice: "多选", true_false: "判断",
  fill_blank: "填空", essay: "问答",
};

const DIFF_LABELS: Record<string, string> = { easy: "简单", medium: "中等", hard: "困难" };

type Phase = "form" | "loading" | "review" | "done";

export default function AIGenerateModal({ onClose, onDone, defaultCategoryId, categories }: Props) {
  const [phase, setPhase] = useState<Phase>("form");
  const [topic, setTopic] = useState("");
  const [counts, setCounts] = useState<Record<string, number>>({
    single_choice: 2, multi_choice: 1, true_false: 1, fill_blank: 0, essay: 0,
  });
  const [difficultyMode, setDifficultyMode] = useState("mixed");
  const [categoryId, setCategoryId] = useState(defaultCategoryId || "");
  const [extra, setExtra] = useState("");
  const [error, setError] = useState("");

  const [drafts, setDrafts] = useState<AIDraft[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [elapsedSec, setElapsedSec] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<BulkResult | null>(null);

  const total = TYPE_ROWS.reduce((s, r) => s + (counts[r.key] || 0), 0);
  const checkedCount = drafts.filter(d => d._uid && checked.has(d._uid)).length;

  const handleGenerate = async () => {
    if (!topic.trim()) { setError("请填写主题关键词"); return; }
    if (total < 1 || total > 30) { setError("题目总数需在 1~30 之间"); return; }
    setError("");
    setPhase("loading");
    const t0 = Date.now();
    const tick = setInterval(() => setElapsedSec(Math.round((Date.now() - t0) / 1000)), 1000);
    try {
      const res = await api<GenerateResponse>("/ai/generate", {
        method: "POST",
        body: JSON.stringify({
          topic: topic.trim(),
          counts,
          difficulty_mode: difficultyMode,
          extra_requirement: extra.trim() || null,
          category_id: categoryId || null,
        }),
      });
      const items = (res.drafts || []).map((d, i) => ({ ...d, _uid: `d${i}-${Date.now()}` }));
      setDrafts(items);
      setWarnings(res.warnings || []);
      setChecked(new Set(items.filter(d => !d.dup_existing).map(d => d._uid as string)));
      setPhase(items.length ? "review" : "form");
      if (!items.length) setError("AI 未产出任何有效题目，请调整主题后重试");
    } catch (e) {
      setPhase("form");
      setError(e instanceof Error ? e.message : "生成失败");
    } finally {
      clearInterval(tick);
    }
  };

  const toggle = (uid: string) => {
    setChecked(prev => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid); else next.add(uid);
      return next;
    });
  };

  const removeDraft = (uid: string) => {
    setDrafts(prev => prev.filter(d => d._uid !== uid));
    setChecked(prev => { const n = new Set(prev); n.delete(uid); return n; });
  };

  const changeDifficulty = (uid: string, diff: string) => {
    setDrafts(prev => prev.map(d => (d._uid === uid ? { ...d, difficulty: diff } : d)));
  };

  const handleIngest = async () => {
    const items = drafts
      .filter(d => d._uid && checked.has(d._uid))
      .map(({ _uid, dup_existing, ...rest }) => rest);
    if (!items.length) { notify.error("请先勾选要入库的题目"); return; }
    setSubmitting(true);
    try {
      const r = await api<BulkResult>("/questions/bulk-create", {
        method: "POST",
        body: JSON.stringify({ items }),
      });
      setResult(r);
      setPhase("done");
      onDone();
    } catch (e) {
      notify.error(e instanceof Error ? e.message : "入库失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-16 bg-black/30" onClick={onClose}>
      <div
        className="bg-bg-base rounded-lg shadow-xl w-full max-w-2xl max-h-[85vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-border sticky top-0 bg-bg-base z-10">
          <h3 className="font-bold text-base">
            AI 出题
            {phase === "review" && <span className="ml-2 text-xs font-normal text-text-secondary">审核草稿后入库</span>}
          </h3>
          <button onClick={onClose} className="text-text-secondary hover:text-text-base text-xl leading-none">&times;</button>
        </div>

        <div className="p-6">
          {error && (
            <div className="mb-4 px-3 py-2 rounded bg-red-50 border border-red-200 text-red-600 text-sm">{error}</div>
          )}

          {/* ① 表单 */}
          {phase === "form" && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">主题关键词 <span className="text-red-500">*</span></label>
                <input
                  value={topic}
                  onChange={e => setTopic(e.target.value)}
                  placeholder="如：安全生产基础知识、消防四能力、厂区门禁制度…"
                  className="w-full px-3 py-2 border border-border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                  maxLength={200}
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">
                  各题型数量
                  <span className={`ml-2 text-xs font-normal ${total >= 1 && total <= 30 ? "text-text-secondary" : "text-red-500"}`}>
                    合计 {total} 题（1~30）
                  </span>
                </label>
                <div className="grid grid-cols-5 gap-2">
                  {TYPE_ROWS.map(r => (
                    <div key={r.key} className="text-center">
                      <div className="text-xs text-text-secondary mb-1">{r.label}</div>
                      <input
                        type="number" min={0} max={30}
                        value={counts[r.key]}
                        onChange={e => setCounts(prev => ({ ...prev, [r.key]: Math.max(0, Math.min(30, parseInt(e.target.value) || 0)) }))}
                        className="w-full px-2 py-1.5 border border-border rounded-md text-sm text-center"
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1">难度策略</label>
                  <select value={difficultyMode} onChange={e => setDifficultyMode(e.target.value)}
                    className="w-full px-3 py-2 border border-border rounded-md text-sm bg-bg-base">
                    <option value="mixed">混合分布</option>
                    <option value="easy">偏易</option>
                    <option value="medium">中等</option>
                    <option value="hard">偏难</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">入库分类</label>
                  <select value={categoryId} onChange={e => setCategoryId(e.target.value)}
                    className="w-full px-3 py-2 border border-border rounded-md text-sm bg-bg-base">
                    <option value="">不指定</option>
                    {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">补充要求（可选，仅影响出题风格）</label>
                <textarea
                  value={extra}
                  onChange={e => setExtra(e.target.value)}
                  rows={2}
                  maxLength={500}
                  placeholder="如：结合制造业车间场景；避免出现具体法规条文编号"
                  className="w-full px-3 py-2 border border-border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button onClick={onClose} className="px-4 py-2 border border-border rounded-md text-sm hover:bg-bg-layout">取消</button>
                <button onClick={handleGenerate}
                  className="px-4 py-2 bg-primary text-white rounded-md text-sm hover:bg-primary-light disabled:opacity-50"
                  disabled={total < 1 || total > 30}>
                  ✨ 开始生成
                </button>
              </div>
            </div>
          )}

          {/* ② 生成中 */}
          {phase === "loading" && (
            <div className="py-14 text-center">
              <div className="inline-block w-9 h-9 border-[3px] border-primary/25 border-t-primary rounded-full animate-spin mb-4" />
              <p className="text-sm text-primary font-medium">AI 正在出题，请稍候…</p>
              <p className="text-xs text-text-secondary mt-2">
                按题型并行生成，通常需要 30-90 秒（已等待 {elapsedSec}s）。请勿关闭本窗口。
              </p>
            </div>
          )}

          {/* ③ 审核 */}
          {phase === "review" && (
            <div className="space-y-3">
              {warnings.length > 0 && (
                <details className="text-xs text-text-secondary bg-bg-layout/60 rounded-md px-3 py-2">
                  <summary className="cursor-pointer select-none">生成过程提示（{warnings.length} 条）</summary>
                  <ul className="mt-2 space-y-1 list-disc pl-4">
                    {warnings.map((w, i) => <li key={i}>{w}</li>)}
                  </ul>
                </details>
              )}

              {drafts.map((d, idx) => {
                const uid = d._uid as string;
                const isChecked = checked.has(uid);
                return (
                  <div key={uid}
                    className={`rounded-lg border p-3 ${
                      d.dup_existing ? "border-amber-300 bg-amber-50/60" : "border-border bg-bg-layout/40"
                    }`}>
                    <div className="flex items-start gap-2">
                      <input type="checkbox" checked={isChecked} onChange={() => toggle(uid)} className="mt-1.5" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className="px-1.5 py-0.5 rounded bg-primary/10 text-primary text-xs">{TYPE_LABELS[d.type] || d.type} {idx + 1}</span>
                          {d.dup_existing && (
                            <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 text-xs">疑似与题库重复</span>
                          )}
                          <select value={d.difficulty} onChange={e => changeDifficulty(uid, e.target.value)}
                            className="px-1.5 py-0.5 border border-border rounded text-xs bg-bg-base">
                            {Object.entries(DIFF_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                          </select>
                          <button onClick={() => removeDraft(uid)}
                            className="ml-auto text-xs text-text-secondary hover:text-red-500">删除</button>
                        </div>
                        <p className="text-sm text-text-base whitespace-pre-wrap break-words">{d.stem}</p>

                        {d.options && (
                          <div className="mt-1.5 space-y-0.5">
                            {Object.entries(d.options).map(([k, v]) => {
                              const isCorrect = Array.isArray(d.answer.correct)
                                ? (d.answer.correct as string[]).includes(k)
                                : d.answer.correct === k;
                              return (
                                <div key={k} className={`text-xs break-words ${isCorrect ? "text-green-700 font-medium" : "text-text-secondary"}`}>
                                  {k}. {v}{isCorrect ? " ✓" : ""}
                                </div>
                              );
                            })}
                          </div>
                        )}

                        <div className="mt-1.5 text-xs">
                          {(d.type === "single_choice" || d.type === "multi_choice") && (
                            <span className="text-green-700">正确答案：{Array.isArray(d.answer.correct) ? (d.answer.correct as string[]).join("、") : String(d.answer.correct ?? "-")}</span>
                          )}
                          {d.type === "true_false" && (
                            <span className="text-green-700">正确答案：{d.answer.correct ? "正确" : "错误"}</span>
                          )}
                          {d.type === "fill_blank" && (
                            <span className="text-green-700">答案：{String(d.answer.correct ?? "-")}</span>
                          )}
                          {d.type === "essay" && (
                            <div className="text-text-secondary">
                              <span className="font-medium">参考答案：</span>
                              <span className="whitespace-pre-wrap">{String(d.answer.reference ?? "-")}</span>
                              {d.keywords && d.keywords.length > 0 && (
                                <span className="ml-2 text-text-secondary/70">关键词：{d.keywords.join("、")}</span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}

              <div className="flex items-center justify-between pt-2 sticky bottom-0 bg-bg-base pb-1">
                <button onClick={() => setPhase("form")} className="px-4 py-2 border border-border rounded-md text-sm hover:bg-bg-layout">
                  ← 重新生成
                </button>
                <button onClick={handleIngest} disabled={submitting || checkedCount === 0}
                  className="px-4 py-2 bg-primary text-white rounded-md text-sm hover:bg-primary-light disabled:opacity-50">
                  {submitting ? "入库中…" : `入库选中 ${checkedCount} 题`}
                </button>
              </div>
            </div>
          )}

          {/* ④ 完成 */}
          {phase === "done" && result && (
            <div className="py-8 text-center space-y-3">
              <div className="text-3xl">✅</div>
              <p className="text-sm font-medium text-primary">
                已入库 {result.created} 题
                {result.skipped > 0 && <span className="text-text-secondary font-normal">，跳过重复 {result.skipped} 题</span>}
                {result.errors.length > 0 && <span className="text-red-500 font-normal">，失败 {result.errors.length} 题</span>}
              </p>
              {result.errors.length > 0 && (
                <ul className="text-xs text-red-500 list-disc pl-4 text-left max-h-32 overflow-y-auto">
                  {result.errors.map((e, i) => <li key={i}>{e}</li>)}
                </ul>
              )}
              <p className="text-xs text-text-secondary">入库题目已自动打上「AI生成」标签</p>
              <button onClick={onClose} className="px-5 py-2 bg-primary text-white rounded-md text-sm hover:bg-primary-light">完成</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
