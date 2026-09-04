import { useState, useEffect, forwardRef, useImperativeHandle } from "react";

export interface QuestionManageHandle {
  openCreate: () => void;
  handleExport: () => void;
  openImport: () => void;
}
import { api } from "../../lib/api";

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
  easy: "bg-green-100 text-green-700", medium: "bg-yellow-100 text-yellow-700", hard: "bg-red-100 text-red-700",
};

const QuestionManage = forwardRef<QuestionManageHandle, { categoryId?: string | null }>(function QuestionManage({ categoryId: propCategoryId }, ref) {
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

  // 批量导入弹窗
  const [showImport, setShowImport] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ created: number; skipped: number; errors: string[] } | null>(null);

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
    const token = localStorage.getItem("token");
    const exportUrl = propCategoryId
      ? `/api/questions/export?category_id=${propCategoryId}`
      : "/api/questions/export";
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

  const handleDownloadTemplate = async () => {
    const token = localStorage.getItem("token");
    const res = await fetch("/api/questions/template", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "questions_template.xlsx";
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = async () => {
    if (!importFile) return;
    setImporting(true);
    setImportResult(null);
    const formData = new FormData();
    formData.append("file", importFile);
    if (propCategoryId) formData.append("category_id", propCategoryId);
    const token = localStorage.getItem("token");
    try {
      const res = await fetch("/api/questions/import", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.detail || "导入失败");
      setImportResult(result);
      setImportFile(null);
      fetchQuestions();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setImporting(false);
    }
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

  const toggleMulti = (opt: string) => {
    setCorrectMulti((prev) =>
      prev.includes(opt) ? prev.filter((o) => o !== opt) : [...prev, opt]
    );
  };

  useImperativeHandle(ref, () => ({
    openCreate,
    handleExport: handleExport,
    openImport: () => { setShowImport(true); setImportResult(null); setImportFile(null); },
  }));

  return (
    <div>

      {/* 批量操作栏 */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 mb-3 px-4 py-2 bg-primary/5 border border-primary/20 rounded-md text-sm">
          <span className="text-text-secondary">已选 {selectedIds.size} 题</span>
          <button onClick={() => {
            const value = prompt("新难度 (easy / medium / hard):");
            if (value) handleBatch("update_difficulty", value);
          }} className="text-primary hover:underline">批量改难度</button>
                    <button onClick={() => handleBatch("delete")} className="text-red-500 hover:underline">批量删除</button>
          <button onClick={() => setSelectedIds(new Set())} className="text-text-secondary hover:underline ml-auto">取消选择</button>
        </div>
      )}

      {/* 筛选栏 */}
      <div className="flex gap-3 mb-4">
        {!propCategoryId && (
          <select value={categoryFilter} onChange={(e) => { setCategoryFilter(e.target.value); setLoading(true); }}
            className="border border-border rounded-md px-3 py-1.5 text-sm">
            <option value="">全部分类</option>
            {flatCategories.map((c) => (
              <option key={c.id} value={c.id}>{c.parent_id ? "  " : ""}{c.name}</option>
            ))}
          </select>
        )}
        <select value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setLoading(true); }}
          className="border border-border rounded-md px-3 py-1.5 text-sm">
          {TYPE_OPTIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <select value={diffFilter} onChange={(e) => { setDiffFilter(e.target.value); setLoading(true); }}
          className="border border-border rounded-md px-3 py-1.5 text-sm">
          {DIFFICULTY_OPTIONS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
        </select>
        <input
          type="text" placeholder="搜索题干..."
          value={search} onChange={(e) => setSearch(e.target.value)}
          className="border border-border rounded-md px-3 py-1.5 text-sm flex-1"
        />
      </div>

      {/* 列表 */}
      {loading ? (
        <p className="text-text-secondary">加载中...</p>
      ) : questions.length === 0 ? (
        <div className="bg-bg-base rounded-lg p-12 border border-border text-center text-text-secondary">
          暂无试题，点击右上角新增
        </div>
      ) : (
        <div className="bg-bg-base rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm table-fixed">
            <thead className="bg-bg-layout border-b border-border">
              <tr>
                <th className="px-4 py-3 w-8">
                  <input type="checkbox" checked={selectedIds.size === questions.length && questions.length > 0}
                    onChange={toggleSelectAll} />
                </th>
                <th className="text-center px-4 py-3 font-medium text-text-secondary w-[26%]">题干</th>
                <th className="text-center px-2 py-3 font-medium text-text-secondary w-16">题型</th>
                <th className="text-center px-2 py-3 font-medium text-text-secondary w-16">难度</th>
                <th className="text-center px-2 py-3 font-medium text-text-secondary w-24">题库分类</th>
                <th className="text-right px-3 py-3 font-medium text-text-secondary w-40">操作</th>
              </tr>
            </thead>
            <tbody>
              {questions.map((q) => (
                <tr key={q.id} className="border-b border-border last:border-0 hover:bg-bg-layout/50">
                  <td className="px-4 py-3">
                    <input type="checkbox" checked={selectedIds.has(q.id)} onChange={() => toggleSelect(q.id)} />
                  </td>
                  <td className="px-4 py-3 truncate text-center">{q.stem}</td>
                  <td className="px-2 py-3 whitespace-nowrap text-center">
                    <span className="text-xs px-1.5 py-0.5 bg-primary/10 text-primary rounded">{TYPE_LABELS[q.type]}</span>
                  </td>
                  <td className="px-2 py-3 whitespace-nowrap text-center">
                    <span className={`text-xs px-1.5 py-0.5 rounded ${DIFF_COLORS[q.difficulty]}`}>{DIFF_LABELS[q.difficulty]}</span>
                  </td>
                  <td className="px-2 py-3 text-center">
                    <span className="text-xs text-text-secondary truncate block">
                      {getCategoryPath((q as any).category_id)}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-right whitespace-nowrap">
                    <button onClick={() => setPreviewQuestion(q)} className="text-xs text-text-secondary hover:underline mr-2">预览</button>
                    <button onClick={() => openEdit(q)} className="text-xs text-primary hover:underline mr-2">编辑</button>
                    <button onClick={() => handleClone(q.id)} className="text-xs text-primary hover:underline mr-2">复制</button>
                    <button onClick={() => handleDelete(q.id)} className="text-xs text-red-500 hover:underline">删除</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 分页 */}
      {total > 0 && (
        <div className="flex items-center justify-between mt-4 text-sm text-text-secondary">
          <span>共 {total} 题</span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="px-3 py-1 border border-border rounded-md hover:bg-bg-layout disabled:opacity-40 disabled:cursor-not-allowed"
            >
              上一页
            </button>
            <span className="px-2">
              {page} / {Math.ceil(total / pageSize)}
            </span>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={page >= Math.ceil(total / pageSize)}
              className="px-3 py-1 border border-border rounded-md hover:bg-bg-layout disabled:opacity-40 disabled:cursor-not-allowed"
            >
              下一页
            </button>
          </div>
        </div>
      )}

      {/* 批量导入弹窗 */}
      {showImport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setShowImport(false)}>
          <div className="bg-bg-base rounded-lg shadow-xl w-full max-w-lg" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <h3 className="font-bold text-base">批量导入试题</h3>
              <button onClick={() => setShowImport(false)} className="text-text-secondary hover:text-text-base text-xl leading-none">&times;</button>
            </div>
            <div className="p-6 space-y-6">
              {/* 步骤 1: 下载模板 */}
              <div className="flex items-start gap-3">
                <span className="w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">1</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium mb-1">下载模板</p>
                  <p className="text-xs text-text-secondary mb-2">按模板格式填写试题信息</p>
                  <button
                    onClick={handleDownloadTemplate}
                    className="inline-flex items-center gap-1.5 text-xs text-primary border border-primary/30 rounded-md px-3 py-1.5 hover:bg-primary/5 transition-colors"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                    下载导入模板
                  </button>
                  {propCategoryId && (
                    <p className="text-xs text-text-secondary mt-2">
                      导入试题将自动归属到当前选中的题库
                    </p>
                  )}
                </div>
              </div>

              {/* 步骤 2: 上传文件 */}
              <div className="flex items-start gap-3">
                <span className="w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">2</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium mb-1">上传 Excel 文件</p>
                  <label className={`block border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors ${
                    importFile ? "border-primary/40 bg-primary/5" : "border-border hover:border-text-secondary/30"
                  }`}>
                    <input
                      type="file"
                      accept=".xlsx,.xls"
                      onChange={e => setImportFile(e.target.files?.[0] || null)}
                      className="hidden"
                    />
                    {importFile ? (
                      <div className="flex items-center gap-2 justify-center">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-600"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                        <span className="text-sm font-medium text-text-base">{importFile.name}</span>
                        <button onClick={(e) => { e.stopPropagation(); setImportFile(null); }} className="text-xs text-red-500 hover:underline ml-1">移除</button>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-1">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-text-secondary"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                        <span className="text-sm text-text-secondary">点击选择文件或拖拽到此区域</span>
                        <span className="text-xs text-text-secondary">仅支持 .xlsx / .xls 格式</span>
                      </div>
                    )}
                  </label>
                </div>
              </div>

              {/* 导入结果 */}
              {importResult && (
                <div className={`rounded-lg border p-4 text-sm ${
                  importResult.errors.length > 0 ? "border-yellow-200 bg-yellow-50" : "border-emerald-200 bg-emerald-50"
                }`}>
                  <div className="flex items-center gap-2 mb-2">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={importResult.errors.length > 0 ? "text-yellow-600" : "text-emerald-600"}>
                      {importResult.errors.length > 0
                        ? <><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></>
                        : <><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></>
                      }
                    </svg>
                    <span className={`font-medium ${importResult.errors.length > 0 ? "text-yellow-800" : "text-emerald-800"}`}>
                      导入完成
                    </span>
                  </div>
                  <div className="flex gap-4 text-xs">
                    <span className="text-text-secondary">新增 <span className="text-emerald-600 font-bold">{importResult.created}</span> 道</span>
                    <span className="text-text-secondary">跳过 <span className="text-text-secondary font-bold">{importResult.skipped}</span> 道</span>
                  </div>
                  {importResult.errors.length > 0 && (
                    <div className="mt-2 max-h-28 overflow-y-auto space-y-0.5">
                      {importResult.errors.map((err, i) => (
                        <p key={i} className="text-red-500 text-xs">{err}</p>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border bg-bg-layout/50">
              <button
                onClick={() => setShowImport(false)}
                className="px-4 py-2 rounded-md text-sm border border-border text-text-secondary hover:text-text-base hover:bg-bg-base transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleImport}
                disabled={!importFile || importing}
                className="px-5 py-2 rounded-md text-sm bg-primary text-white hover:bg-primary-light disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
              >
                {importing ? (
                  <>
                    <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" strokeDasharray="31.4 31.4" strokeLinecap="round"/></svg>
                    导入中...
                  </>
                ) : (
                  "开始导入"
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 预览弹窗 */}
      {previewQuestion && (
        <div className="fixed inset-0 bg-black/30 flex items-start justify-center pt-20 z-50" onClick={() => setPreviewQuestion(null)}>
          <div className="bg-bg-base rounded-lg shadow-xl p-6 w-full max-w-lg max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-lg">试题预览</h3>
              <div className="flex items-center gap-2">
                <span className={`text-xs px-2 py-0.5 rounded ${DIFF_COLORS[previewQuestion.difficulty]}`}>{DIFF_LABELS[previewQuestion.difficulty]}</span>
                <span className="text-xs px-2 py-0.5 bg-primary/10 text-primary rounded">{TYPE_LABELS[previewQuestion.type]}</span>
              </div>
            </div>

            <div className="space-y-4">
              {/* 题干 */}
              <div>
                <label className="block text-xs text-text-secondary mb-1">题干</label>
                <p className="text-sm">{previewQuestion.stem}</p>
              </div>

              {/* 选项 */}
              {previewQuestion.options && Object.keys(previewQuestion.options).length > 0 && (
                <div>
                  <label className="block text-xs text-text-secondary mb-1">选项</label>
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
                <label className="block text-xs text-text-secondary mb-1">正确答案</label>
                <div className="text-sm text-green-700 font-medium">
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
                  <label className="block text-xs text-text-secondary mb-1">关键词</label>
                  <div className="flex flex-wrap gap-1">
                    {previewQuestion.keywords.map((k) => (
                      <span key={k} className="text-xs px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded">{k}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* 标签 */}
              {((previewQuestion as any).tags as string[])?.length > 0 && (
                <div>
                  <label className="block text-xs text-text-secondary mb-1">标签</label>
                  <div className="flex flex-wrap gap-1">
                    {((previewQuestion as any).tags as string[]).map((t: string) => (
                      <span key={t} className="text-xs px-1.5 py-0.5 bg-bg-layout border border-border rounded">{t}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* 分类 */}
              <div>
                <label className="block text-xs text-text-secondary mb-1">题库分类</label>
                <p className="text-sm text-text-secondary">{getCategoryPath((previewQuestion as any).category_id)}</p>
              </div>
            </div>

            <div className="flex justify-end mt-6">
              <button onClick={() => setPreviewQuestion(null)} className="px-4 py-2 rounded-md text-sm border border-border hover:bg-bg-layout">
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 新增/编辑弹窗 */}
      {showModal && (
        <div className="fixed inset-0 bg-black/30 flex items-start justify-center pt-20 z-50" onClick={() => setShowModal(false)}>
          <div className="bg-bg-base rounded-lg shadow-xl p-6 w-full max-w-lg max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-lg mb-4">{editingId ? "编辑试题" : "新增试题"}</h3>

            <div className="space-y-3">
              {/* 题型 */}
              <div>
                <label className="block text-sm text-text-secondary mb-1">题型</label>
                <select value={qType} onChange={(e) => setQType(e.target.value)}
                  className="w-full border border-border rounded-md px-3 py-2 text-sm">
                  {TYPE_OPTIONS.filter((t) => t.value).map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>

              {/* 题干 */}
              <div>
                <label className="block text-sm text-text-secondary mb-1">题干</label>
                <textarea value={stem} onChange={(e) => setStem(e.target.value)} rows={2}
                  className="w-full border border-border rounded-md px-3 py-2 text-sm" />
              </div>

              {/* 选择题选项 */}
              {(qType === "single_choice" || qType === "multi_choice") && (
                <div>
                  <label className="block text-sm text-text-secondary mb-1">选项</label>
                  {Object.entries(options).map(([key, val]) => (
                    <div key={key} className="flex items-center gap-2 mb-1.5">
                      <span className="text-sm text-text-secondary w-6">{key}.</span>
                      <input
                        type="text" value={val}
                        onChange={(e) => setOptions((prev) => ({ ...prev, [key]: e.target.value }))}
                        className="flex-1 border border-border rounded-md px-2 py-1 text-sm"
                      />
                    </div>
                  ))}
                </div>
              )}

              {/* 单选题答案 */}
              {qType === "single_choice" && (
                <div>
                  <label className="block text-sm text-text-secondary mb-1">正确答案</label>
                  <select value={correctAnswer} onChange={(e) => setCorrectAnswer(e.target.value)}
                    className="w-full border border-border rounded-md px-3 py-2 text-sm">
                    {Object.keys(options).map((k) => (
                      <option key={k} value={k}>{k}. {options[k]}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* 多选题答案 */}
              {qType === "multi_choice" && (
                <div>
                  <label className="block text-sm text-text-secondary mb-1">正确答案（多选）</label>
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
                  <label className="block text-sm text-text-secondary mb-1">正确答案</label>
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
                  <label className="block text-sm text-text-secondary mb-1">正确答案</label>
                  <input type="text" value={fillAnswer} onChange={(e) => setFillAnswer(e.target.value)}
                    className="w-full border border-border rounded-md px-3 py-2 text-sm" />
                </div>
              )}

              {/* 问答题 */}
              {qType === "essay" && (
                <>
                  <div>
                    <label className="block text-sm text-text-secondary mb-1">参考答案</label>
                    <textarea value={essayAnswer} onChange={(e) => setEssayAnswer(e.target.value)} rows={3}
                      className="w-full border border-border rounded-md px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="block text-sm text-text-secondary mb-1">关键词（逗号分隔，用于自动打分）</label>
                    <input type="text" value={keywords} onChange={(e) => setKeywords(e.target.value)}
                      placeholder="可变, 不可变, 哈希"
                      className="w-full border border-border rounded-md px-3 py-2 text-sm" />
                  </div>
                </>
              )}

              {/* 难度 */}
              <div>
                <label className="block text-sm text-text-secondary mb-1">难度</label>
                <select value={difficulty} onChange={(e) => setDifficulty(e.target.value)}
                  className="w-full border border-border rounded-md px-3 py-2 text-sm">
                  {DIFFICULTY_OPTIONS.filter((d) => d.value).map((d) => (
                    <option key={d.value} value={d.value}>{d.label}</option>
                  ))}
                </select>
              </div>

              {/* 题库分类 */}
              {!propCategoryId && (
                <div>
                  <label className="block text-sm text-text-secondary mb-1">题库分类</label>
                  <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}
                    className="w-full border border-border rounded-md px-3 py-2 text-sm">
                    <option value="">未分类</option>
                    {flatCategories.map((c) => (
                      <option key={c.id} value={c.id}>{c.parent_id ? "  " : ""}{c.name}</option>
                    ))}
                  </select>
                </div>
              )}

                          </div>

            <div className="flex gap-3 justify-end mt-6">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 rounded-md text-sm border border-border hover:bg-bg-layout">
                取消
              </button>
              <button onClick={handleSave} disabled={saving}
                className="px-4 py-2 rounded-md text-sm bg-primary text-white hover:bg-primary-light disabled:opacity-50">
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