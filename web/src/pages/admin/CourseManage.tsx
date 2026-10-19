/** 课程管理 · 列表页（课程管理重构 S8 重写，原 1873 行 → 本页只保留列表职责）
 *
 * - 左：纯分类树（hover 行内操作 +/✎/✕、新增顶级在底部行内输入）
 * - 右：扁平高密度表格（DataPanel + DataTable compact），列含章节/视频/已分配聚合数
 * - 新建/编辑跳独立页 /admin/courses/new、/admin/courses/:id/edit；分配走轻量弹窗（即时保存）
 * - 状态列 StatusTag 即发布/下架开关；原生 confirm/alert 已清零
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Pencil, Trash2, Search } from "lucide-react";
import CourseTree, { type TreeNode, type FlatCategory } from "../../components/CourseTree";
import PageHead from "../../components/ui/PageHead";
import DataPanel from "../../components/ui/DataPanel";
import DataTable, { type Column } from "../../components/ui/DataTable";
import StatusTag from "../../components/ui/StatusTag";
import AssignmentModal from "../../components/course/AssignmentModal";
import CategoryDeleteImpactModal from "../../components/course/CategoryDeleteImpactModal";
import { useToast } from "../../components/ui/Toast";
import { useConfirm } from "../../components/ui/Confirm";
import {
  deleteCategory, deleteCourse, getCategoryFlat, getCategoryImpact, getCategoryTree,
  getAssignments, listCourses, renameCategory, createCategory,
  updateCourseStatus,
  type CategoryImpact, type Course,
} from "../../lib/courseApi";

const SS_SELECTED = "cm.tree.selectedId";
const SS_EXPANDED = "cm.tree.expandedIds";

/** 已分配聚合：null = 拉取失败（列显示 —） */
type AssignCount = { users: number; depts: number } | null;

/** 树行内编辑态：重命名 / 在其下新增子分类 */
type TreeEdit = { kind: "rename"; id: string } | { kind: "addChild"; id: string } | null;

