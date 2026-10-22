import { useState, useEffect, forwardRef, useImperativeHandle } from "react";
import { Search } from "lucide-react";

export interface QuestionManageHandle {
  openCreate: () => void;
  handleExport: () => void;
  openImport: () => void;
  openAI: () => void;
}
import { api, BASE } from "../../lib/api";
import AIGenerateModal from "../../components/question/AIGenerateModal";
import ImportQuestionsModal from "../../components/question/ImportQuestionsModal";
import ComboSelect from "../../components/ui/ComboSelect";
import CategoryCascadeSelect from "../../components/ui/CategoryCascadeSelect";

interface QuestionItem {
  id: string; type: string; stem: string; options: Record<string, string> | null;
  answer: Record<string, unknown>; keywords: string[] | null;
  difficulty: string; created_at: string;
}
interface FlatCategory {
  id: string; name: string; parent_id: string | null;
}

const TYPE_OPTIONS = [
  { value: "", label: "全部题型" },
  { value: "single_choice", label: "单选题" },
  { value: "multi_choice", label: "多选题" },
  { value: "true_false", label: "判断题" },
  { value: "fill_blank", label: "填空题" },
  { value: "essay", label: "问答题" },
];

const DIFFICULTY_OPTIONS = [
  { value: "", label: "全部难度" },
  { value: "easy", label: "简单" },
  { value: "medium", label: "中等" },
  { value: "hard", label: "困难" },
];

const TYPE_LABELS: Record<string, string> = {
  single_choice: "单选", multi_choice: "多选", true_false: "判断",
  fill_blank: "填空", essay: "问答",
};

const DIFF_LABELS: Record<string, string> = { easy: "简单", medium: "中等", hard: "困难" };
const DIFF_COLORS: Record<string, string> = {
  easy: "k-tag k-tag-success", medium: "k-tag k-tag-warning", hard: "k-tag k-tag-danger",
};

interface Props {
  categoryId?: string | null;
  /** KPI 面板题型卡选中值（受控）：变化时同步内部题型筛选 */
  externalTypeFilter?: string;
  /** 内部题型筛选变化时回传（下拉切换 → KPI 高亮同步） */
  onTypeFilterChange?: (type: string) => void;
}

