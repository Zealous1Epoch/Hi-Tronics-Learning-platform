import { useRef, useState } from "react";
import { Loader2, Upload } from "lucide-react";
import { api, uploadFile } from "../../lib/api";
import { notify } from "../ui/Toast";
import CategoryCascadeSelect from "../ui/CategoryCascadeSelect";
import { getCategoryPath, type FlatCategory } from "../CourseTree";

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
  /** 入库时的非致命提醒（如目标分类已失效被置为未分类） */
  warnings?: string[];
}

interface ParseResult {
  name: string;
  ext: string;
  chars: number;
  truncated: boolean;
  text: string;
  note: string | null;
}

interface RefDoc extends ParseResult {
  id: string;
}

interface Props {
  onClose: () => void;
  /** 入库成功后刷新列表 */
  onDone: () => void;
  /** 当前选中的题库分类（默认归属） */
  defaultCategoryId?: string | null;
  /** 带层级的题库分类平铺表（级联选择用） */
  categories: FlatCategory[];
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

const DIFF_MODE_LABELS: Record<string, string> = {
  mixed: "混合分布", easy: "偏易", medium: "中等", hard: "偏难",
};

const AUDIENCE_PRESETS = ["新入职员工", "一线操作工", "班组长", "办公室职员", "全员"];

const KP_MAX = 8;
const KP_MAX_LEN = 50;
const REF_MAX = 8000;
const FILE_MAX_MB = 20;
const FILE_EXTS = ["pdf", "docx", "png", "jpg", "jpeg", "webp", "bmp", "gif", "txt", "md"];

const STEP_LABELS = ["出什么", "怎么出", "放到哪"];

type Phase = "form" | "loading" | "review" | "done";

/** 摘要行 */
function SumRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <span className="w-16 shrink-0 text-text-secondary">{label}</span>
      <span className="flex-1 min-w-0 break-words text-text-base">{value}</span>
    </div>
  );
}