export default function CourseManage() {
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();

  // 树状态（selectedId / 展开态 sessionStorage 持久化）
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [flatCategories, setFlatCategories] = useState<FlatCategory[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(() => sessionStorage.getItem(SS_SELECTED) || null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => {
    try { return new Set<string>(JSON.parse(sessionStorage.getItem(SS_EXPANDED) || "[]")); }
    catch { return new Set<string>(); }
  });
  useEffect(() => {
    if (selectedId) sessionStorage.setItem(SS_SELECTED, selectedId);
    else sessionStorage.removeItem(SS_SELECTED);
  }, [selectedId]);
  useEffect(() => { sessionStorage.setItem(SS_EXPANDED, JSON.stringify([...expandedIds])); }, [expandedIds]);

  // 树编辑
  const [treeEdit, setTreeEdit] = useState<TreeEdit>(null);
  const [editDraft, setEditDraft] = useState("");
  const [addingRoot, setAddingRoot] = useState(false);
  const [newRootName, setNewRootName] = useState("");

  // 删除分类影响
  const [deleteImpact, setDeleteImpact] = useState<CategoryImpact | null>(null);
  const [deletingCategoryId, setDeletingCategoryId] = useState<string | null>(null);
  const [impactBusy, setImpactBusy] = useState(false);

  // 列表
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [counts, setCounts] = useState<Record<string, AssignCount>>({});
  const [countsPending, setCountsPending] = useState(false);
  const fetchSeqRef = useRef(0);

  // 分配弹窗
  const [assigningCourse, setAssigningCourse] = useState<{ id: string; title: string } | null>(null);

  /** 已分配聚合（N+1，并发 ≤10，失败行降级 null → 显示 —） */
  const loadCounts = useCallback(async (rows: Course[], seq: number) => {
    setCounts({});
    setCountsPending(true);
    const results: Record<string, AssignCount> = {};
    const queue = [...rows];
    const workerCount = Math.min(10, queue.length);
    await Promise.all(Array.from({ length: workerCount }, async () => {
      while (queue.length > 0) {
        const c = queue.shift();
        if (!c) break;
        try {
          const a = await getAssignments(c.id);
          results[c.id] = { users: a.users.length, depts: a.departments.length };
        } catch {
          results[c.id] = null;
        }
      }
    }));
    if (seq === fetchSeqRef.current) { setCounts(results); setCountsPending(false); }
  }, []);

  const fetchData = useCallback(async () => {
    const seq = ++fetchSeqRef.current;
    setLoading(true);
    try {
      const [t, flat, list] = await Promise.all([
        getCategoryTree(),
        getCategoryFlat(),
        listCourses({ category_id: selectedId, search: search.trim() || undefined }),
      ]);
      if (seq !== fetchSeqRef.current) return;
      setTree(t);
      setFlatCategories(flat);
      setCourses(list);
      setLoading(false);
      void loadCounts(list, seq);
    } catch (e: any) {
      if (seq !== fetchSeqRef.current) return;
      setLoading(false);
      toast.error(`加载课程失败：${e.message || e}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, search, loadCounts]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // 搜索防抖由 fetchData 依赖 search 触发；输入即重查在低频管理端可接受

  // ── 树操作 ──
  const startRename = (node: TreeNode) => { setTreeEdit({ kind: "rename", id: node.id }); setEditDraft(node.name); };
  const startAddChild = (node: TreeNode) => { setTreeEdit({ kind: "addChild", id: node.id }); setEditDraft(""); };

  const commitTreeEdit = async () => {
    if (!treeEdit) return;
    const name = editDraft.trim();
    if (!name) { setTreeEdit(null); return; }
    try {
      if (treeEdit.kind === "rename") await renameCategory(treeEdit.id, name);
      else {
        await createCategory(name, treeEdit.id);
        setExpandedIds(prev => new Set(prev).add(treeEdit.id));
      }
      setTreeEdit(null);
      fetchData();
    } catch (e: any) {
      toast.error(e.message || "操作失败");
    }
  };

  const commitAddRoot = async () => {
    const name = newRootName.trim();
    if (!name) { setAddingRoot(false); return; }
    try {
      await createCategory(name);
      setNewRootName("");
      setAddingRoot(false);
      fetchData();
    } catch (e: any) {
      toast.error(e.message || "创建分类失败");
    }
  };

  const handleDeleteCategory = async (id: string) => {
    try {
      const impact = await getCategoryImpact(id);
      setDeleteImpact(impact);
      setDeletingCategoryId(id);
    } catch (e: any) {
      toast.error(e.message || "获取影响信息失败");
    }
  };

  const confirmDeleteCategory = async () => {
    if (!deletingCategoryId || impactBusy) return;
    setImpactBusy(true);
    try {
      const result = await deleteCategory(deletingCategoryId);
      if (selectedId === deletingCategoryId) setSelectedId(null);
      setDeleteImpact(null);
      setDeletingCategoryId(null);
      const parts: string[] = [];
      if (result.affected?.courses > 0) parts.push(`${result.affected.courses} 门课程`);
      if (result.affected?.papers > 0) parts.push(`${result.affected.papers} 张试卷`);
      toast.success(parts.length > 0 ? `分类已删除，${parts.join("、")}已归为「未分类」` : "分类已删除");
      fetchData();
    } catch (e: any) {
      toast.error(e.message || "删除失败");
    } finally {
      setImpactBusy(false);
    }
  };

  // ── 课程操作 ──
  const toggleStatus = async (c: Course) => {
    const to = c.status === "published" ? "draft" : "published";
    const ok = await confirm({
      title: to === "published" ? "发布课程" : "下架课程",
      message: to === "published"
        ? `发布「${c.title}」？被分配的学员将立即可学习该课程。`
        : `下架「${c.title}」？下架后学员端即时不可见，已产生的学习记录会保留。`,
      confirmText: to === "published" ? "发布" : "下架",
      danger: to !== "published",
    });
    if (!ok) return;
    try {
      await updateCourseStatus(c.id, to);
      setCourses(prev => prev.map(x => (x.id === c.id ? { ...x, status: to } : x)));
      toast.success(to === "published" ? "已发布" : "已下架");
    } catch (e: any) {
      toast.error(`操作失败：${e.message || e}`);
    }
  };

  const handleDeleteCourse = async (c: Course) => {
    const ok = await confirm({
      title: "删除课程",
      message: `确定删除课程「${c.title}」？该操作不可恢复。`,
      confirmText: "删除",
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteCourse(c.id);
      toast.success("课程已删除");
      fetchData();
    } catch (e: any) {
      const msg = String(e?.message || e);
      if (msg.includes("学习记录")) {
        const forceOk = await confirm({
          title: "强制删除课程",
          message: "该课程已有学员学习记录，确定连同记录一起删除吗？此操作不可恢复。",
          confirmText: "强制删除",
          danger: true,
        });
        if (!forceOk) return;
        try {
          await deleteCourse(c.id, true);
          toast.success("课程已删除");
          fetchData();
        } catch (e2: any) {
          toast.error(`删除失败：${e2.message || e2}`);
        }
      } else {
        toast.error(`删除失败：${msg}`);
      }
    }
  };

  // ── 表格列 ──
  /** 后端 created_at 为服务器本地时钟（naive 无时区标记），直接截读即北京时间；
   * 若带 Z（UTC）则换算东八区。输出 "YYYY-MM-DD HH:mm" 单行显示 */
  const fmtTime = (s: string | null): string => {
    if (!s) return "—";
    if (s.endsWith("Z")) {
      const d = new Date(s);
      const p = (n: number) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
    }
    return s.replace("T", " ").slice(0, 16);
  };

  const assignText = (c: Course): string => {
    if (countsPending && counts[c.id] === undefined) return "…";
    const n = counts[c.id];
    if (!n) return "—";
    if (n.depts > 0 && n.users > 0) return `${n.users} 人 · ${n.depts} 部门`;
    if (n.depts > 0) return `${n.depts} 部门`;
    return `${n.users} 人`;
  };

  const columns: Column<Course>[] = useMemo(() => [
    {
      key: "title", title: "课程标题", width: 240, align: "center",
      render: (c) => (
        <button className="k-link truncate max-w-full" style={{ maxWidth: 216 }}
          title={c.title} onClick={() => navigate(`/admin/courses/${c.id}`)}>
          {c.title}
        </button>
      ),
      text: (c) => c.title,
    },
    {
      key: "type", title: "类型", width: 96, align: "center",
      render: (c) => <StatusTag value={c.require_attendance ? "type:attendance" : "type:online"} />,
      text: (c) => (c.require_attendance ? "现场签到" : "线上学习"),
    },
    {
      key: "status", title: "状态", width: 96, align: "center",
      render: (c) => (
        <StatusTag
          value={c.status}
          title={c.status === "published" ? "点击下架（学员端即时不可见）" : "点击发布"}
          onClick={() => toggleStatus(c)}
        />
      ),
      text: (c) => (c.status === "published" ? "已发布" : "草稿"),
    },
    {
      key: "chapters", title: "章节数", width: 72, align: "center",
      render: (c) => c.chapters.length,
      text: (c) => String(c.chapters.length),
    },
    {
      key: "videos", title: "视频数", width: 72, align: "center",
      render: (c) => c.video_count,
      text: (c) => String(c.video_count),
    },
    {
      key: "assigns", title: "已分配学员", width: 116, align: "center",
      render: (c) => assignText(c),
      text: (c) => assignText(c),
    },
    {
      key: "period", title: "起止日期", width: 150, align: "center",
      render: (c) => {
        const s = (c.start_date || "").slice(0, 10);
        const e = (c.end_date || "").slice(0, 10);
        return <span className="text-text-secondary whitespace-nowrap">{s || e ? `${s || "—"} ~ ${e || "—"}` : "—"}</span>;
      },
      text: (c) => `${(c.start_date || "").slice(0, 10)}~${(c.end_date || "").slice(0, 10)}`,
    },
    {
      key: "created_at", title: "创建时间", width: 138, align: "center",
      render: (c) => <span className="text-text-secondary whitespace-nowrap">{fmtTime(c.created_at)}</span>,
      text: (c) => fmtTime(c.created_at),
    },
    {
      key: "ops", title: "操作", width: 168, align: "center",
      render: (c) => (
        <span className="inline-flex items-center gap-2 whitespace-nowrap">
          <button className="k-link" onClick={() => navigate(`/admin/courses/${c.id}`)}>预览</button>
          <button className="k-link" onClick={() => navigate(`/admin/courses/${c.id}/edit`)}>编辑</button>
          <button className="k-link" onClick={() => setAssigningCourse({ id: c.id, title: c.title })}>分配</button>
          <button className="k-link k-link-danger" onClick={() => handleDeleteCourse(c)}>删除</button>
        </span>
      ),
      text: () => "",
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [counts, countsPending, navigate]);

  return (
    <div className="h-[calc(100vh-96px)] flex flex-col">
      <PageHead
        title="课程管理"
        description="左侧按分类筛选，右侧管理课程；新建与编辑在独立页面完成"
        actions={
          <button className="k-btn k-btn-primary" onClick={() => navigate("/admin/courses/new")}>
            <Plus size={14} /> 新建课程
          </button>
        }
      />

      <div className="flex gap-4 flex-1 min-h-0">
        {/* 左：纯分类树 */}
        <aside className="w-60 shrink-0 flex flex-col min-h-0">
          <CourseTree
            tree={tree}
            flatCategories={flatCategories}
            selectedId={selectedId}
            onSelect={setSelectedId}
            rootLabel="全部课程"
            placeholder="搜索分类..."
            loading={tree.length === 0 && loading}
            emptyText="暂无分类"
            expandedIds={expandedIds}
            onToggleExpanded={setExpandedIds}
            treeContainerClass="max-h-[calc(100vh-286px)]"
            renderNodeOverride={(node) => {
              if (!treeEdit || treeEdit.id !== node.id) return null;
              return (
                <div className="flex items-center gap-1 py-1 px-2" style={{ paddingLeft: 8 }}>
                  <input
                    autoFocus value={editDraft}
                    placeholder={treeEdit.kind === "addChild" ? "分类名称" : "重命名分类"}
                    onChange={e => setEditDraft(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === "Enter") commitTreeEdit();
                      if (e.key === "Escape") setTreeEdit(null);
                    }}
                    className="flex-1 min-w-0 border border-primary rounded px-2 py-1 text-sm"
                  />
                  <button onClick={commitTreeEdit} className="text-xs text-primary shrink-0">确定</button>
                  <button onClick={() => setTreeEdit(null)} className="text-xs text-text-secondary shrink-0">取消</button>
                </div>
              );
            }}
            renderNodeActions={(node) => (
              <>
                <button title="新建子分类" onClick={() => startAddChild(node)}
                  className="p-0.5 text-text-secondary hover:text-primary"><Plus size={12} /></button>
                <button title="重命名" onClick={() => startRename(node)}
                  className="p-0.5 text-text-secondary hover:text-primary"><Pencil size={12} /></button>
                <button title="删除分类" onClick={() => handleDeleteCategory(node.id)}
                  className="p-0.5 text-text-secondary hover:text-danger"><Trash2 size={12} /></button>
              </>
            )}
            renderTreeFooter={() => (
              <div className="p-1.5 border-t border-border mt-1">
                {addingRoot ? (
                  <div className="flex items-center gap-1">
                    <input
                      autoFocus value={newRootName} placeholder="课程类别名称，回车确定"
                      onChange={e => setNewRootName(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === "Enter") commitAddRoot();
                        if (e.key === "Escape") { setAddingRoot(false); setNewRootName(""); }
                      }}
                      className="flex-1 min-w-0 border border-primary rounded px-2 py-1 text-sm"
                    />
                    <button onClick={commitAddRoot} className="text-xs text-primary shrink-0">确定</button>
                  </div>
                ) : (
                  <button onClick={() => setAddingRoot(true)}
                    className="w-full text-xs text-text-secondary hover:text-primary flex items-center justify-center gap-1 py-1 rounded hover:bg-bg-layout">
                    <Plus size={12} /> 新建课程类别
                  </button>
                )}
              </div>
            )}
          />
        </aside>

        {/* 右：扁平课程表 */}
        <div className="flex-1 min-w-0 flex flex-col min-h-0">
          <DataPanel
            title={
              <span>
                课程列表
                <span className="text-text-secondary font-normal text-xs ml-2">
                  {selectedId
                    ? `分类：${flatCategories.find(c => c.id === selectedId)?.name || selectedId}（含子分类）`
                    : "全部分类"}
                  {` · 共 ${courses.length} 门`}
                </span>
              </span>
            }
            extra={
              <div className="relative">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-secondary" />
                <input
                  value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="搜索课程标题"
                  className="w-52 border border-border rounded-md pl-7 pr-2 py-1.5 text-sm"
                />
              </div>
            }
            bodyPadding={0}
            style={{ flex: 1, minHeight: 0 }}
          >
            <div className="h-full overflow-y-auto k-scroll">
              <DataTable
                columns={columns}
                rows={courses}
                rowKey={(c) => c.id}
                loading={loading}
                compact
                empty={selectedId ? "该分类（含子分类）下暂无课程" : "暂无课程，点击右上角「新建课程」创建"}
                exportName="课程列表"
              />
            </div>
          </DataPanel>
        </div>
      </div>

      {/* 分配弹窗（即时保存） */}
      <AssignmentModal
        course={assigningCourse}
        onClose={() => setAssigningCourse(null)}
      />

      {/* 删分类影响明细 */}
      {deleteImpact && (
        <CategoryDeleteImpactModal
          impact={deleteImpact}
          busy={impactBusy}
          onCancel={() => { setDeleteImpact(null); setDeletingCategoryId(null); }}
          onConfirm={confirmDeleteCategory}
        />
      )}
    </div>
  );
}
