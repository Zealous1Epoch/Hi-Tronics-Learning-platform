import { useState, useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";
import CourseTree, { type TreeNode, type FlatCategory, getCategoryPath, buildDescendantMap } from "../../components/CourseTree";
import ExamQuickCreate, { type CopySource } from "./ExamQuickCreate";
import type { PickedQuestion } from "../../components/exam/QuestionPickerPanel";

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
// GET /exams/{id}/paper 响应（复制考试时用）
interface CopyPaperData {
  questions: { question_id: string; score: number }[] | null;
  random_rules: { type: string; difficulty: string; count: number; score: number }[] | null;
  source_banks: string[] | null;
}

const STATUS_LABELS: Record<string, string> = { draft: "草稿", published: "已发布", ended: "已结束" };
const STATUS_COLORS: Record<string, string> = {
  draft: "k-tag", published: "k-tag k-tag-success",
  ended: "k-tag k-tag-danger",
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
  const [editStartTime, setEditStartTime] = useState("");
  const [editEndTime, setEditEndTime] = useState("");

  // 复制考试（把源考试数据预填进一键建考向导）
  const [copyFrom, setCopyFrom] = useState<CopySource | null>(null);
  const [copying, setCopying] = useState<string | null>(null);

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
    setCopyFrom(null);
    setShowWizard(true);
  };

  // ISO datetime → datetime-local 输入框格式（截到分钟）
  const toLocalInput = (iso: string | null) => (iso ? iso.slice(0, 16) : "");

  const openEdit = (e: ExamItem) => {
    setEditingId(e.id);
    setEditTitle(e.title);
    setEditDuration(e.duration);
    setEditPassScore(e.pass_score);
    setEditMaxAttempts(e.max_attempts?.toString() || "");
    setEditStatus(e.status);
    setEditStartTime(toLocalInput(e.start_time));
    setEditEndTime(toLocalInput(e.end_time));
    setShowModal(true);
  };

  // 复制考试：拉源考试的组卷配置，预填进一键建考向导（时间窗/课程绑定不带过来）
  const handleCopy = async (e: ExamItem) => {
    setCopying(e.id);
    try {
      const paper = await api<CopyPaperData>(`/exams/${e.id}/paper`);
      let picked: PickedQuestion[] = [];
      if (e.paper_type === "fixed") {
        const ids = (paper.questions || []).map((q) => q.question_id);
        if (!ids.length) { alert("该考试还没有组卷题目，无法复制"); return; }
        const found = await api<{ items: { id: string; type: string; stem: string; difficulty: string }[] }>(
          `/questions?ids=${encodeURIComponent(ids.join(","))}`,
        );
        const byId = new Map(found.items.map((q) => [q.id, q]));
        picked = (paper.questions || [])
          .filter((q) => byId.has(q.question_id))
          .map((q) => ({ question_id: q.question_id, ...byId.get(q.question_id)!, score: q.score }));
        if (picked.length < ids.length) {
          alert(`有 ${ids.length - picked.length} 道题已被删除，复制时将自动跳过`);
        }
      }
      setCopyFrom({
        title: e.title,
        duration: e.duration,
        pass_score: e.pass_score,
        max_attempts: e.max_attempts,
        paper_type: e.paper_type === "random" ? "random" : "fixed",
        fixed_questions: e.paper_type === "random" ? null : picked,
        random_rules: e.paper_type === "random" ? (paper.random_rules || []) : null,
        source_banks: paper.source_banks || null,
      });
      setShowWizard(true);
    } catch (err: unknown) {
      alert(`读取源考试失败：${err instanceof Error ? err.message : "未知错误"}`);
    } finally {
      setCopying(null);
    }
  };

  const handleEditSave = async () => {
    if (!editingId || !editTitle.trim()) return;
    if (editStartTime && editEndTime && editStartTime >= editEndTime) {
      alert("开放时间必须早于截止时间");
      return;
    }
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
          // 显式传 null 可清空时间窗（PUT 为 exclude_unset 语义）
          start_time: editStartTime || null,
          end_time: editEndTime || null,
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

  if (loading) return <p className="k-empty">加载中...</p>;

  return (
    <div>
      <h2 className="k-title text-[22px] text-primary mb-4">考试管理</h2>

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
            <button onClick={openCreate} className="k-btn k-btn-primary">
              新增考试
            </button>
          </div>

          {filteredExams.length === 0 ? (
            <div className="k-card k-empty">
              暂无考试
            </div>
          ) : (
            <div className="k-table-wrap overflow-hidden">
              <table className="k-table table-fixed">
                <thead>
                  <tr>
                    <th className="text-center">考试名称</th>
                    <th className="text-center w-20">组卷</th>
                    <th className="text-center w-28">时长/分数</th>
                    <th className="text-center w-20">状态</th>
                    <th className="text-center w-16">参考</th>
                    <th className="text-center w-64">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredExams.map((e) => (
                    <tr key={e.id}>
                      <td className="k-strong truncate text-center">{e.title}</td>
                      <td className="k-muted whitespace-nowrap text-center">{e.paper_type === "fixed" ? "固定" : "随机"}</td>
                      <td className="k-muted whitespace-nowrap text-center">{e.duration}分钟 / {e.total_score}分</td>
                      <td className="whitespace-nowrap text-center">
                        <span className={STATUS_COLORS[e.status]}>{STATUS_LABELS[e.status]}</span>
                      </td>
                      <td className="text-center k-muted whitespace-nowrap">
                        {e.submitted_user_count ?? 0}/{e.assigned_count ?? 0}
                      </td>
                      <td className="text-center whitespace-nowrap">
                        {e.status === "draft" && (
                          <button onClick={() => handlePublish(e.id)} className="k-link mr-3">发布</button>
                        )}
                        <Link to={`/admin/exams/${e.id}/results`} className="k-link mr-3">成绩</Link>
                        <Link to={`/admin/exams/${e.id}/paper`} className="k-link mr-3">查看组卷</Link>
                        <button onClick={() => openEdit(e)} className="k-link mr-3">编辑</button>
                        <button onClick={() => handleCopy(e)} disabled={copying === e.id}
                          className="k-link mr-3 disabled:opacity-40">
                          {copying === e.id ? "读取中..." : "复制"}
                        </button>
                        <button onClick={() => handleDelete(e.id)} className="k-link k-link-danger">删除</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* 一键建考向导（copyFrom 非空时为复制模式） */}
      {showWizard && (
        <ExamQuickCreate
          copyFrom={copyFrom}
          onClose={() => { setShowWizard(false); setCopyFrom(null); }}
          onDone={() => { setShowWizard(false); setCopyFrom(null); fetchData(); }}
        />
      )}

      {/* 编辑考试弹窗 */}
      {showModal && editingId && (
        <div className="k-overlay" onClick={() => setShowModal(false)}>
          <div className="k-modal w-full max-w-md max-h-[85vh] overflow-y-auto k-scroll" onClick={(e) => e.stopPropagation()}>
            <h3 className="k-modal-title">编辑考试</h3>
            <div className="space-y-3">
              <div>
                <label className="k-label">考试名称</label>
                <input type="text" value={editTitle} onChange={(e) => setEditTitle(e.target.value)}
                  className="k-input" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="k-label">时长(分钟)</label>
                  <input type="number" value={editDuration || ""} onChange={(e) => setEditDuration(parseInt(e.target.value) || 0)}
                    className="k-input" />
                </div>
                <div>
                  <label className="k-label">及格分</label>
                  <input type="number" value={editPassScore || ""} onChange={(e) => setEditPassScore(parseInt(e.target.value) || 0)}
                    className="k-input" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="k-label">最大重考次数</label>
                  <input type="number" value={editMaxAttempts} onChange={(e) => setEditMaxAttempts(e.target.value)}
                    placeholder="不限" className="k-input" />
                </div>
                <div>
                  <label className="k-label">状态</label>
                  <select value={editStatus} onChange={(e) => setEditStatus(e.target.value)}
                    className="k-select">
                    <option value="draft">草稿</option>
                    <option value="published">已发布</option>
                    <option value="ended">已结束</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="k-label">开放时间（留空=立即开放）</label>
                  <input type="datetime-local" value={editStartTime} onChange={(e) => setEditStartTime(e.target.value)}
                    className="k-input min-w-0" />
                </div>
                <div>
                  <label className="k-label">截止时间（留空=不限）</label>
                  <input type="datetime-local" value={editEndTime} onChange={(e) => setEditEndTime(e.target.value)}
                    className="k-input min-w-0" />
                </div>
              </div>
            </div>
            <div className="k-modal-actions">
              <button onClick={() => setShowModal(false)} className="k-btn k-btn-default">取消</button>
              <button onClick={handleEditSave} disabled={saving}
                className="k-btn k-btn-primary disabled:opacity-50">
                {saving ? "保存中..." : "保存"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}