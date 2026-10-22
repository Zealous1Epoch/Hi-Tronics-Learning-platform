import { useState, useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";
import CourseTree, { type TreeNode, type FlatCategory, getCategoryPath, buildDescendantMap } from "../../components/CourseTree";
import ExamQuickCreate from "./ExamQuickCreate";

interface ExamItem {
  id: string; course_id: string; title: string; paper_type: string;
  paper_id: string | null;
  duration: number; total_score: number; pass_score: number;
  max_attempts: number | null; start_time: string | null; end_time: string | null;
  status: string; created_at: string;
  // 列表接口附带的聚合统计
  assigned_count: number | null; submitted_user_count: number | null;
}
interface CourseItem {
  id: string; title: string; category_id: string | null;
}

const STATUS_LABELS: Record<string, string> = { draft: "草稿", published: "已发布", ended: "已结束" };
const STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-100 text-gray-600", published: "bg-emerald-50 text-emerald-700",
  ended: "bg-red-100 text-red-700",
};

export default function ExamManage() {
  const [exams, setExams] = useState<ExamItem[]>([]);
  const [courses, setCourses] = useState<CourseItem[]>([]);
  const [flatCategories, setFlatCategories] = useState<FlatCategory[]>([]);
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [loading, setLoading] = useState(true);
  // 一键建考向导
  const [showWizard, setShowWizard] = useState(false);
  // 编辑弹窗
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // 树状态
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);

  // 编辑考试
  const [editTitle, setEditTitle] = useState("");
  const [editDuration, setEditDuration] = useState(60);
  const [editPassScore, setEditPassScore] = useState(60);
  const [editMaxAttempts, setEditMaxAttempts] = useState("");
  const [editStatus, setEditStatus] = useState("");

  const fetchData = async () => {
    const [examsData, coursesData, catsData, treeData] = await Promise.all([
      api<ExamItem[]>("/exams"),
      api<CourseItem[]>("/courses"),
      api<FlatCategory[]>("/question-categories/flat"),
      api<TreeNode[]>("/question-categories/tree"),
    ]);
    setExams(examsData);
    setCourses(coursesData);
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

  const openCreate = () => {
    setShowWizard(true);
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

  const handleDelete = async (id: string) => {
    if (!confirm("确定删除此考试？")) return;
    try {
      await api(`/exams/${id}?confirm=true`, { method: "DELETE" });
      fetchData();
    } catch (e: any) {
      const msg = e?.message || "删除失败";
      // 后端检测到已有学员作答记录时返回 409，需二次确认才允许连成绩一起删除
      if (msg.includes("作答记录")) {
        if (!confirm(`${msg}\n\n确定要连同这些成绩一起删除吗？此操作不可恢复。`)) return;
        try {
          await api(`/exams/${id}?confirm=true&force=true`, { method: "DELETE" });
          fetchData();
        } catch (e2: any) {
          alert(e2?.message || "删除失败");
        }
        return;
      }
      alert(msg);
    }
  };

  if (loading) return <p className="text-text-secondary">加载中...</p>;

  return (
    <div>
      <h2 className="text-xl font-bold text-primary mb-4">考试管理</h2>

      <div className="flex gap-4 min-h-[calc(100vh-180px)]">
        {/* 左侧分类树 */}
        <div className="w-56 shrink-0 pr-5">
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
                <thead className="border-b border-border/40">
                  <tr>
                    <th className="text-center px-4 py-2.5 font-normal text-text-secondary/70 text-xs">考试名称</th>
                    <th className="text-center px-3 py-2.5 font-normal text-text-secondary/70 text-xs w-20">组卷</th>
                    <th className="text-center px-3 py-2.5 font-normal text-text-secondary/70 text-xs w-28">时长/分数</th>
                    <th className="text-center px-3 py-2.5 font-normal text-text-secondary/70 text-xs w-20">状态</th>
                    <th className="text-center px-3 py-2.5 font-normal text-text-secondary/70 text-xs w-16">参考</th>
                    <th className="text-center px-3 py-2.5 font-normal text-text-secondary/70 text-xs w-64">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredExams.map((e) => (
                    <tr key={e.id} className="border-b border-border/40 last:border-0 hover:bg-bg-layout/50">
                      <td className="px-4 py-3 font-medium truncate text-center">{e.title}</td>
                      <td className="px-3 py-3 text-text-secondary whitespace-nowrap text-center">{e.paper_type === "fixed" ? "固定" : "随机"}</td>
                      <td className="px-3 py-3 text-text-secondary whitespace-nowrap text-center">{e.duration}分钟 / {e.total_score}分</td>
                      <td className="px-3 py-3 whitespace-nowrap text-center">
                        <span className={`text-xs px-1.5 py-0.5 rounded ${STATUS_COLORS[e.status]}`}>{STATUS_LABELS[e.status]}</span>
                      </td>
                      <td className="px-3 py-3 text-center text-text-secondary whitespace-nowrap text-xs">
                        {e.submitted_user_count ?? 0}/{e.assigned_count ?? 0}
                      </td>
                      <td className="px-3 py-3 text-center whitespace-nowrap">
                        {e.status === "draft" && (
                          <button onClick={() => handlePublish(e.id)} className="text-xs text-text-secondary hover:text-primary transition-colors mr-3">发布</button>
                        )}
                        <Link to={`/admin/exams/${e.id}/results`} className="text-xs text-text-secondary hover:text-primary transition-colors mr-3">成绩</Link>
                        <Link to={`/admin/exams/${e.id}/paper`} className="text-xs text-text-secondary hover:text-primary transition-colors mr-3">查看组卷</Link>
                        <button onClick={() => openEdit(e)} className="text-xs text-text-secondary hover:text-primary transition-colors mr-3">编辑</button>
                        <button onClick={() => handleDelete(e.id)} className="text-xs text-text-secondary/60 hover:text-red-500 transition-colors">删除</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* 一键建考向导 */}
      {showWizard && (
        <ExamQuickCreate
          onClose={() => setShowWizard(false)}
          onDone={() => { setShowWizard(false); fetchData(); }}
        />
      )}

      {/* 编辑考试弹窗 */}
      {showModal && editingId && (
        <div className="fixed inset-0 bg-black/30 flex items-start justify-center pt-20 z-50" onClick={() => setShowModal(false)}>
          <div className="bg-bg-base rounded-lg shadow-xl p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-lg mb-4">编辑考试</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-text-secondary mb-1">考试名称</label>
                <input type="text" value={editTitle} onChange={(e) => setEditTitle(e.target.value)}
                  className="w-full border border-border rounded-md px-3 py-2 text-sm" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-text-secondary mb-1">时长(分钟)</label>
                  <input type="number" value={editDuration || ""} onChange={(e) => setEditDuration(parseInt(e.target.value) || 0)}
                    className="w-full border border-border rounded-md px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-text-secondary mb-1">及格分</label>
                  <input type="number" value={editPassScore || ""} onChange={(e) => setEditPassScore(parseInt(e.target.value) || 0)}
                    className="w-full border border-border rounded-md px-3 py-2 text-sm" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-text-secondary mb-1">最大重考次数</label>
                  <input type="number" value={editMaxAttempts} onChange={(e) => setEditMaxAttempts(e.target.value)}
                    placeholder="不限" className="w-full border border-border rounded-md px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-text-secondary mb-1">状态</label>
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