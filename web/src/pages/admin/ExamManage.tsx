import { useState, useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { Search } from "lucide-react";
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
  review_policy: string;
  // 列表接口附带的聚合统计
  assigned_count: number | null; submitted_user_count: number | null;
}
// 错题回顾时机选项复用共享常量（lib/examPolicy，与向导共用，避免循环依赖）
import { REVIEW_POLICIES } from "../../lib/examPolicy";
interface CourseItem {
  id: string; title: string; category_id: string | null;
}
interface PaperItem {
  id: string; title: string; category_id: string | null; paper_type: string;
  total_score: number; status: string;
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
const PAPER_TYPE_LABELS: Record<string, string> = { fixed: "固定", random: "随机" };

export default function ExamManage() {
  const [exams, setExams] = useState<ExamItem[]>([]);
  const [courses, setCourses] = useState<CourseItem[]>([]);
  const [papers, setPapers] = useState<PaperItem[]>([]);
  const [flatCategories, setFlatCategories] = useState<FlatCategory[]>([]);
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [loading, setLoading] = useState(true);
  // 一键建考向导（仅用于「复制考试」预填）
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
  const [editReviewPolicy, setEditReviewPolicy] = useState<string>("always");
  const [editStatus, setEditStatus] = useState("");
  const [editStartTime, setEditStartTime] = useState("");
  const [editEndTime, setEditEndTime] = useState("");

  // 复制考试（把源考试数据预填进一键建考向导）
  const [copyFrom, setCopyFrom] = useState<CopySource | null>(null);
  const [copying, setCopying] = useState<string | null>(null);

  // 新增考试弹窗（旧版流程：分类→选已发布试卷→配置）
  const [modalCategoryId, setModalCategoryId] = useState<string | null>(null);
  const [selectedPaperId, setSelectedPaperId] = useState("");
  const [selectedCourseId, setSelectedCourseId] = useState("");
  const [paperSearch, setPaperSearch] = useState("");
  const [duration, setDuration] = useState(60);
  const [passScore, setPassScore] = useState(60);

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

  // 新增弹窗：按选中分类筛已发布试卷
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

  // 新增弹窗：按选中分类找关联课程
  const matchedCourses = useMemo(() => {
    if (!modalCategoryId) return [];
    const descendantIds = categoryDescendants.get(modalCategoryId);
    if (!descendantIds) return [];
    return courses.filter((c) => c.category_id && descendantIds.has(c.category_id));
  }, [modalCategoryId, courses, categoryDescendants]);

  const selectedPaper = useMemo(
    () => papers.find((p) => p.id === selectedPaperId) || null,
    [papers, selectedPaperId],
  );

  const createCourseId = useMemo(
    () => selectedCourseId || (matchedCourses.length === 1 ? matchedCourses[0].id : ""),
    [selectedCourseId, matchedCourses],
  );

  // 匹配到唯一课程时自动选中
  useEffect(() => {
    if (matchedCourses.length === 1) {
      setSelectedCourseId(matchedCourses[0].id);
    }
  }, [matchedCourses]);

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

  // ISO datetime → datetime-local 输入框格式（截到分钟）
  const toLocalInput = (iso: string | null) => (iso ? iso.slice(0, 16) : "");

  const openEdit = (e: ExamItem) => {
    setEditingId(e.id);
    setEditTitle(e.title);
    setEditDuration(e.duration);
    setEditPassScore(e.pass_score);
    setEditMaxAttempts(e.max_attempts?.toString() || "");
    setEditReviewPolicy(e.review_policy || "always");
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
        review_policy: e.review_policy || "always",
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
          review_policy: editReviewPolicy,
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
                    {/* table-fixed 下全列给百分比：名称列不再吞掉剩余宽度，各列均匀铺满 */}
                    <th className="text-center w-[26%]">考试名称</th>
                    <th className="text-center w-[9%]">组卷</th>
                    <th className="text-center w-[17%]">时长/分数</th>
                    <th className="text-center w-[12%]">状态</th>
                    <th className="text-center w-[12%]">参考</th>
                    <th className="text-center w-[24%]">操作</th>
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

      {/* 新增考试弹窗：左分类树 + 右选已发布试卷 + 底部考试配置 */}
      {showModal && !editingId && (
        <div className="k-overlay" onClick={() => setShowModal(false)}>
          <div className="k-modal w-full max-w-2xl p-0 overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-border">
              <h3 className="k-modal-title m-0 text-[16px]">新增考试</h3>
              <button onClick={() => setShowModal(false)}
                className="text-text-secondary hover:text-text-base text-xl leading-none">&times;</button>
            </div>

            <div className="flex" style={{ height: "420px" }}>
              {/* 左：题库分类树 */}
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

              {/* 右：课程匹配 + 试卷列表 */}
              <div className="flex-1 flex flex-col min-w-0">
                <div className="px-4 pt-3 pb-2 space-y-2">
                  {modalCategoryId && (
                    <p className="text-xs text-text-secondary">{getCategoryPath(modalCategoryId, flatCategories)}</p>
                  )}
                  {modalCategoryId && matchedCourses.length === 1 && (
                    <p className="text-xs text-text-secondary">关联课程: {matchedCourses[0].title}</p>
                  )}
                  {modalCategoryId && matchedCourses.length > 1 && (
                    <select value={selectedCourseId} onChange={(e) => setSelectedCourseId(e.target.value)}
                      className="k-select w-full text-xs">
                      <option value="">选择课程</option>
                      {matchedCourses.map((c) => (
                        <option key={c.id} value={c.id}>{c.title}</option>
                      ))}
                    </select>
                  )}
                  <div className="relative">
                    <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-secondary" />
                    <input type="text" placeholder="搜索试卷..." value={paperSearch}
                      onChange={(e) => setPaperSearch(e.target.value)}
                      className="k-input w-full pl-7 text-sm" />
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto k-scroll px-4">
                  {!modalCategoryId ? (
                    <p className="text-sm text-text-secondary text-center mt-12">请在左侧选择课程分类</p>
                  ) : filteredPapers.length === 0 ? (
                    <div className="text-center mt-10 space-y-2">
                      <p className="text-sm text-text-secondary">
                        {paperSearch ? "无匹配试卷" : "该分类下暂无已发布试卷"}
                      </p>
                      {papers.some((p) => !p.category_id) && (
                        <p className="text-xs k-tag-warning">
                          另有 {papers.filter((p) => !p.category_id).length} 份试卷未设置题库分类，无法被选到，请先到「试卷管理」为其补充分类
                        </p>
                      )}
                    </div>
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
                          <div className="flex-1 min-w-0"><p className="text-sm k-strong truncate">{p.title}</p></div>
                          <span className="text-xs text-text-secondary shrink-0">{PAPER_TYPE_LABELS[p.paper_type] || "固定"}</span>
                          <span className="text-xs text-text-secondary shrink-0 w-12 text-right">{p.total_score}分</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>

                {selectedPaperId && (
                  <div className="border-t border-border px-4 py-3 bg-bg-layout/50 space-y-2">
                    <p className="text-xs text-text-secondary">考试配置</p>
                    {matchedCourses.length === 0 && (
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs k-tag-warning">该分类下没有课程</span>
                        <select value={selectedCourseId} onChange={(e) => setSelectedCourseId(e.target.value)}
                          className="k-select text-xs min-w-0">
                          <option value="">请手动选择关联课程（全部课程）</option>
                          {courses.map((c) => (
                            <option key={c.id} value={c.id}>{c.title}</option>
                          ))}
                        </select>
                      </div>
                    )}
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-2">
                        <label className="text-xs text-text-secondary">考试时长</label>
                        <input type="number" value={duration || ""} onChange={(e) => setDuration(parseInt(e.target.value) || 0)}
                          className="k-input w-16 text-sm text-right" min={1} />
                        <span className="text-xs text-text-secondary">分钟</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <label className="text-xs text-text-secondary">及格分数</label>
                        <input type="number" value={passScore || ""} onChange={(e) => setPassScore(parseInt(e.target.value) || 0)}
                          className="k-input w-16 text-sm text-right" min={1} />
                        <span className="text-xs text-text-secondary">分</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="k-modal-actions border-t border-border mt-0 px-5 py-3">
              {(!selectedPaperId || !createCourseId) && (
                <span className="mr-auto text-xs text-text-secondary self-center">
                  {!selectedPaperId ? "先在右侧选择试卷" : "请先选择关联课程"}
                </span>
              )}
              <button onClick={() => setShowModal(false)} className="k-btn k-btn-default">取消</button>
              <button onClick={handleCreate} disabled={saving || !selectedPaperId || !createCourseId}
                className="k-btn k-btn-primary disabled:opacity-50">
                {saving ? "创建中..." : "创建考试"}
              </button>
            </div>
          </div>
        </div>
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
              <div>
                <label className="k-label">错题回顾（正确答案）何时对学员可见</label>
                <div className="flex flex-col gap-1.5 mt-1">
                  {REVIEW_POLICIES.map((p) => (
                    <label key={p.value} className="flex items-start gap-2 text-sm cursor-pointer">
                      <input type="radio" name="editReviewPolicy" value={p.value}
                        checked={editReviewPolicy === p.value}
                        onChange={() => setEditReviewPolicy(p.value)} className="mt-1" />
                      <span>
                        <span className="text-text-base">{p.label}</span>
                        <span className="block text-xs text-text-secondary">{p.hint}</span>
                      </span>
                    </label>
                  ))}
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