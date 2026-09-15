import { useState, useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";
import CourseTree, { type TreeNode, type FlatCategory, getCategoryPath, buildDescendantMap } from "../../components/CourseTree";
import { Search } from "lucide-react";

interface ExamItem {
  id: string; course_id: string; title: string; paper_type: string;
  paper_id: string | null;
  duration: number; total_score: number; pass_score: number;
  max_attempts: number | null; start_time: string | null; end_time: string | null;
  status: string; created_at: string;
}
interface CourseItem {
  id: string; title: string; category_id: string | null;
}
interface PaperItem {
  id: string; title: string; category_id: string | null; paper_type: string;
  total_score: number; status: string;
}

const STATUS_LABELS: Record<string, string> = { draft: "草稿", published: "已发布", ended: "已结束" };
const STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-100 text-gray-600", published: "bg-emerald-50 text-emerald-700",
  ended: "bg-red-100 text-red-700",
};
const PAPER_TYPE_LABELS: Record<string, string> = { fixed: "固定", random: "随机" };

export default function ExamManage() {
  const [exams, setExams] = useState<ExamItem[]>([]);
  const [courses, setCourses] = useState<CourseItem[]>([]);
  const [papers, setPapers] = useState<PaperItem[]>([]);
  const [flatCategories, setFlatCategories] = useState<FlatCategory[]>([]);
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // 树状态
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);

  // 新增考试：选中的试卷
  const [modalCategoryId, setModalCategoryId] = useState<string | null>(null);
  const [selectedPaperId, setSelectedPaperId] = useState("");
  const [paperSearch, setPaperSearch] = useState("");

  // 考试配置
  const [duration, setDuration] = useState(60);
  const [passScore, setPassScore] = useState(60);

  // 编辑考试
  const [editTitle, setEditTitle] = useState("");
  const [editDuration, setEditDuration] = useState(60);
  const [editPassScore, setEditPassScore] = useState(60);
  const [editMaxAttempts, setEditMaxAttempts] = useState("");
  const [editStatus, setEditStatus] = useState("");

  const fetchData = async () => {
    const [examsData, coursesData, papersData, catsData, treeData] = await Promise.all([
      api<ExamItem[]>("/exams"),
      api<CourseItem[]>("/courses"),
      api<PaperItem[]>("/papers/published"),
      api<FlatCategory[]>("/question-categories/flat"),
      api<TreeNode[]>("/question-categories/tree"),
    ]);
    setExams(examsData);
    setCourses(coursesData);
    setPapers(papersData);
    setFlatCategories(catsData);
    setTree(treeData);
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  // 构建 category 后代映射
  const categoryDescendants = useMemo(() => buildDescendantMap(flatCategories), [flatCategories]);

  // 主页面：根据分类筛选考试
  const filteredExams = useMemo(() => {
    if (!selectedCategoryId) return exams;
    const descendantIds = categoryDescendants.get(selectedCategoryId);
    if (!descendantIds) return [];
    const courseIds = new Set(
      courses.filter((c) => c.category_id && descendantIds.has(c.category_id)).map((c) => c.id)
    );
    return exams.filter((e) => courseIds.has(e.course_id));
  }, [selectedCategoryId, exams, courses, categoryDescendants]);

  // 弹窗：根据选中的分类筛选试卷
  const filteredPapers = useMemo(() => {
    if (!modalCategoryId) return [];
    const descendantIds = categoryDescendants.get(modalCategoryId);
    if (!descendantIds) return [];
    let result = papers.filter((p) => p.category_id && descendantIds.has(p.category_id));
    if (paperSearch) {
      const lower = paperSearch.toLowerCase();
      result = result.filter((p) => p.title.toLowerCase().includes(lower));
    }
    return result;
  }, [modalCategoryId, papers, categoryDescendants, paperSearch]);

  // 弹窗：根据选中的分类找到对应的课程
  const matchedCourses = useMemo(() => {
    if (!modalCategoryId) return [];
    const descendantIds = categoryDescendants.get(modalCategoryId);
    if (!descendantIds) return [];
    return courses.filter((c) => c.category_id && descendantIds.has(c.category_id));
  }, [modalCategoryId, courses, categoryDescendants]);

  const [selectedCourseId, setSelectedCourseId] = useState("");

  const selectedPaper = useMemo(() => {
    return papers.find((p) => p.id === selectedPaperId) || null;
  }, [papers, selectedPaperId]);

  const createCourseId = useMemo(() => {
    return selectedCourseId || (matchedCourses.length === 1 ? matchedCourses[0].id : "");
  }, [selectedCourseId, matchedCourses]);

  const resetModalForm = () => {
    setModalCategoryId(null);
    setSelectedPaperId("");
    setSelectedCourseId("");
    setPaperSearch("");
    setDuration(60);
    setPassScore(60);
  };

  const openCreate = () => {
    setEditingId(null);
    resetModalForm();
    setShowModal(true);
  };

  const openEdit = (e: ExamItem) => {
    setEditingId(e.id);
    setEditTitle(e.title);
    setEditDuration(e.duration);
    setEditPassScore(e.pass_score);
    setEditMaxAttempts(e.max_attempts?.toString() || "");
    setEditStatus(e.status);
    setShowModal(true);
  };

  const handleEditSave = async () => {
    if (!editingId || !editTitle.trim()) return;
    setSaving(true);
    try {
      await api(`/exams/${editingId}`, {
        method: "PUT",
        body: JSON.stringify({
          title: editTitle,
          duration: editDuration,
          pass_score: editPassScore,
          max_attempts: editMaxAttempts ? parseInt(editMaxAttempts) : null,
          status: editStatus,
        }),
      });
      setShowModal(false);
      fetchData();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "未知错误";
      alert(`保存失败：${msg}`);
    } finally {
      setSaving(false);
    }
  };

  const handlePublish = async (id: string) => {
    if (!confirm("发布后考试将对学员开放，确定？")) return;
    try {
      await api(`/exams/${id}`, {
        method: "PUT",
        body: JSON.stringify({ status: "published" }),
      });
      fetchData();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "未知错误";
      alert(`发布失败：${msg}`);
    }
  };

  const handleCreate = async () => {
    const courseId = createCourseId;
    if (!modalCategoryId) { alert("请先选择课程分类"); return; }
    if (!selectedPaperId) { alert("请先选择试卷"); return; }
    if (!courseId) {
      if (matchedCourses.length === 0) {
        alert("所选分类下没有关联课程，无法创建考试");
      } else {
        alert("请选择关联课程");
      }
      return;
    }
    const paper = selectedPaper;
    if (!paper) { alert("试卷信息加载失败，请重新选择"); return; }

    setSaving(true);
    try {
      await api("/exams", {
        method: "POST",
        body: JSON.stringify({
          title: paper.title,
          course_id: courseId,
          paper_type: paper.paper_type,
          paper_id: paper.id,
          duration,
          total_score: paper.total_score,
          pass_score: passScore,
        }),
      });
      setShowModal(false);
      fetchData();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "未知错误";
      alert(`创建失败：${msg}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("确定删除此考试？")) return;
    try {
      await api(`/exams/${id}`, { method: "DELETE" });
      fetchData();
    } catch (e: any) {
      alert(e.message || "删除失败");
    }
  };

  // 匹配到唯一课程时自动选中
  useEffect(() => {
    if (matchedCourses.length === 1) {
      setSelectedCourseId(matchedCourses[0].id);
    }
  }, [matchedCourses]);

  if (loading) return <p className="text-text-secondary">加载中...</p>;

  return (
    <div>
      <h2 className="text-xl font-bold text-primary mb-4 pb-3 border-b border-border">考试管理</h2>

      <div className="flex gap-4 min-h-[calc(100vh-180px)]">
        {/* 左侧分类树 */}
        <div className="w-56 shrink-0 pr-4 border-r border-border">
          <CourseTree
            tree={tree}
            flatCategories={flatCategories}
            selectedId={selectedCategoryId}
            onSelect={setSelectedCategoryId}
            rootLabel="全部考试"
            placeholder="搜索课程..."
            loading={loading}
            emptyText="暂无课程"
            clearFilterText="清除筛选"
            treeContainerClass="max-h-[calc(100vh-220px)]"
          />
        </div>

        {/* 右侧考试列表 */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm text-text-secondary">
              {selectedCategoryId ? getCategoryPath(selectedCategoryId, flatCategories) : "全部考试"}
            </span>
            <button onClick={openCreate} className="px-4 py-2 bg-primary text-white rounded-md text-sm hover:bg-primary-light">
              新增考试
            </button>
          </div>

          {filteredExams.length === 0 ? (
            <div className="bg-bg-base rounded-lg p-12 border border-border text-center text-text-secondary">
              暂无考试
            </div>
          ) : (
            <div className="bg-bg-base rounded-lg border border-border overflow-hidden">
              <table className="w-full text-sm table-fixed">
                <thead className="bg-bg-layout border-b border-border">
                  <tr>
                    <th className="text-center px-4 py-3 font-medium text-text-secondary">考试名称</th>
                    <th className="text-center px-3 py-3 font-medium text-text-secondary w-20">组卷</th>
                    <th className="text-center px-3 py-3 font-medium text-text-secondary w-28">时长/分数</th>
                    <th className="text-center px-3 py-3 font-medium text-text-secondary w-20">状态</th>
                    <th className="text-center px-3 py-3 font-medium text-text-secondary w-64">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredExams.map((e) => (
                    <tr key={e.id} className="border-b border-border last:border-0 hover:bg-bg-layout/50">
                      <td className="px-4 py-3 font-medium truncate text-center">{e.title}</td>
                      <td className="px-3 py-3 text-text-secondary whitespace-nowrap text-center">{e.paper_type === "fixed" ? "固定" : "随机"}</td>
                      <td className="px-3 py-3 text-text-secondary whitespace-nowrap text-center">{e.duration}分钟 / {e.total_score}分</td>
                      <td className="px-3 py-3 whitespace-nowrap text-center">
                        <span className={`text-xs px-1.5 py-0.5 rounded ${STATUS_COLORS[e.status]}`}>{STATUS_LABELS[e.status]}</span>
                      </td>
                      <td className="px-3 py-3 text-center whitespace-nowrap">
                        {e.status === "draft" && (
                          <button onClick={() => handlePublish(e.id)} className="text-xs text-primary border border-primary rounded px-1.5 py-0.5 hover:bg-primary/5 mr-1">发布</button>
                        )}
                        <Link to={`/admin/exams/${e.id}/paper`} className="text-xs text-primary border border-primary rounded px-1.5 py-0.5 hover:bg-primary/5 mr-1">查看组卷</Link>
                        <button onClick={() => openEdit(e)} className="text-xs text-primary border border-primary rounded px-1.5 py-0.5 hover:bg-primary/5 mr-1">编辑</button>
                        <button onClick={() => handleDelete(e.id)} className="text-xs text-red-500 border border-red-200 rounded px-1.5 py-0.5 hover:bg-red-50">删除</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* 新增考试弹窗 */}
      {showModal && !editingId && (
        <div className="fixed inset-0 bg-black/30 flex items-start justify-center pt-20 z-50" onClick={() => setShowModal(false)}>
          <div className="bg-bg-base rounded-lg shadow-xl w-full max-w-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <h3 className="font-bold text-lg">新增考试</h3>
              <button onClick={() => setShowModal(false)} className="text-text-secondary hover:text-text-base text-xl leading-none">&times;</button>
            </div>

            <div className="flex" style={{ height: "420px" }}>
              <div className="w-48 shrink-0 border-r border-border flex flex-col">
                <CourseTree
                  tree={tree}
                  flatCategories={flatCategories}
                  selectedId={modalCategoryId}
                  onSelect={(id) => {
                    if (id !== null) {
                      setModalCategoryId(id);
                      setSelectedPaperId("");
                      setSelectedCourseId("");
                      const node = tree.find(n => n.id === id);
                      if (node && node.children.length > 0) {
                        // 展开/折叠由 CourseTree 内部管理
                      }
                    }
                  }}
                  rootLabel="全部考试"
                  showHeader={false}
                  showSearch={false}
                  emptyText="暂无课程"
                  treeContainerClass="flex-1"
                  loading={loading}
                />
              </div>

              <div className="flex-1 flex flex-col min-w-0">
                <div className="px-4 pt-3 pb-2 space-y-2">
                  {modalCategoryId && <p className="text-xs text-text-secondary">{getCategoryPath(modalCategoryId, flatCategories)}</p>}
                  {modalCategoryId && matchedCourses.length === 1 && (
                    <p className="text-xs text-text-secondary">关联课程: {matchedCourses[0].title}</p>
                  )}
                  {modalCategoryId && matchedCourses.length > 1 && (
                    <select value={selectedCourseId} onChange={(e) => setSelectedCourseId(e.target.value)}
                      className="w-full border border-border rounded-md px-2 py-1 text-xs">
                      <option value="">选择课程</option>
                      {matchedCourses.map((c) => (
                        <option key={c.id} value={c.id}>{c.title}</option>
                      ))}
                    </select>
                  )}
                  <div className="relative">
                    <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-secondary" />
                    <input type="text" placeholder="搜索试卷..." value={paperSearch} onChange={(e) => setPaperSearch(e.target.value)}
                      className="w-full border border-border rounded-md pl-7 pr-3 py-1.5 text-sm" />
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto px-4">
                  {!modalCategoryId ? (
                    <p className="text-sm text-text-secondary text-center mt-12">请在左侧选择课程分类</p>
                  ) : filteredPapers.length === 0 ? (
                    <p className="text-sm text-text-secondary text-center mt-12">
                      {paperSearch ? "无匹配试卷" : "该分类下暂无已发布试卷"}
                    </p>
                  ) : (
                    <div className="space-y-1">
                      {filteredPapers.map((p) => (
                        <label key={p.id}
                          className={`flex items-center gap-3 px-3 py-2.5 rounded-md cursor-pointer border transition-colors ${
                            selectedPaperId === p.id ? "border-primary bg-primary/5" : "border-transparent hover:bg-bg-layout"
                          }`}
                        >
                          <input type="radio" name="paper" checked={selectedPaperId === p.id}
                            onChange={() => setSelectedPaperId(p.id)} className="shrink-0" />
                          <div className="flex-1 min-w-0"><p className="text-sm font-medium truncate">{p.title}</p></div>
                          <span className="text-xs text-text-secondary shrink-0">{PAPER_TYPE_LABELS[p.paper_type] || "固定"}</span>
                          <span className="text-xs text-text-secondary shrink-0 w-12 text-right">{p.total_score}分</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>

                {selectedPaperId && (
                  <div className="border-t border-border px-4 py-3 bg-bg-layout/50">
                    <p className="text-xs text-text-secondary mb-2">考试配置</p>
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-2">
                        <label className="text-xs text-text-secondary">考试时长</label>
                        <input type="number" value={duration || ""} onChange={(e) => setDuration(parseInt(e.target.value) || 0)}
                          className="w-16 border border-border rounded-md px-2 py-1 text-sm text-right" min={1} />
                        <span className="text-xs text-text-secondary">分钟</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <label className="text-xs text-text-secondary">及格分数</label>
                        <input type="number" value={passScore || ""} onChange={(e) => setPassScore(parseInt(e.target.value) || 0)}
                          className="w-16 border border-border rounded-md px-2 py-1 text-sm text-right" min={1} />
                        <span className="text-xs text-text-secondary">分</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="flex gap-3 justify-end px-6 py-3 border-t border-border">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 rounded-md text-sm border border-border hover:bg-bg-layout">取消</button>
              <button onClick={handleCreate} disabled={saving || !selectedPaperId || !createCourseId}
                className="px-4 py-2 rounded-md text-sm bg-primary text-white hover:bg-primary-light disabled:opacity-50">
                {saving ? "创建中..." : "创建考试"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 编辑考试弹窗 */}
      {showModal && editingId && (
        <div className="fixed inset-0 bg-black/30 flex items-start justify-center pt-20 z-50" onClick={() => setShowModal(false)}>
          <div className="bg-bg-base rounded-lg shadow-xl p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-lg mb-4">编辑考试</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-sm text-text-secondary mb-1">考试名称</label>
                <input type="text" value={editTitle} onChange={(e) => setEditTitle(e.target.value)}
                  className="w-full border border-border rounded-md px-3 py-2 text-sm" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-text-secondary mb-1">时长(分钟)</label>
                  <input type="number" value={editDuration || ""} onChange={(e) => setEditDuration(parseInt(e.target.value) || 0)}
                    className="w-full border border-border rounded-md px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-sm text-text-secondary mb-1">及格分</label>
                  <input type="number" value={editPassScore || ""} onChange={(e) => setEditPassScore(parseInt(e.target.value) || 0)}
                    className="w-full border border-border rounded-md px-3 py-2 text-sm" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-text-secondary mb-1">最大重考次数</label>
                  <input type="number" value={editMaxAttempts} onChange={(e) => setEditMaxAttempts(e.target.value)}
                    placeholder="不限" className="w-full border border-border rounded-md px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-sm text-text-secondary mb-1">状态</label>
                  <select value={editStatus} onChange={(e) => setEditStatus(e.target.value)}
                    className="w-full border border-border rounded-md px-3 py-2 text-sm">
                    <option value="draft">草稿</option>
                    <option value="published">已发布</option>
                    <option value="ended">已结束</option>
                  </select>
                </div>
              </div>
            </div>
            <div className="flex gap-3 justify-end mt-6">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 rounded-md text-sm border border-border hover:bg-bg-layout">取消</button>
              <button onClick={handleEditSave} disabled={saving}
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