export default function AIGenerateModal({ onClose, onDone, defaultCategoryId, categories }: Props) {
  const [phase, setPhase] = useState<Phase>("form");
  const [step, setStep] = useState(1);

  // 第 1 步：出什么
  const [topic, setTopic] = useState("");
  const [kps, setKps] = useState<string[]>([]);
  const [kpInput, setKpInput] = useState("");
  const [refText, setRefText] = useState("");
  const [refDocs, setRefDocs] = useState<RefDoc[]>([]);
  const [parsingName, setParsingName] = useState("");
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  // 第 2 步：怎么出（counts 为字符串原样保存：允许留空与连续输入，blur 时才 clamp）
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [difficultyMode, setDifficultyMode] = useState("mixed");
  const [audience, setAudience] = useState("");
  const [extra, setExtra] = useState("");
  // 第 3 步：放到哪
  const [categoryId, setCategoryId] = useState(defaultCategoryId || "");

  const [error, setError] = useState("");
  const [drafts, setDrafts] = useState<AIDraft[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [elapsedSec, setElapsedSec] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<BulkResult | null>(null);

  const numCounts: Record<string, number> = {};
  TYPE_ROWS.forEach(r => { numCounts[r.key] = parseInt(counts[r.key] || "", 10) || 0; });
  const total = TYPE_ROWS.reduce((s, r) => s + numCounts[r.key], 0);
  const totalOk = total >= 1 && total <= 30;
  const checkedCount = drafts.filter(d => d._uid && checked.has(d._uid)).length;
  const refTotal = refText.length + refDocs.reduce((s, d) => s + d.chars, 0);

  const commitKp = (raw: string) => {
    const parts = raw.split(/[,，、]/).map(s => s.trim()).filter(Boolean);
    if (!parts.length) return;
    setKps(prev => {
      const next = [...prev];
      for (const p of parts) {
        if (next.length >= KP_MAX) break;
        const t = p.slice(0, KP_MAX_LEN);
        if (!next.includes(t)) next.push(t);
      }
      return next;
    });
    setKpInput("");
  };

  const handleKpKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === "，" || e.key === ",") {
      e.preventDefault();
      commitKp(kpInput);
    } else if (e.key === "Backspace" && !kpInput && kps.length) {
      setKps(prev => prev.slice(0, -1));
    }
  };

  /** 单文件上传解析：成功进卡片列表，失败仅提示（串行调用，同一时刻只有一个解析进度文案） */
  const parseOne = async (f: File) => {
    const ext = (f.name.includes(".") ? f.name.split(".").pop()! : "").toLowerCase();
    if (!FILE_EXTS.includes(ext)) { notify.error(`不支持的文件类型：${f.name}`); return; }
    if (f.size > FILE_MAX_MB * 1024 * 1024) { notify.error(`${f.name} 超过 ${FILE_MAX_MB}MB 上限`); return; }
    setParsingName(f.name);
    try {
      const r = await uploadFile<ParseResult>("/ai/parse-document", f);
      if (!r.text) { notify.info(r.note || `${r.name}：未识别到文字内容`); return; }
      setRefDocs(prev => [...prev, { ...r, id: `doc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}` }]);
      notify.success(`${r.name}：已识别 ${r.chars} 字`);
    } catch (e) {
      notify.error(`${f.name}：${e instanceof Error ? e.message : "解析失败"}`);
    } finally {
      setParsingName("");
    }
  };

  const handleFiles = async (list: FileList | File[]) => {
    for (const f of Array.from(list)) await parseOne(f);
  };

  const setCountRaw = (key: string, v: string) => {
    // 只去非数字与前导零，不做范围 clamp（否则清空/连打会被强改，如 14 变 014）
    setCounts(prev => ({ ...prev, [key]: v.replace(/\D/g, "").replace(/^0+(?=\d)/, "") }));
  };

  const blurCount = (key: string) => {
    setCounts(prev => {
      const raw = prev[key] || "";
      if (!raw) return prev;
      const n = Math.max(0, Math.min(30, parseInt(raw, 10) || 0));
      return { ...prev, [key]: String(n) };
    });
  };

  const nextStep = () => {
    if (step === 1 && !topic.trim()) { setError("请填写主题关键词"); return; }
    if (step === 2 && !totalOk) { setError("题目数量合计需在 1~30 之间"); return; }
    setError("");
    setStep(s => Math.min(3, s + 1));
  };

  /** 手贴文本 + 解析文件拼成最终参考资料；超限截断 */
  const buildReferenceText = (): string | null => {
    const parts: string[] = [];
    if (refText.trim()) parts.push(refText.trim());
    refDocs.forEach(d => parts.push(`【${d.name}】\n${d.text}`));
    let s = parts.join("\n\n");
    if (s.length > REF_MAX) {
      s = s.slice(0, REF_MAX);
      notify.info(`参考资料超出 ${REF_MAX} 字，已截断`);
    }
    return s || null;
  };

  const refDesc = (() => {
    const bits: string[] = [];
    if (refDocs.length) bits.push(`${refDocs.length} 个文件`);
    if (refText.trim()) bits.push("手动粘贴");
    if (!bits.length) return "未提供（按通识出题）";
    return `${bits.join(" + ")} · 约 ${Math.min(refTotal, REF_MAX)} 字`;
  })();

  const handleGenerate = async () => {
    if (!topic.trim()) { setError("请填写主题关键词"); setStep(1); return; }
    if (!totalOk) { setError("题目数量合计需在 1~30 之间"); setStep(2); return; }
    setError("");
    setPhase("loading");
    const t0 = Date.now();
    const tick = setInterval(() => setElapsedSec(Math.round((Date.now() - t0) / 1000)), 1000);
    try {
      const res = await api<GenerateResponse>("/ai/generate", {
        method: "POST",
        body: JSON.stringify({
          topic: topic.trim(),
          counts: numCounts,
          difficulty_mode: difficultyMode,
          extra_requirement: extra.trim() || null,
          category_id: categoryId || null,
          knowledge_points: kps.length ? kps : null,
          audience: audience.trim() || null,
          reference_text: buildReferenceText(),
        }),
      });
      const items = (res.drafts || []).map((d, i) => ({ ...d, _uid: `d${i}-${Date.now()}` }));
      setDrafts(items);
      setWarnings(res.warnings || []);
      setChecked(new Set(items.filter(d => !d.dup_existing).map(d => d._uid as string)));
      setPhase(items.length ? "review" : "form");
      if (!items.length) {
        // 全军覆没时把过程 warnings 直接摊开（否则用户只看到「未产出题目」，无从得知 LLM 调用失败原因）
        const ws = res.warnings || [];
        setError(ws.length
          ? `AI 未产出有效题目。原因：${ws.slice(0, 3).join("；")}${ws.length > 3 ? `（共 ${ws.length} 条提示）` : ""}`
          : "AI 未产出任何有效题目，请调整主题后重试");
      }
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

  const composeText =
    TYPE_ROWS.filter(r => numCounts[r.key] > 0).map(r => `${r.label} ${numCounts[r.key]}`).join(" · ") || "—";

  return (
    <div className="fixed inset-0 z-[60] bg-black/30 flex items-start justify-end" onClick={onClose}>
      <div
        className="bg-bg-base h-full w-full max-w-2xl shadow-xl flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <h3 className="k-modal-title mb-0!">
            AI 出题
            {phase === "review" && <span className="ml-2 text-xs font-normal text-text-secondary">审核草稿后入库</span>}
          </h3>
          <button onClick={onClose} className="text-text-secondary hover:text-text-base text-xl leading-none">&times;</button>
        </div>

        <div className="flex-1 overflow-y-auto k-scroll p-6">
          {error && (
            <div className="mb-4 px-3 py-2 rounded bg-red-50 border border-red-200 text-red-600 text-sm">{error}</div>
          )}

          {/* ① 设置向导：出什么 → 怎么出 → 放到哪 */}
          {phase === "form" && (
            <div>
              {/* 步骤条 */}
              <div className="flex items-center justify-center gap-2 mb-6">
                {STEP_LABELS.map((label, i) => {
                  const n = i + 1;
                  const active = n === step;
                  const done = n < step;
                  return (
                    <div key={label} className="flex items-center gap-2">
                      {i > 0 && <div className={`h-px w-8 ${active || done ? "bg-primary/50" : "bg-border"}`} />}
                      <button
                        type="button"
                        disabled={!done}
                        onClick={() => setStep(n)}
                        className={`flex items-center gap-1.5 text-xs transition-colors ${
                          active ? "text-primary font-medium"
                            : done ? "text-text-base cursor-pointer hover:text-primary"
                              : "text-text-muted"
                        }`}
                      >
                        <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-[11px] border ${
                          active ? "border-primary bg-primary text-white"
                            : done ? "border-primary text-primary bg-transparent"
                              : "border-border text-text-muted"
                        }`}>{n}</span>
                        {label}
                      </button>
                    </div>
                  );
                })}
              </div>

              {/* 第 1 步：出什么 */}
              {step === 1 && (
                <div className="space-y-4">
                  <div>
                    <label className="k-label">主题关键词 <span className="text-red-500">*</span></label>
                    <input
                      value={topic}
                      onChange={e => setTopic(e.target.value)}
                      className="k-input"
                      maxLength={200}
                    />
                  </div>

                  <div>
                    <label className="k-label">
                      知识点要点
                      <span className="ml-2 text-xs font-normal text-text-secondary">
                        可选，输入后回车添加，建议 2~6 个，题目会在这些知识点间分布（{kps.length}/{KP_MAX}）
                      </span>
                    </label>
                    <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-border bg-bg-card px-2 py-1.5 focus-within:border-primary transition-colors">
                      {kps.map(k => (
                        <span key={k} className="inline-flex items-center gap-1 rounded bg-primary/10 text-primary px-1.5 py-0.5 text-xs max-w-full">
                          <span className="truncate">{k}</span>
                          <button type="button" onClick={() => setKps(prev => prev.filter(x => x !== k))}
                            className="text-primary/60 hover:text-primary leading-none">&times;</button>
                        </span>
                      ))}
                      <input
                        value={kpInput}
                        onChange={e => setKpInput(e.target.value)}
                        onKeyDown={handleKpKeyDown}
                        onBlur={() => commitKp(kpInput)}
                        disabled={kps.length >= KP_MAX}
                        className="flex-1 min-w-[180px] bg-transparent border-0 outline-none p-0 m-0 text-[13px] text-text-base"
                        maxLength={KP_MAX_LEN}
                      />
                    </div>
                  </div>

                  <div>
                    <label className="k-label">
                      参考资料
                      <span className="ml-2 text-xs font-normal text-text-secondary">
                        可选，题目将优先依据材料命制（已 {Math.min(refTotal, REF_MAX)}/{REF_MAX} 字）
                      </span>
                    </label>
                    <div
                      className={`rounded-lg border border-dashed px-4 py-5 text-center cursor-pointer transition-colors ${
                        dragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/60"
                      }`}
                      onClick={() => !parsingName && fileRef.current?.click()}
                      onDragOver={e => { e.preventDefault(); setDragging(true); }}
                      onDragLeave={() => setDragging(false)}
                      onDrop={e => {
                        e.preventDefault();
                        setDragging(false);
                        if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
                      }}
                    >
                      <input
                        ref={fileRef}
                        type="file"
                        hidden
                        multiple
                        accept={FILE_EXTS.map(x => `.${x}`).join(",")}
                        onChange={e => {
                          if (e.target.files?.length) handleFiles(e.target.files);
                          e.target.value = "";
                        }}
                      />
                      {parsingName ? (
                        <div className="flex items-center justify-center gap-2 text-sm text-primary">
                          <Loader2 size={15} className="animate-spin" />
                          正在解析 {parsingName}…
                        </div>
                      ) : (
                        <div className="flex flex-col items-center gap-1 text-text-secondary">
                          <Upload size={18} className="text-text-muted" />
                          <p className="text-sm">点击选择或拖拽文件到此处</p>
                          <p className="text-xs text-text-muted">支持 PDF / Word(.docx) / 图片 / txt / md · 单个 ≤{FILE_MAX_MB}MB · 可多个</p>
                        </div>
                      )}
                    </div>

                    {refDocs.length > 0 && (
                      <div className="mt-2 space-y-1.5">
                        {refDocs.map(d => {
                          const hint = d.note || (d.truncated ? "内容超长，已截取前 20000 字" : "");
                          return (
                            <div key={d.id} className="rounded-md border border-border bg-bg-layout/50 px-3 py-1.5">
                              <div className="flex items-center gap-2 text-xs">
                                <span className="truncate flex-1 text-text-base">{d.name}</span>
                                <span className="text-text-secondary shrink-0">{d.chars} 字</span>
                                <button type="button"
                                  onClick={() => setRefDocs(prev => prev.filter(x => x.id !== d.id))}
                                  className="text-text-muted hover:text-red-500 leading-none shrink-0">&times;</button>
                              </div>
                              {hint && <p className="mt-0.5 text-[11px] text-amber-600 break-words">{hint}</p>}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    <textarea
                      value={refText}
                      onChange={e => setRefText(e.target.value)}
                      rows={3}
                      maxLength={REF_MAX}
                      className="k-textarea mt-2"
                    />
                  </div>
                </div>
              )}

              {/* 第 2 步：怎么出 */}
              {step === 2 && (
                <div className="space-y-4">
                  <div>
                    <label className="k-label">
                      各题型数量
                      <span className={`ml-2 text-xs font-normal ${totalOk ? "text-text-secondary" : "text-red-500"}`}>
                        合计 {total} 题（1~30）
                      </span>
                    </label>
                    <div className="grid grid-cols-5 gap-2">
                      {TYPE_ROWS.map(r => (
                        <div key={r.key} className="text-center">
                          <div className="text-xs text-text-secondary mb-1">{r.label}</div>
                          <input
                            inputMode="numeric"
                            value={counts[r.key] ?? ""}
                            onChange={e => setCountRaw(r.key, e.target.value)}
                            onBlur={() => blurCount(r.key)}
                            className="k-input text-center"
                          />
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="k-label">难度策略</label>
                    <select value={difficultyMode} onChange={e => setDifficultyMode(e.target.value)}
                      className="k-select">
                      {Object.entries(DIFF_MODE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </div>

                  <div>
                    <label className="k-label">考核对象 <span className="ml-2 text-xs font-normal text-text-secondary">可选，影响用词深浅与场景设定</span></label>
                    <div className="flex flex-wrap gap-1.5 mb-1.5">
                      {AUDIENCE_PRESETS.map(p => (
                        <button key={p} type="button"
                          onClick={() => setAudience(audience === p ? "" : p)}
                          className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
                            audience === p
                              ? "border-primary bg-primary/10 text-primary"
                              : "border-border text-text-secondary hover:border-primary/50 hover:text-primary"
                          }`}>{p}</button>
                      ))}
                    </div>
                    <input
                      value={audience}
                      onChange={e => setAudience(e.target.value)}
                      className="k-input"
                      maxLength={100}
                    />
                  </div>

                  <div>
                    <label className="k-label">
                      补充要求
                      <span className="ml-2 text-xs font-normal text-text-secondary">可选，仅影响出题风格（{extra.length}/500）</span>
                    </label>
                    <textarea
                      value={extra}
                      onChange={e => setExtra(e.target.value)}
                      rows={2}
                      maxLength={500}
                      className="k-textarea"
                    />
                  </div>
                </div>
              )}

              {/* 第 3 步：放到哪 + 摘要确认 */}
              {step === 3 && (
                <div className="space-y-4">
                  <div>
                    <label className="k-label">入库分类 <span className="ml-2 text-xs font-normal text-text-secondary">可选，入库题目归属的题库分类</span></label>
                    <CategoryCascadeSelect
                      value={categoryId}
                      onChange={setCategoryId}
                      categories={categories}
                      placeholder="选择入库分类（可不选）"
                      className="w-full"
                    />
                  </div>

                  <div>
                    <label className="k-label">生成设置摘要</label>
                    <div className="rounded-lg border border-border bg-bg-layout/40 px-4 py-3 text-xs space-y-1.5">
                      <SumRow label="主题" value={topic.trim() || "—"} />
                      <SumRow label="知识点" value={kps.length ? kps.join("、") : "未指定（按主题自由发挥）"} />
                      <SumRow label="题目构成" value={`${composeText}，共 ${total} 题`} />
                      <SumRow label="难度策略" value={DIFF_MODE_LABELS[difficultyMode] || difficultyMode} />
                      <SumRow label="考核对象" value={audience.trim() || "未指定"} />
                      <SumRow label="参考资料" value={refDesc} />
                      <SumRow label="补充要求" value={extra.trim() ? extra.trim() : "未填写"} />
                      <SumRow label="入库分类" value={categoryId ? getCategoryPath(categoryId, categories) : "不指定"} />
                    </div>
                  </div>
                </div>
              )}

              <div className="k-modal-actions">
                {step === 1 ? (
                  <button onClick={onClose} className="k-btn k-btn-default">取消</button>
                ) : (
                  <button onClick={() => { setError(""); setStep(s => s - 1); }} className="k-btn k-btn-default">← 上一步</button>
                )}
                {step < 3 ? (
                  <button onClick={nextStep} className="k-btn k-btn-primary">下一步：{STEP_LABELS[step]} →</button>
                ) : (
                  <button onClick={handleGenerate}
                    className="k-btn k-btn-primary disabled:opacity-50"
                    disabled={!totalOk || !topic.trim()}>
                    ✨ 开始生成
                  </button>
                )}
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
                // 质量提示（纯派生，不新增状态）：选项长短悬殊可被「选最长」蒙对
                const optLens = d.options ? Object.values(d.options).map(s => String(s).length) : [];
                const optSpread = optLens.length >= 2 ? Math.max(...optLens) - Math.min(...optLens) : 0;
                const essayNoKw = d.type === "essay" && (!d.keywords || d.keywords.length === 0);
                return (
                  <div key={uid}
                    className={`rounded-lg border p-3 ${
                      d.dup_existing ? "border-amber-300 bg-amber-50/60" : "border-border bg-bg-layout/40"
                    }`}>
                    <div className="flex items-start gap-2">
                      <input type="checkbox" checked={isChecked} onChange={() => toggle(uid)} className="mt-1.5" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className="k-tag k-tag-primary">{TYPE_LABELS[d.type] || d.type} {idx + 1}</span>
                          {d.dup_existing && (
                            <span className="k-tag k-tag-warning">疑似与题库重复</span>
                          )}
                          {optSpread > 15 && (
                            <span className="k-tag k-tag-warning" title="选项长短悬殊，存在「选最长」提示效应，建议人工核对">选项长短悬殊</span>
                          )}
                          {essayNoKw && (
                            <span className="k-tag k-tag-danger" title="系统按关键词命中自动给分，缺关键词的问答题全员 0 分">缺评分关键词</span>
                          )}
                          <select value={d.difficulty} onChange={e => changeDifficulty(uid, e.target.value)}
                            className="k-ctl">
                            {Object.entries(DIFF_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                          </select>
                          <button onClick={() => removeDraft(uid)}
                            className="k-link k-link-danger ml-auto">删除</button>
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
                <button onClick={() => { setPhase("form"); setStep(3); }} className="k-btn k-btn-default">
                  ← 调整设置重生成
                </button>
                <button onClick={handleIngest} disabled={submitting || checkedCount === 0}
                  className="k-btn k-btn-primary disabled:opacity-50">
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
              {result.warnings && result.warnings.length > 0 && (
                <ul className="text-xs text-amber-600 list-disc pl-4 text-left max-h-24 overflow-y-auto">
                  {result.warnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              )}
              {result.errors.length > 0 && (
                <ul className="text-xs text-red-500 list-disc pl-4 text-left max-h-32 overflow-y-auto">
                  {result.errors.map((e, i) => <li key={i}>{e}</li>)}
                </ul>
              )}
              <p className="text-xs text-text-secondary">入库题目已自动打上「AI生成」标签</p>
              <button onClick={onClose} className="k-btn k-btn-primary">完成</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