const QuestionManage = forwardRef<QuestionManageHandle, Props>(function QuestionManage({ categoryId: propCategoryId, externalTypeFilter, onTypeFilterChange }, ref) {
  const [questions, setQuestions] = useState<QuestionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState("");
  const [diffFilter, setDiffFilter] = useState("");
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [previewQuestion, setPreviewQuestion] = useState<QuestionItem | null>(null);
  const [saving, setSaving] = useState(false);
  const [flatCategories, setFlatCategories] = useState<FlatCategory[]>([]);
  const [categoryFilter, setCategoryFilter] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 50;

  // AI 出题弹窗
  const [showAI, setShowAI] = useState(false);
  // AI 能力探测（按钮随服务端 LLM 配置置灰）
  const [aiEnabled, setAiEnabled] = useState(false);
  useEffect(() => {
    api<{ enabled: boolean }>("/ai/status")
      .then((s) => setAiEnabled(s.enabled))
      .catch(() => setAiEnabled(false));
  }, []);

  // 批量导入弹窗（文件/结果等状态在 ImportQuestionsModal 内部）
  const [showImport, setShowImport] = useState(false);

  // 表单状态
  const [qType, setQType] = useState("single_choice");
  const [stem, setStem] = useState("");
  const [options, setOptions] = useState<Record<string, string>>({ A: "", B: "", C: "", D: "" });
  const [correctAnswer, setCorrectAnswer] = useState<string>("A");
  const [correctMulti, setCorrectMulti] = useState<string[]>([]);
  const [tfAnswer, setTfAnswer] = useState<boolean>(true);
  const [fillAnswer, setFillAnswer] = useState("");
  const [essayAnswer, setEssayAnswer] = useState("");
  const [keywords, setKeywords] = useState("");
  const [difficulty, setDifficulty] = useState("medium");
  const [categoryId, setCategoryId] = useState("");

  const fetchQuestions = async () => {
    const params = new URLSearchParams();
    if (typeFilter) params.set("type", typeFilter);
    if (diffFilter) params.set("difficulty", diffFilter);
    const effectiveCategoryId = propCategoryId ?? categoryFilter;
    if (effectiveCategoryId) params.set("category_id", effectiveCategoryId);
    if (search) params.set("search", search);
    params.set("page", String(page));
    params.set("page_size", String(pageSize));
    const qs = params.toString();
    const [data, catsData] = await Promise.all([
      api<{ items: QuestionItem[]; total: number; page: number; page_size: number }>(`/questions${qs ? `?${qs}` : ""}`),
      api<FlatCategory[]>("/question-categories/flat"),
    ]);
    setQuestions(data.items);
    setTotal(data.total);
    setFlatCategories(catsData);
    setLoading(false);
  };

  // KPI 题型卡 → 内部筛选（受控方向）
  useEffect(() => {
    if (externalTypeFilter !== undefined && externalTypeFilter !== typeFilter) {
      setTypeFilter(externalTypeFilter);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalTypeFilter]);

  useEffect(() => {
    setPage(1);
  }, [typeFilter, diffFilter, categoryFilter, propCategoryId, search]);

  useEffect(() => {
    fetchQuestions();
  }, [typeFilter, diffFilter, categoryFilter, propCategoryId, page]);

  useEffect(() => {
    if (!search) {
      fetchQuestions();
      return;
    }
    const timer = setTimeout(fetchQuestions, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const resetForm = () => {
    setQType("single_choice");
    setStem("");
    setOptions({ A: "", B: "", C: "", D: "" });
    setCorrectAnswer("A");
    setCorrectMulti([]);
    setTfAnswer(true);
    setFillAnswer("");
    setEssayAnswer("");
    setKeywords("");
    setDifficulty("medium");
    setCategoryId(propCategoryId || "");
  };

  const openCreate = () => {
    setEditingId(null);
    resetForm();
    setShowModal(true);
  };

  const openEdit = (q: QuestionItem) => {
    setEditingId(q.id);
    setQType(q.type);
    setStem(q.stem);
    setDifficulty(q.difficulty);
    setCategoryId((q as any).category_id || "");
    if (q.options) setOptions(q.options);
    if (q.type === "single_choice") {
      setCorrectAnswer((q.answer as Record<string, string>).correct || "A");
    } else if (q.type === "multi_choice") {
      setCorrectMulti((q.answer as Record<string, string[]>).correct || []);
    } else if (q.type === "true_false") {
      setTfAnswer(!!(q.answer as Record<string, boolean>).correct);
    } else if (q.type === "fill_blank") {
      setFillAnswer((q.answer as Record<string, string>).correct || "");
    } else if (q.type === "essay") {
      setEssayAnswer((q.answer as Record<string, string>).reference || "");
      setKeywords((q.keywords || []).join(", "));
    }
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!stem.trim()) return;
    setSaving(true);

    let answer: Record<string, unknown>;
    if (qType === "single_choice") {
      answer = { correct: correctAnswer };
    } else if (qType === "multi_choice") {
      answer = { correct: correctMulti };
    } else if (qType === "true_false") {
      answer = { correct: tfAnswer };
    } else if (qType === "fill_blank") {
      answer = { correct: fillAnswer };
    } else {
      answer = { reference: essayAnswer };
    }

    const body: Record<string, unknown> = {
      type: qType, stem, answer, difficulty,
      category_id: categoryId || null,
    };
    if (qType === "single_choice" || qType === "multi_choice") {
      body.options = options;
    }
    if (qType === "essay") {
      body.keywords = keywords ? keywords.split(/[,，]/).map((k) => k.trim()).filter(Boolean) : null;
    }

    if (editingId) {
      await api(`/questions/${editingId}`, { method: "PUT", body: JSON.stringify(body) });
    } else {
      await api("/questions", { method: "POST", body: JSON.stringify(body) });
    }
    setSaving(false);
    setShowModal(false);
    fetchQuestions();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("确定删除这道试题？")) return;
    try {
      await api(`/questions/${id}`, { method: "DELETE" });
      fetchQuestions();
    } catch (e: any) {
      // 409 表示试题被引用，显示具体引用信息
      alert(e.message || "删除失败");
    }
  };

  const handleClone = async (id: string) => {
    if (!confirm("确定复制这道试题？")) return;
    await api(`/questions/${id}/clone`, { method: "POST" });
    fetchQuestions();
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === questions.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(questions.map((q) => q.id)));
    }
  };

  const handleBatch = async (action: string, value?: string | string[]) => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    if (action === "delete" && !confirm(`确定删除选中的 ${ids.length} 道试题？`)) return;

    const result = await api<{ ok: boolean; deleted?: number; skipped?: number; refs?: Array<{ question_id: string; source_type: string; source_name: string }> }>("/questions/batch", {
      method: "POST",
      body: JSON.stringify({ ids, action, value }),
    });
    if (action === "delete" && result.skipped && result.skipped > 0) {
      alert(`已删除 ${result.deleted} 题，${result.skipped} 题因被试卷引用而跳过`);
    }
    setSelectedIds(new Set());
    fetchQuestions();
  };

  const handleExport = async () => {
    const token = localStorage.getItem("lp_token");
    const exportUrl = propCategoryId
      ? `${BASE}/questions/export?category_id=${propCategoryId}`
      : `${BASE}/questions/export`;
    const res = await fetch(exportUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "questions.xlsx";
    a.click();
    URL.revokeObjectURL(url);
  };

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

  const toggleMulti = (opt: string) => {
    setCorrectMulti((prev) =>
      prev.includes(opt) ? prev.filter((o) => o !== opt) : [...prev, opt]
    );
  };

  useImperativeHandle(ref, () => ({
    openCreate,
    handleExport: handleExport,
    // 弹窗每次打开都重新挂载，文件/结果状态自然清空
    openImport: () => setShowImport(true),
    openAI: () => setShowAI(true),
  }));

  // flex-1/min-h-0 仅在被 QuestionBank 的定高 flex 列挂载时生效；
  // 独立路由 /admin/questions 下父容器无定高，这些类自动退化为普通流式布局
  return (
    <div className="flex flex-col flex-1 min-h-0">

      {/* 批量操作栏 */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 mb-3 px-4 py-2 bg-primary/5 rounded-lg text-sm">
          <span className="text-text-secondary">已选 {selectedIds.size} 题</span>
          <button onClick={() => {
            const value = prompt("新难度 (easy / medium / hard):");
            if (value) handleBatch("update_difficulty", value);
          }} className="k-link">批量改难度</button>
                    <button onClick={() => handleBatch("delete")} className="k-link k-link-danger">批量删除</button>
          <button onClick={() => setSelectedIds(new Set())} className="k-link ml-auto">取消选择</button>
        </div>
      )}

      {/* 筛选栏：可输入下拉 + 级联分类 + 题干搜索 + 页面操作按钮组 */}
      <div className="k-filter-bar mb-4 shrink-0">
        {!propCategoryId && (
          <CategoryCascadeSelect
            value={categoryFilter}
            onChange={(v) => { setCategoryFilter(v); setLoading(true); }}
            categories={flatCategories}
            className="w-40"
          />
        )}
        <ComboSelect
          value={typeFilter}
          onChange={(v) => { setTypeFilter(v); onTypeFilterChange?.(v); setLoading(true); }}
          options={TYPE_OPTIONS}
          placeholder="全部题型"
          className="w-32"
        />
        <ComboSelect
          value={diffFilter}
          onChange={(v) => { setDiffFilter(v); setLoading(true); }}
          options={DIFFICULTY_OPTIONS}
          placeholder="全部难度"
          className="w-28"
        />
        {/* 搜索框弹性伸展占满剩余空间，按钮组紧随其右；窄屏时整组一起换行 */}
        <div className="k-search flex-1 min-w-40">
          <Search size={14} />
          <input
            type="text" placeholder="搜索题干..."
            value={search} onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={handleExport} className="k-btn k-btn-default k-btn-sm">导出</button>
          <button onClick={() => setShowImport(true)} className="k-btn k-btn-default k-btn-sm">批量导入</button>
          <button
            onClick={() => aiEnabled && setShowAI(true)}
            disabled={!aiEnabled}
            title={aiEnabled ? "按主题关键词 AI 生成题目草稿，人工审核后入库" : "AI 功能未启用：服务端未配置 LLM_API_KEY"}
            className="k-btn k-btn-default k-btn-sm"
          >AI 出题</button>
          <button onClick={openCreate} className="k-btn k-btn-primary k-btn-sm">新增试题</button>
        </div>
      </div>

      {/* 列表 */}
      {loading ? (
        <p className="k-empty">加载中...</p>
      ) : questions.length === 0 ? (
        <div className="k-card k-empty">
          暂无试题，点击筛选栏右侧「新增试题」
        </div>
      ) : (
        <div className="k-table-wrap overflow-auto flex-1 min-h-0">
          <table className="k-table table-fixed k-table-sticky">
            {/* 表头吸顶由表格挂 k-table-sticky 提供（外层 .k-table-wrap 为滚动容器） */}
            <thead>
              <tr>
                <th className="w-8">
                  <input type="checkbox" checked={selectedIds.size === questions.length && questions.length > 0}
                    onChange={toggleSelectAll} />
                </th>
                <th className="text-center w-[26%]">题干</th>
                <th className="text-center w-16">题型</th>
                <th className="text-center w-16">难度</th>
                <th className="text-center w-24">题库分类</th>
                <th className="text-right w-40">操作</th>
              </tr>
            </thead>
            <tbody>
              {questions.map((q) => (
                <tr key={q.id}>
                  <td>
                    <input type="checkbox" checked={selectedIds.has(q.id)} onChange={() => toggleSelect(q.id)} />
                  </td>
                  <td className="truncate text-center">{q.stem}</td>
                  <td className="text-center">
                    <span className="k-tag k-tag-primary">{TYPE_LABELS[q.type]}</span>
                  </td>
                  <td className="text-center">
                    <span className={DIFF_COLORS[q.difficulty]}>{DIFF_LABELS[q.difficulty]}</span>
                  </td>
                  <td className="text-center k-muted">
                    <span className="truncate block">
                      {getCategoryPath((q as any).category_id)}
                    </span>
                  </td>
                  <td className="text-right">
                    <button onClick={() => setPreviewQuestion(q)} className="k-link mr-2">预览</button>
                    <button onClick={() => openEdit(q)} className="k-link mr-2">编辑</button>
                    <button onClick={() => handleClone(q.id)} className="k-link mr-2">复制</button>
                    <button onClick={() => handleDelete(q.id)} className="k-link k-link-danger">删除</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 分页 */}
      {total > 0 && (
        <div className="flex items-center justify-between mt-4 text-sm text-text-meta shrink-0">
          <span>共 {total} 题</span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="k-btn k-btn-default k-btn-sm disabled:opacity-30 disabled:cursor-not-allowed"
            >
              上一页
            </button>
            <span className="px-1">
              {page} / {Math.ceil(total / pageSize)}
            </span>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={page >= Math.ceil(total / pageSize)}
              className="k-btn k-btn-default k-btn-sm disabled:opacity-30 disabled:cursor-not-allowed"
            >
              下一页
            </button>
          </div>
        </div>
      )}

      {/* 批量导入弹窗 */}
      {showImport && (
        <ImportQuestionsModal
          categoryId={propCategoryId}
          onClose={() => setShowImport(false)}
          onDone={fetchQuestions}
        />
      )}

      {/* AI 出题弹窗 */}
      {showAI && (
        <AIGenerateModal
          onClose={() => setShowAI(false)}
          onDone={fetchQuestions}
          defaultCategoryId={propCategoryId}
          categories={flatCategories}
        />
      )}

      {/* 预览弹窗 */}
      {previewQuestion && (
        <div className="k-overlay" onClick={() => setPreviewQuestion(null)}>
          <div className="k-modal max-w-lg k-scroll max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="k-modal-title mb-0!">试题预览</h3>
              <div className="flex items-center gap-2">
                <span className={DIFF_COLORS[previewQuestion.difficulty]}>{DIFF_LABELS[previewQuestion.difficulty]}</span>
                <span className="k-tag k-tag-primary">{TYPE_LABELS[previewQuestion.type]}</span>
              </div>
            </div>

            <div className="space-y-4">
              {/* 题干 */}
              <div>
                <label className="k-label">题干</label>
                <p className="text-sm">{previewQuestion.stem}</p>
              </div>

              {/* 选项 */}
              {previewQuestion.options && Object.keys(previewQuestion.options).length > 0 && (
                <div>
                  <label className="k-label">选项</label>
                  <div className="space-y-1">
                    {Object.entries(previewQuestion.options).map(([key, val]) => (
                      <div key={key} className="flex items-center gap-2 text-sm">
                        <span className="font-medium w-6">{key}.</span>
                        <span>{val}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 正确答案 */}
              <div>
                <label className="k-label">正确答案</label>
                <div className="text-sm text-success font-medium">
                  {previewQuestion.type === "single_choice" && (previewQuestion.answer as Record<string, string>).correct}
                  {previewQuestion.type === "multi_choice" && (previewQuestion.answer as Record<string, string[]>).correct?.join(", ")}
                  {previewQuestion.type === "true_false" && ((previewQuestion.answer as Record<string, boolean>).correct ? "正确" : "错误")}
                  {previewQuestion.type === "fill_blank" && (previewQuestion.answer as Record<string, string>).correct}
                  {previewQuestion.type === "essay" && ((previewQuestion.answer as Record<string, string>).reference || "（无参考答案）")}
                </div>
              </div>

              {/* 关键词 */}
              {previewQuestion.keywords && previewQuestion.keywords.length > 0 && (
                <div>
                  <label className="k-label">关键词</label>
                  <div className="flex flex-wrap gap-1">
                    {previewQuestion.keywords.map((k) => (
                      <span key={k} className="k-tag k-tag-primary">{k}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* 标签 */}
              {((previewQuestion as any).tags as string[])?.length > 0 && (
                <div>
                  <label className="k-label">标签</label>
                  <div className="flex flex-wrap gap-1">
                    {((previewQuestion as any).tags as string[]).map((t: string) => (
                      <span key={t} className="k-tag k-tag-soft">{t}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* 分类 */}
              <div>
                <label className="k-label">题库分类</label>
                <p className="text-sm text-text-secondary">{getCategoryPath((previewQuestion as any).category_id)}</p>
              </div>
            </div>

            <div className="k-modal-actions">
              <button onClick={() => setPreviewQuestion(null)} className="k-btn k-btn-default">
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 新增/编辑弹窗 */}
      {showModal && (
        <div className="k-overlay" onClick={() => setShowModal(false)}>
          <div className="k-modal max-w-lg k-scroll max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="k-modal-title">{editingId ? "编辑试题" : "新增试题"}</h3>

            <div className="space-y-3">
              {/* 题型 */}
              <div>
                <label className="k-label">题型</label>
                <select value={qType} onChange={(e) => setQType(e.target.value)}
                  className="k-select">
                  {TYPE_OPTIONS.filter((t) => t.value).map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>

              {/* 题干 */}
              <div>
                <label className="k-label">题干</label>
                <textarea value={stem} onChange={(e) => setStem(e.target.value)} rows={2}
                  className="k-textarea" />
              </div>

              {/* 选择题选项 */}
              {(qType === "single_choice" || qType === "multi_choice") && (
                <div>
                  <label className="k-label">选项</label>
                  {Object.entries(options).map(([key, val]) => (
                    <div key={key} className="flex items-center gap-2 mb-1.5">
                      <span className="text-sm text-text-secondary w-6">{key}.</span>
                      <input
                        type="text" value={val}
                        onChange={(e) => setOptions((prev) => ({ ...prev, [key]: e.target.value }))}
                        className="k-input flex-1"
                      />
                    </div>
                  ))}
                </div>
              )}

              {/* 单选题答案 */}
              {qType === "single_choice" && (
                <div>
                  <label className="k-label">正确答案</label>
                  <select value={correctAnswer} onChange={(e) => setCorrectAnswer(e.target.value)}
                    className="k-select">
                    {Object.keys(options).map((k) => (
                      <option key={k} value={k}>{k}. {options[k]}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* 多选题答案 */}
              {qType === "multi_choice" && (
                <div>
                  <label className="k-label">正确答案（多选）</label>
                  <div className="flex gap-3">
                    {Object.keys(options).map((k) => (
                      <label key={k} className="flex items-center gap-1 text-sm cursor-pointer">
                        <input type="checkbox" checked={correctMulti.includes(k)} onChange={() => toggleMulti(k)} />
                        {k}
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* 判断题答案 */}
              {qType === "true_false" && (
                <div>
                  <label className="k-label">正确答案</label>
                  <div className="flex gap-3">
                    <label className="flex items-center gap-1 text-sm cursor-pointer">
                      <input type="radio" checked={tfAnswer} onChange={() => setTfAnswer(true)} /> 正确
                    </label>
                    <label className="flex items-center gap-1 text-sm cursor-pointer">
                      <input type="radio" checked={!tfAnswer} onChange={() => setTfAnswer(false)} /> 错误
                    </label>
                  </div>
                </div>
              )}

              {/* 填空题答案 */}
              {qType === "fill_blank" && (
                <div>
                  <label className="k-label">正确答案</label>
                  <input type="text" value={fillAnswer} onChange={(e) => setFillAnswer(e.target.value)}
                    className="k-input" />
                </div>
              )}

              {/* 问答题 */}
              {qType === "essay" && (
                <>
                  <div>
                    <label className="k-label">参考答案</label>
                    <textarea value={essayAnswer} onChange={(e) => setEssayAnswer(e.target.value)} rows={3}
                      className="k-textarea" />
                  </div>
                  <div>
                    <label className="k-label">关键词（逗号分隔，用于自动打分）</label>
                    <input type="text" value={keywords} onChange={(e) => setKeywords(e.target.value)}
                      placeholder="可变, 不可变, 哈希"
                      className="k-input" />
                  </div>
                </>
              )}

              {/* 难度 */}
              <div>
                <label className="k-label">难度</label>
                <select value={difficulty} onChange={(e) => setDifficulty(e.target.value)}
                  className="k-select">
                  {DIFFICULTY_OPTIONS.filter((d) => d.value).map((d) => (
                    <option key={d.value} value={d.value}>{d.label}</option>
                  ))}
                </select>
              </div>

              {/* 题库分类 */}
              {!propCategoryId && (
                <div>
                  <label className="k-label">题库分类</label>
                  <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}
                    className="k-select">
                    <option value="">未分类</option>
                    {flatCategories.map((c) => (
                      <option key={c.id} value={c.id}>{c.parent_id ? "  " : ""}{c.name}</option>
                    ))}
                  </select>
                </div>
              )}

                          </div>

            <div className="k-modal-actions">
              <button onClick={() => setShowModal(false)} className="k-btn k-btn-default">
                取消
              </button>
              <button onClick={handleSave} disabled={saving}
                className="k-btn k-btn-primary disabled:opacity-50">
                {saving ? "保存中..." : "保存"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

export default QuestionManage;