import { useState, useEffect } from "react";
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

export default function QuestionManage({ categoryId: propCategoryId }: { categoryId?: string | null }) {
  const [questions, setQuestions] = useState<QuestionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState("");
  const [diffFilter, setDiffFilter] = useState("");
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [flatCategories, setFlatCategories] = useState<FlatCategory[]>([]);
  const [categoryFilter, setCategoryFilter] = useState("");

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
    const qs = params.toString();
    const [data, catsData] = await Promise.all([
      api<QuestionItem[]>(`/questions${qs ? `?${qs}` : ""}`),
      api<FlatCategory[]>("/question-categories/flat"),
    ]);
    setQuestions(data);
    setFlatCategories(catsData);
    setLoading(false);
  };

  useEffect(() => {
    fetchQuestions();
  }, [typeFilter, diffFilter, categoryFilter, propCategoryId]);

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
    setCategoryId("");
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
      body.keywords = keywords ? keywords.split(",").map((k) => k.trim()).filter(Boolean) : null;
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
    await api(`/questions/${id}`, { method: "DELETE" });
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

    await api("/questions/batch", {
      method: "POST",
      body: JSON.stringify({ ids, action, value }),
    });
    setSelectedIds(new Set());
    fetchQuestions();
  };

  const handleExport = async () => {
    const token = localStorage.getItem("token");
    const res = await fetch("/api/questions/export", {
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

  const handleImport = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".xlsx,.xls";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const formData = new FormData();
      formData.append("file", file);
      const token = localStorage.getItem("token");
      const res = await fetch("/api/questions/import", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const result = await res.json();
      alert(`导入完成: 新增 ${result.created} 道, 跳过 ${result.skipped} 道${result.errors.length ? `, 错误 ${result.errors.length} 条` : ""}`);
      if (result.errors.length > 0) {
        console.log("导入错误:", result.errors);
      }
      fetchQuestions();
    };
    input.click();
  };

  const toggleMulti = (opt: string) => {
    setCorrectMulti((prev) =>
      prev.includes(opt) ? prev.filter((o) => o !== opt) : [...prev, opt]
    );
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex gap-2">
          <button onClick={handleExport} className="px-3 py-2 border border-border rounded-md text-sm hover:bg-bg-layout">导出</button>
          <button onClick={handleImport} className="px-3 py-2 border border-border rounded-md text-sm hover:bg-bg-layout">导入</button>
          <button onClick={openCreate} className="px-4 py-2 bg-primary text-white rounded-md text-sm hover:bg-primary-light">新增试题</button>
        </div>
      </div>

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
                <th className="text-left px-4 py-3 font-medium text-text-secondary">题干</th>
                <th className="text-left px-2 py-3 font-medium text-text-secondary w-14">题型</th>
                <th className="text-left px-2 py-3 font-medium text-text-secondary w-14">难度</th>
                <th className="text-left px-2 py-3 font-medium text-text-secondary w-24">类别</th>
                <th className="text-right px-3 py-3 font-medium text-text-secondary w-20">操作</th>
              </tr>
            </thead>
            <tbody>
              {questions.map((q) => (
                <tr key={q.id} className="border-b border-border last:border-0 hover:bg-bg-layout/50">
                  <td className="px-4 py-3">
                    <input type="checkbox" checked={selectedIds.has(q.id)} onChange={() => toggleSelect(q.id)} />
                  </td>
                  <td className="px-4 py-3 truncate">{q.stem}</td>
                  <td className="px-2 py-3 whitespace-nowrap">
                    <span className="text-xs px-1.5 py-0.5 bg-primary/10 text-primary rounded">{TYPE_LABELS[q.type]}</span>
                  </td>
                  <td className="px-2 py-3 whitespace-nowrap">
                    <span className={`text-xs px-1.5 py-0.5 rounded ${DIFF_COLORS[q.difficulty]}`}>{DIFF_LABELS[q.difficulty]}</span>
                  </td>
                  <td className="px-2 py-3">
                    <span className="text-xs text-text-secondary truncate block">
                      {flatCategories.find((c) => c.id === (q as any).category_id)?.name || "-"}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-right whitespace-nowrap">
                    <button onClick={() => openEdit(q)} className="text-xs text-primary hover:underline mr-2">编辑</button>
                    <button onClick={() => handleDelete(q.id)} className="text-xs text-red-500 hover:underline">删除</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
}