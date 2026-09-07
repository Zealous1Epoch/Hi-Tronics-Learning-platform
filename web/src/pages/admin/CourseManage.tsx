import { useState, useEffect, useRef } from "react";
import { api, uploadFileWithProgress } from "../../lib/api";
import { ChevronRight, ChevronDown, Plus, Search, Pencil, Trash2, X, Upload } from "lucide-react";

interface TreeNode {
  id: string; name: string; parent_id: string | null;
  sort_order: number; children: TreeNode[];
}
interface FlatCategory {
  id: string; name: string; parent_id: string | null;
}
interface CourseItem {
  id: string; title: string; category_id: string | null;
  status: string; video_count: number; created_at: string;
  start_date: string | null; end_date: string | null;
}
interface VideoItem {
  id: string; course_id: string; title: string; obs_key: string;
  file_size: number | null; duration: number | null; sort_order: number;
}
interface CourseDetail {
  id: string; title: string; description: string | null;
  cover_image: string | null; category_id: string | null;
  exam_id: string | null; start_date: string | null;
  end_date: string | null; status: string;
  videos: VideoItem[]; video_count: number;
}
interface UserItem {
  id: string; name: string; department: string | null;
}
interface DeptItem {
  id: string; name: string;
  children?: DeptItem[];
}
interface PendingFile {
  file: File;
  title: string;
  uploading: boolean;
  progress: number;
  duration: number | null;
}

// 用浏览器 <video> 探测视频时长（秒），失败返回 null
function probeVideoDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const el = document.createElement("video");
    el.preload = "metadata";
    el.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(el.duration) ? Math.round(el.duration) : null);
    };
    el.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    el.src = url;
  });
}

export default function CourseManage() {
  // 树状态
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [flatCategories, setFlatCategories] = useState<FlatCategory[]>([]);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchText, setSearchText] = useState("");

  // 树编辑状态
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [addingRoot, setAddingRoot] = useState(false);
  const [newRootName, setNewRootName] = useState("");
  const [addingChildUnder, setAddingChildUnder] = useState<string | null>(null);
  const [newChildName, setNewChildName] = useState("");

  // 课程列表
  const [courses, setCourses] = useState<CourseItem[]>([]);
  const [loading, setLoading] = useState(true);

  // 编辑弹窗
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingCourse, setEditingCourse] = useState<CourseDetail | null>(null);
  const [editCategoryId, setEditCategoryId] = useState<string>("");
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editStartDate, setEditStartDate] = useState("");
  const [editEndDate, setEditEndDate] = useState("");
  const [editVideos, setEditVideos] = useState<VideoItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [categorySearch, setCategorySearch] = useState("");
  const [showCategoryDropdown, setShowCategoryDropdown] = useState(false);
  const categoryDropdownRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const blobUrlsRef = useRef<Map<File, string>>(new Map());

  const getBlobUrl = (file: File): string => {
    const cached = blobUrlsRef.current.get(file);
    if (cached) return cached;
    const url = URL.createObjectURL(file);
    blobUrlsRef.current.set(file, url);
    return url;
  };

  // 分配弹窗
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [assigningCourseId, setAssigningCourseId] = useState<string | null>(null);
  const [assigningTitle, setAssigningTitle] = useState("");
  const [allUsers, setAllUsers] = useState<UserItem[]>([]);
  const [allDepts, setAllDepts] = useState<DeptItem[]>([]);
  const [assignedUsers, setAssignedUsers] = useState<UserItem[]>([]);
  const [assignedDepts, setAssignedDepts] = useState<DeptItem[]>([]);
  const [selectedUsers, setSelectedUsers] = useState<Set<string>>(new Set());
  const [selectedDepts, setSelectedDepts] = useState<Set<string>>(new Set());
  const [userSearch, setUserSearch] = useState("");
  const [deptSearch, setDeptSearch] = useState("");
  const [activeDeptId, setActiveDeptId] = useState<string | null>(null);

  // 编辑弹窗内分配
  const [editAssignUsers, setEditAssignUsers] = useState<UserItem[]>([]);
  const [editAssignDepts, setEditAssignDepts] = useState<DeptItem[]>([]);
  const [editSelectedUsers, setEditSelectedUsers] = useState<Set<string>>(new Set());
  const [editSelectedDepts, setEditSelectedDepts] = useState<Set<string>>(new Set());
  const [editUserSearch, setEditUserSearch] = useState("");
  const [editDeptSearch, setEditDeptSearch] = useState("");
  const [editActiveDeptId, setEditActiveDeptId] = useState<string | null>(null);
  const editExistingAssignments = useRef<{ user_ids: string[]; department_ids: string[] }>({ user_ids: [], department_ids: [] });

  const fetchData = async () => {
    const [treeData, flatData, coursesData] = await Promise.all([
      api<TreeNode[]>("/question-categories/tree"),
      api<FlatCategory[]>("/question-categories/flat"),
      api<CourseItem[]>(`/courses${selectedId ? `?category_id=${selectedId}` : ""}`),
    ]);
    setTree(treeData);
    setFlatCategories(flatData);
    setCourses(coursesData);
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, [selectedId]);

  // 树操作
  const toggleExpand = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleRename = async () => {
    if (!editingName.trim() || !editingId) return;
    await api(`/question-categories/${editingId}`, {
      method: "PUT",
      body: JSON.stringify({ name: editingName.trim() }),
    });
    setEditingId(null);
    setEditingName("");
    fetchData();
  };

  const handleDeleteCategory = async (id: string) => {
    if (!confirm("删除此课程将同时删除其章节，确定？")) return;
    try {
      await api(`/question-categories/${id}`, { method: "DELETE" });
      if (selectedId === id) setSelectedId(null);
      fetchData();
    } catch (e: any) {
      alert(e.message || "删除失败");
    }
  };

  const handleAddRoot = async () => {
    if (!newRootName.trim()) return;
    await api("/question-categories", {
      method: "POST",
      body: JSON.stringify({ name: newRootName.trim() }),
    });
    setNewRootName("");
    setAddingRoot(false);
    fetchData();
  };

  const handleAddChild = async (parentId: string) => {
    if (!newChildName.trim()) return;
    await api("/question-categories", {
      method: "POST",
      body: JSON.stringify({ name: newChildName.trim(), parent_id: parentId }),
    });
    setNewChildName("");
    setAddingChildUnder(null);
    fetchData();
  };

  const startAddChild = () => {
    if (!selectedId) return;
    setNewChildName("");
    setAddingChildUnder(selectedId);
    setExpandedIds(prev => new Set(prev).add(selectedId));
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

  // 课程操作
  const handleDeleteCourse = async (id: string) => {
    if (!confirm("确定删除此课程？")) return;
    await api(`/courses/${id}`, { method: "DELETE" });
    fetchData();
  };

  // 编辑弹窗
  const openCreate = async () => {
    setEditingCourse(null);
    setEditTitle("");
    setEditDescription("");
    setEditStartDate("");
    setEditEndDate("");
    setEditCategoryId(selectedId || "");
    setEditVideos([]);
    setPendingFiles([]);
    setCategorySearch("");
    setShowCategoryDropdown(false);
    const [users, depts] = await Promise.all([
      api<UserItem[]>("/users"),
      api<DeptItem[]>("/departments?flat=true"),
    ]);
    editExistingAssignments.current = { user_ids: [], department_ids: [] };
    setEditAssignUsers(users);
    setEditAssignDepts(flattenDepts(depts));
    setEditSelectedUsers(new Set());
    setEditSelectedDepts(new Set());
    setEditUserSearch("");
    setEditDeptSearch("");
    setEditActiveDeptId(null);
    setShowEditModal(true);
  };

  const openEdit = async (courseId: string) => {
    const [detail, users, depts, assignments] = await Promise.all([
      api<CourseDetail>(`/courses/${courseId}`),
      api<UserItem[]>("/users"),
      api<DeptItem[]>("/departments?flat=true"),
      api<{ users: UserItem[]; departments: DeptItem[] }>(`/courses/${courseId}/assignments`),
    ]);
    setEditingCourse(detail);
    setEditTitle(detail.title);
    setEditDescription(detail.description || "");
    setEditStartDate(detail.start_date || "");
    setEditEndDate(detail.end_date || "");
    setEditVideos(detail.videos);
    setPendingFiles([]);
    setEditAssignUsers(users);
    setEditAssignDepts(flattenDepts(depts));
    editExistingAssignments.current = {
      user_ids: assignments.users.map(u => u.id),
      department_ids: assignments.departments.map(d => d.id),
    };
    setEditSelectedUsers(new Set(assignments.users.map(u => u.id)));
    setEditSelectedDepts(new Set(assignments.departments.map(d => d.id)));
    setEditUserSearch("");
    setEditDeptSearch("");
    setEditActiveDeptId(null);
    setShowEditModal(true);
  };

  const handleSaveCourse = async (status: string) => {
    if (!editTitle.trim()) return;
    setSaving(true);
    try {
      const body = {
        title: editTitle,
        description: editDescription || null,
        category_id: editingCourse ? editingCourse.category_id : (editCategoryId || null),
        start_date: editStartDate || null,
        end_date: editEndDate || null,
        status,
      };
      let courseId = editingCourse?.id;
      if (editingCourse) {
        await api(`/courses/${editingCourse.id}`, { method: "PUT", body: JSON.stringify(body) });
      } else {
        const course = await api<CourseDetail>("/courses", { method: "POST", body: JSON.stringify(body) });
        courseId = course.id;
      }
      // 保存分配：编辑时先清旧分配再追加，新增时直接追加
      if (courseId) {
        if (editingCourse) {
          const prev = editExistingAssignments.current;
          if (prev.user_ids.length > 0 || prev.department_ids.length > 0) {
            await api(`/courses/${courseId}/assignments`, {
              method: "DELETE",
              body: JSON.stringify({ user_ids: prev.user_ids, department_ids: prev.department_ids }),
            });
          }
        }
        if (editSelectedUsers.size > 0 || editSelectedDepts.size > 0) {
          await api(`/courses/${courseId}/assignments`, {
            method: "POST",
            body: JSON.stringify({ user_ids: [...editSelectedUsers], department_ids: [...editSelectedDepts] }),
          });
        }
      }
      // 上传待上传的视频文件
      if (courseId && pendingFiles.length > 0) {
        for (let i = 0; i < pendingFiles.length; i++) {
          const pf = pendingFiles[i];
          setPendingFiles(prev => prev.map((p, idx) => idx === i ? { ...p, uploading: true, progress: 0 } : p));
          try {
            const { filename, file_size } = await uploadFileWithProgress<{ filename: string; file_size: number }>(
              "/videos/upload", pf.file,
              (progress) => setPendingFiles(prev => prev.map((p, idx) => idx === i ? { ...p, progress } : p)),
            );
            setPendingFiles(prev => prev.map((p, idx) => idx === i ? { ...p, uploading: false, progress: 100 } : p));
            await api(`/courses/${courseId}/videos`, {
              method: "POST",
              body: JSON.stringify({ title: pf.title, obs_key: filename, file_size, duration: pf.duration }),
            });
          } catch (e: any) {
            // 单个视频上传失败不阻塞其余视频，标记状态后继续
            setPendingFiles(prev => prev.map((p, idx) => idx === i ? { ...p, uploading: false } : p));
            console.error("视频上传失败", pf.file.name, e);
            alert(`视频「${pf.file.name}」上传失败：${e.message || e}，其余内容已保存`);
          }
        }
      }
      setSaving(false);
      setShowEditModal(false);
      fetchData();
    } catch (e: any) {
      alert(`保存失败：${e.message || e}`);
      setSaving(false);
    }
  };

  const handleFiles = (files: FileList) => {
    const newFiles: PendingFile[] = [];
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("video/")) continue;
      const name = file.name.replace(/\.[^.]+$/, "");
      newFiles.push({ file, title: name, uploading: false, progress: 0, duration: null });
    }
    setPendingFiles(prev => [...prev, ...newFiles]);
    // 异步探测每个文件的时长
    newFiles.forEach(async (nf) => {
      const duration = await probeVideoDuration(nf.file);
      setPendingFiles(prev => prev.map(p => p.file === nf.file ? { ...p, duration } : p));
    });
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files);
  };

  const updatePendingTitle = (index: number, title: string) => {
    setPendingFiles(prev => prev.map((pf, i) => i === index ? { ...pf, title } : pf));
  };

  const removePendingFile = (index: number) => {
    setPendingFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleDeleteVideo = async (videoId: string) => {
    if (!editingCourse || !confirm("删除此视频？")) return;
    await api(`/videos/${videoId}`, { method: "DELETE" });
    const data = await api<CourseDetail>(`/courses/${editingCourse.id}`);
    setEditVideos(data.videos);
  };

  // 分配弹窗
  const openAssign = async (course: CourseItem) => {
    setAssigningCourseId(course.id);
    setAssigningTitle(course.title);
    const [users, depts, assignments] = await Promise.all([
      api<UserItem[]>("/users"),
      api<DeptItem[]>("/departments?flat=true"),
      api<{ users: UserItem[]; departments: DeptItem[] }>(`/courses/${course.id}/assignments`),
    ]);
    setAllUsers(users);
    setAllDepts(flattenDepts(depts));
    setAssignedUsers(assignments.users);
    setAssignedDepts(assignments.departments);
    setSelectedUsers(new Set());
    setSelectedDepts(new Set());
    setUserSearch("");
    setDeptSearch("");
    setActiveDeptId(null);
    setShowAssignModal(true);
  };

  const flattenDepts = (depts: DeptItem[]): DeptItem[] => {
    return depts.flatMap(d => [
      { id: d.id, name: d.name },
      ...flattenDepts(d.children || []),
    ]);
  };

  const handleAssign = async () => {
    if (!assigningCourseId) return;
    await api(`/courses/${assigningCourseId}/assignments`, {
      method: "POST",
      body: JSON.stringify({ user_ids: [...selectedUsers], department_ids: [...selectedDepts] }),
    });
    const assignments = await api<{ users: UserItem[]; departments: DeptItem[] }>(
      `/courses/${assigningCourseId}/assignments`
    );
    setAssignedUsers(assignments.users);
    setAssignedDepts(assignments.departments);
    setSelectedUsers(new Set());
    setSelectedDepts(new Set());
  };

  const handleRemoveAssignment = async (type: "user" | "dept", targetId: string) => {
    if (!assigningCourseId) return;
    const body: { user_ids: string[]; department_ids: string[] } = { user_ids: [], department_ids: [] };
    if (type === "user") {
      body.user_ids = [targetId];
    } else {
      body.department_ids = [targetId];
      // 移除部门时，同时清理该部门下的用户分配（避免孤儿记录）
      const deptName = allDepts.find(d => d.id === targetId)?.name;
      if (deptName) {
        body.user_ids = assignedUsers.filter(u => u.department === deptName).map(u => u.id);
      }
    }
    await api(`/courses/${assigningCourseId}/assignments`, {
      method: "DELETE",
      body: JSON.stringify(body),
    });
    const assignments = await api<{ users: UserItem[]; departments: DeptItem[] }>(
      `/courses/${assigningCourseId}/assignments`
    );
    setAssignedUsers(assignments.users);
    setAssignedDepts(assignments.departments);
  };

  // 树搜索过滤
  const filterTree = (nodes: TreeNode[], term: string): TreeNode[] => {
    if (!term) return nodes;
    const lower = term.toLowerCase();
    const result: TreeNode[] = [];
    for (const node of nodes) {
      const filteredChildren = filterTree(node.children, term);
      if (node.name.toLowerCase().includes(lower) || filteredChildren.length > 0) {
        result.push({ ...node, children: filteredChildren });
      }
    }
    return result;
  };

  const filteredTree = searchText ? filterTree(tree, searchText) : tree;

  useEffect(() => {
    if (!searchText) return;
    const collectIds = (nodes: TreeNode[]): string[] => {
      const ids: string[] = [];
      for (const node of nodes) {
        ids.push(node.id);
        ids.push(...collectIds(node.children));
      }
      return ids;
    };
    setExpandedIds(new Set(collectIds(filteredTree)));
  }, [searchText]);

  // 点击外部关闭分类下拉
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (categoryDropdownRef.current && !categoryDropdownRef.current.contains(e.target as Node)) {
        setShowCategoryDropdown(false);
      }
    };
    if (showCategoryDropdown) {
      document.addEventListener("mousedown", handleClick);
      return () => document.removeEventListener("mousedown", handleClick);
    }
  }, [showCategoryDropdown]);

  // 关闭编辑弹窗时释放 blob URL
  useEffect(() => {
    if (!showEditModal) {
      blobUrlsRef.current.forEach(url => URL.revokeObjectURL(url));
      blobUrlsRef.current.clear();
    }
  }, [showEditModal]);

  const renderTree = (nodes: TreeNode[], depth: number = 0) => {
    return nodes.map(node => {
      const isExpanded = expandedIds.has(node.id);
      const isSelected = selectedId === node.id;
      const hasChildren = node.children.length > 0;
      const isAddingChild = addingChildUnder === node.id;

      return (
        <div key={node.id}>
          <div
            className={`flex items-center gap-1 py-1.5 px-2 cursor-pointer hover:bg-bg-layout rounded text-sm ${
              isSelected ? "bg-primary/10 text-primary font-medium" : ""
            }`}
            style={{ paddingLeft: `${8 + depth * 16}px` }}
            onClick={() => {
              setSelectedId(node.id);
              if (hasChildren) {
                setExpandedIds(prev => {
                  const next = new Set(prev);
                  next.has(node.id) ? next.delete(node.id) : next.add(node.id);
                  return next;
                });
              }
            }}
          >
            {hasChildren ? (
              <button
                onClick={e => { e.stopPropagation(); toggleExpand(node.id); }}
                className="p-0.5 shrink-0 text-text-secondary"
              >
                {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>
            ) : (
              <span className="w-5 shrink-0" />
            )}
            <span className="truncate">{node.name}</span>
          </div>
          {isExpanded && hasChildren && renderTree(node.children, depth + 1)}
          {isAddingChild && (
            <div className="flex items-center gap-1 px-2 py-1" style={{ paddingLeft: `${8 + (depth + 1) * 16}px` }}>
              <span className="w-5 shrink-0" />
              <input
                type="text"
                value={newChildName}
                onChange={e => setNewChildName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter") handleAddChild(node.id);
                  if (e.key === "Escape") { setAddingChildUnder(null); setNewChildName(""); }
                }}
                placeholder="输入名称..."
                className="flex-1 border border-border rounded-md px-2 py-1 text-sm"
                autoFocus
              />
            </div>
          )}
        </div>
      );
    });
  };

  const CourseCardItem = ({ c, getCategoryPath, openEdit, openAssign, handleDeleteCourse }: {
    c: CourseItem;
    getCategoryPath: (id: string | null) => string;
    openEdit: (id: string) => void;
    openAssign: (course: CourseItem) => void;
    handleDeleteCourse: (id: string) => void;
  }) => (
    <div className="bg-bg-base rounded-lg border border-border p-4 hover:shadow-sm transition-shadow">
      <div className="flex items-start justify-between mb-2">
        <h4 className="font-medium text-sm truncate flex-1 min-w-0">{c.title}</h4>
        <span className={`text-xs px-2 py-0.5 rounded shrink-0 ml-2 ${
          c.status === "published" ? "bg-emerald-50 text-emerald-700" : "bg-bg-layout text-text-secondary"
        }`}>
          {c.status === "published" ? "已发布" : "草稿"}
        </span>
      </div>
      <div className="space-y-1 text-xs text-text-secondary mb-3">
        <p className="truncate">{getCategoryPath(c.category_id)}</p>
        <div className="flex items-center gap-3">
          <span>{c.video_count} 个视频</span>
          <span>发布时间：{new Date(c.created_at).toLocaleDateString("zh-CN")}</span>
        </div>
        {c.start_date && c.end_date && (
          <p className="text-primary/70">时间范围：{c.start_date} ~ {c.end_date}</p>
        )}
      </div>
      <div className="flex items-center gap-2 pt-2 border-t border-border">
        <button onClick={() => openEdit(c.id)} className="flex-1 text-xs text-center text-primary border border-border rounded-md py-1 hover:bg-bg-layout">编辑</button>
        <button onClick={() => openAssign(c)} className="flex-1 text-xs text-center text-primary border border-border rounded-md py-1 hover:bg-bg-layout">分配</button>
        <button onClick={() => handleDeleteCourse(c.id)} className="text-xs text-red-500 border border-red-200 rounded-md px-2 py-1 hover:bg-red-50 shrink-0">删除</button>
      </div>
    </div>
  );

  return (
    <div>
      <h2 className="text-xl font-bold text-primary mb-4 pb-3 border-b border-border">课程管理</h2>

      <div className="flex gap-4 min-h-[calc(100vh-180px)]">
        {/* 左侧课程树 */}
        <div className="w-56 shrink-0 pr-4 border-r border-border">
          <div
            onClick={() => setSelectedId(null)}
            className={`px-3 py-2 rounded-md cursor-pointer text-sm font-medium mb-2 ${
              selectedId === null ? "bg-primary/10 text-primary" : "text-text-secondary hover:bg-bg-layout"
            }`}
          >
            全部课程
          </div>
          <div className="relative mb-2">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-secondary" />
            <input
              type="text" placeholder="搜索课程..."
              value={searchText} onChange={e => setSearchText(e.target.value)}
              className="w-full border border-border rounded-md pl-7 pr-3 py-1.5 text-sm"
            />
          </div>
          <div className="bg-bg-base rounded-lg border border-border max-h-[calc(100vh-240px)] overflow-y-auto">
            {loading ? (
              <p className="p-4 text-sm text-text-secondary">加载中...</p>
            ) : filteredTree.length === 0 && !addingRoot ? (
              <div className="p-4 text-center text-sm text-text-secondary">
                {searchText ? "无匹配结果" : "暂无课程，点击下方按钮添加"}
              </div>
            ) : (
              <div className="py-1">
                {filteredTree.length > 0 && renderTree(filteredTree)}
                {addingRoot && (
                  <div className="flex items-center gap-1 px-2 py-1" style={{ paddingLeft: 8 }}>
                    <span className="w-5 shrink-0" />
                    <input
                      type="text"
                      value={newRootName}
                      onChange={e => setNewRootName(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === "Enter") handleAddRoot();
                        if (e.key === "Escape") { setAddingRoot(false); setNewRootName(""); }
                      }}
                      onBlur={() => {
                        if (!newRootName.trim()) { setAddingRoot(false); setNewRootName(""); }
                      }}
                      placeholder="输入名称..."
                      className="flex-1 border border-border rounded-md px-2 py-1 text-sm"
                      autoFocus
                    />
                  </div>
                )}
              </div>
            )}
          </div>
          <button
            onClick={() => { setAddingRoot(true); setNewRootName(""); }}
            className="mt-2 w-full flex items-center justify-center gap-1 px-3 py-1.5 text-xs text-primary border border-dashed border-primary/30 rounded-md hover:bg-primary/5"
          >
            <Plus size={12} /> 添加课程
          </button>
          {selectedId && (
            <div className="mt-1.5 space-y-1.5">
              <button
                onClick={startAddChild}
                className="w-full flex items-center justify-center gap-1 px-3 py-1.5 text-xs bg-primary text-white rounded-md hover:bg-primary-light border border-primary"
              >
                <Plus size={12} /> 添加章节
              </button>
              <div className="flex gap-1.5">
                <button
                  onClick={() => {
                    const node = flatCategories.find(c => c.id === selectedId);
                    setEditingId(selectedId);
                    setEditingName(node?.name || "");
                  }}
                  className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-xs border border-border rounded-md hover:bg-bg-layout"
                >
                  <Pencil size={12} /> 重命名
                </button>
                <button
                  onClick={() => handleDeleteCategory(selectedId)}
                  className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-xs border border-red-200 text-red-500 rounded-md hover:bg-red-50"
                >
                  <Trash2 size={12} /> 删除
                </button>
              </div>
            </div>
          )}
        </div>

        {/* 右侧课程列表 */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm text-text-secondary">
              {selectedId ? getCategoryPath(selectedId) : "全部课程"}
            </span>
            <button
              onClick={openCreate}
              className="px-4 py-2 bg-primary text-white rounded-md text-sm hover:bg-primary-light border border-primary"
            >
              <Plus size={14} className="inline mr-1" />新增课程
            </button>
          </div>

          {/* 重命名输入框 */}
          {editingId && (
            <div className="flex items-center gap-2 bg-bg-base rounded-lg border border-border p-3 mb-3">
              <input
                type="text" value={editingName}
                onChange={e => setEditingName(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleRename()}
                className="flex-1 border border-border rounded-md px-3 py-1.5 text-sm"
                autoFocus
              />
              <button onClick={handleRename} className="px-3 py-1.5 text-xs bg-primary text-white rounded-md border border-primary">保存</button>
              <button onClick={() => setEditingId(null)} className="px-3 py-1.5 text-xs border border-border rounded-md">取消</button>
            </div>
          )}

          {courses.length === 0 ? (
            <div className="bg-bg-base rounded-lg p-12 border border-border text-center text-text-secondary">
              暂无课程
            </div>
          ) : (
            <div className="space-y-6">
              {(() => {
                // 按分类分组（按根节点分类名分组，子分类归入父级）
                const parentMap = new Map(flatCategories.map(c => [c.id, c.parent_id]));
                const nameMap = new Map(flatCategories.map(c => [c.id, c.name]));
                const getRootName = (id: string): string => {
                  let current = id;
                  let parent = parentMap.get(current);
                  while (parent) {
                    current = parent;
                    parent = parentMap.get(current);
                  }
                  return nameMap.get(current) || "未分类";
                };
                const grouped: Record<string, typeof courses> = {};
                const uncategorized: typeof courses = [];
                for (const c of courses) {
                  if (c.category_id && nameMap.has(c.category_id)) {
                    const rootName = getRootName(c.category_id);
                    if (!grouped[rootName]) grouped[rootName] = [];
                    grouped[rootName].push(c);
                  } else {
                    uncategorized.push(c);
                  }
                }
                const groupNames = Object.keys(grouped);
                return (
                  <>
                    {groupNames.map(catName => (
                      <div key={catName} className="bg-bg-base rounded-lg border border-border p-4">
                        <h3 className="text-base font-bold text-primary mb-3 border-b border-border pb-2">
                          {catName}
                        </h3>
                        <div className="grid grid-cols-3 gap-3">
                          {grouped[catName].map(c => (
                            <CourseCardItem key={c.id} c={c} getCategoryPath={getCategoryPath} openEdit={openEdit} openAssign={openAssign} handleDeleteCourse={handleDeleteCourse} />
                          ))}
                        </div>
                      </div>
                    ))}
                    {uncategorized.length > 0 && (
                      <div className="bg-bg-base rounded-lg border border-border p-4">
                        <h3 className="text-base font-bold text-text-secondary mb-3 border-b border-border pb-2">
                          未分类
                        </h3>
                        <div className="grid grid-cols-3 gap-3">
                          {uncategorized.map(c => (
                            <CourseCardItem key={c.id} c={c} getCategoryPath={getCategoryPath} openEdit={openEdit} openAssign={openAssign} handleDeleteCourse={handleDeleteCourse} />
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          )}
        </div>
      </div>

      {/* 编辑弹窗 */}
      {showEditModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setShowEditModal(false)}>
          <div className="bg-bg-base rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h3 className="font-bold text-sm">{editingCourse ? "编辑课程" : "新增课程"}</h3>
              <button onClick={() => setShowEditModal(false)} className="text-text-secondary hover:text-text-base">
                <X size={18} />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {/* 基本信息 */}
              <div>
                <label className="block text-sm text-text-secondary mb-1">课程标题</label>
                <input
                  type="text" value={editTitle}
                  onChange={e => setEditTitle(e.target.value)}
                  className="w-full border border-border rounded-md px-3 py-2 text-sm"
                  placeholder="输入课程标题"
                />
              </div>
              <div>
                <label className="block text-sm text-text-secondary mb-1">
                  课程分类
                </label>
                {editingCourse || selectedId ? (
                  <input
                    type="text"
                    value={editingCourse ? getCategoryPath(editingCourse.category_id) : getCategoryPath(selectedId)}
                    disabled
                    className="w-full border border-border rounded-md px-3 py-2 text-sm bg-bg-layout text-text-secondary"
                  />
                ) : (
                  <div ref={categoryDropdownRef} className="relative">
                    <div
                      onClick={() => { setShowCategoryDropdown(!showCategoryDropdown); setCategorySearch(""); }}
                      className="w-full border border-border rounded-md px-3 py-2 text-sm cursor-pointer hover:border-primary/40 flex items-center justify-between"
                    >
                      <span className={editCategoryId ? "text-text-base" : "text-text-secondary"}>
                        {editCategoryId ? getCategoryPath(editCategoryId) : "请选择课程"}
                      </span>
                      <ChevronDown size={14} className={`text-text-secondary transition-transform ${showCategoryDropdown ? "rotate-180" : ""}`} />
                    </div>
                    {showCategoryDropdown && (
                      <div className="absolute top-full left-0 right-0 mt-1 bg-bg-base border border-border rounded-md shadow-lg z-10 p-2 space-y-2">
                        <input
                          type="text"
                          placeholder="搜索课程..."
                          value={categorySearch}
                          onChange={e => setCategorySearch(e.target.value)}
                          className="w-full border border-border rounded-md px-3 py-1.5 text-sm"
                          autoFocus
                        />
                        <div className="flex gap-2">
                          <div className="flex-1 border border-border rounded-md max-h-40 overflow-y-auto">
                            <div
                              onClick={() => { setEditCategoryId(""); setShowCategoryDropdown(false); }}
                              className={`px-3 py-1.5 text-sm cursor-pointer hover:bg-bg-layout ${
                                editCategoryId === "" ? "bg-primary/10 text-primary font-medium" : ""
                              }`}
                            >
                              未分类
                            </div>
                            {tree
                              .filter(n => !n.parent_id && (!categorySearch || n.name.toLowerCase().includes(categorySearch.toLowerCase())))
                              .map(root => (
                                <div
                                  key={root.id}
                                  onClick={() => {
                                    setEditCategoryId(root.id);
                                    if (root.children.length === 0) setShowCategoryDropdown(false);
                                  }}
                                  className={`px-3 py-1.5 text-sm cursor-pointer hover:bg-bg-layout flex items-center justify-between ${
                                    editCategoryId === root.id ? "bg-primary/10 text-primary font-medium" : ""
                                  }`}
                                >
                                  <span className="truncate">{root.name}</span>
                                  {root.children.length > 0 && (
                                    <ChevronRight size={12} className="text-text-secondary shrink-0 ml-1" />
                                  )}
                                </div>
                              ))}
                          </div>
                          {editCategoryId && (() => {
                            const selectedRoot = tree.find(n => n.id === editCategoryId);
                            if (!selectedRoot || selectedRoot.children.length === 0) return null;
                            const filteredChildren = categorySearch
                              ? selectedRoot.children.filter(c => c.name.toLowerCase().includes(categorySearch.toLowerCase()))
                              : selectedRoot.children;
                            return (
                              <div className="flex-1 border border-border rounded-md max-h-40 overflow-y-auto">
                                {filteredChildren.map(child => (
                                  <div
                                    key={child.id}
                                    onClick={() => { setEditCategoryId(child.id); setShowCategoryDropdown(false); }}
                                    className={`px-3 py-1.5 text-sm cursor-pointer hover:bg-bg-layout truncate ${
                                      editCategoryId === child.id ? "bg-primary/10 text-primary font-medium" : ""
                                    }`}
                                  >
                                    {child.name}
                                  </div>
                                ))}
                              </div>
                            );
                          })()}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div>
                <label className="block text-sm text-text-secondary mb-1">课程简介</label>
                <textarea
                  value={editDescription} onChange={e => setEditDescription(e.target.value)}
                  rows={3} placeholder="输入课程简介"
                  className="w-full border border-border rounded-md px-3 py-2 text-sm resize-none"
                />
              </div>

              {/* 计划日期 */}
              <div className="flex gap-4">
                <div className="flex-1">
                  <label className="block text-sm text-text-secondary mb-1">开始日期</label>
                  <input
                    type="date"
                    value={editStartDate}
                    onChange={e => setEditStartDate(e.target.value)}
                    className="w-full border border-border rounded-md px-3 py-2 text-sm"
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-sm text-text-secondary mb-1">结束日期</label>
                  <input
                    type="date"
                    value={editEndDate}
                    onChange={e => setEditEndDate(e.target.value)}
                    className="w-full border border-border rounded-md px-3 py-2 text-sm"
                  />
                </div>
              </div>

              {/* 分配学员 */}
              <div>
                <label className="block text-sm text-text-secondary mb-2">
                  分配学员
                  {(editSelectedUsers.size > 0 || editSelectedDepts.size > 0) && (
                    <span className="text-primary ml-1">
                      （已选 {editSelectedDepts.size + editSelectedUsers.size} 项）
                    </span>
                  )}
                </label>
                <div className="grid grid-cols-2 gap-3">
                  {/* 部门 */}
                  <div className="border border-border rounded-md p-2">
                    <input
                      type="text" placeholder="搜索部门..."
                      value={editDeptSearch} onChange={e => setEditDeptSearch(e.target.value)}
                      className="w-full border border-border rounded-md px-2 py-1 text-xs mb-1.5"
                    />
                    <div className="max-h-28 overflow-y-auto space-y-0.5">
                      {editAssignDepts.filter(d => d.name.includes(editDeptSearch)).map(d => {
                        const isActive = editActiveDeptId === d.id;
                        return (
                          <div key={d.id} className={`flex items-center gap-1.5 py-0.5 px-1 rounded text-xs ${
                            isActive ? "bg-primary/10" : "hover:bg-bg-layout"
                          }`}>
                            <input
                              type="checkbox"
                              checked={editSelectedDepts.has(d.id)}
                              onChange={() => {
                                const nextDepts = new Set(editSelectedDepts);
                                if (nextDepts.has(d.id)) {
                                  nextDepts.delete(d.id);
                                } else {
                                  nextDepts.add(d.id);
                                }
                                setEditSelectedDepts(nextDepts);
                              }}
                            />
                            <span
                              className="truncate flex-1 cursor-pointer"
                              onClick={() => setEditActiveDeptId(isActive ? null : d.id)}
                            >
                              {d.name}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  {/* 学员 */}
                  <div className="border border-border rounded-md p-2">
                    <input
                      type="text" placeholder="搜索姓名..."
                      value={editUserSearch} onChange={e => setEditUserSearch(e.target.value)}
                      className="w-full border border-border rounded-md px-2 py-1 text-xs mb-1.5"
                    />
                    <div className="max-h-28 overflow-y-auto space-y-0.5">
                      {(() => {
                        const activeDept = editActiveDeptId ? editAssignDepts.find(d => d.id === editActiveDeptId) : null;
                        const filtered = editAssignUsers.filter(u => {
                          if (activeDept && u.department !== activeDept.name) return false;
                          if (editUserSearch && !u.name.includes(editUserSearch) && !(u.department && u.department.includes(editUserSearch))) return false;
                          return true;
                        });
                        if (!activeDept) {
                          return <p className="text-xs text-text-secondary py-4 text-center">点击左侧部门名称查看学员</p>;
                        }
                        if (filtered.length === 0) {
                          return <p className="text-xs text-text-secondary py-2 text-center">该部门暂无用户</p>;
                        }
                        return (
                          <div>
                            <label className="flex items-center gap-1.5 py-0.5 px-1 hover:bg-bg-layout rounded text-xs cursor-pointer border-b border-border mb-0.5">
                              <input
                                type="checkbox"
                                checked={filtered.every(u => editSelectedUsers.has(u.id))}
                                onChange={() => {
                                  const allIds = new Set(filtered.map(u => u.id));
                                  const allSelected = filtered.every(u => editSelectedUsers.has(u.id));
                                  const next = new Set(editSelectedUsers);
                                  allSelected ? allIds.forEach(id => next.delete(id)) : allIds.forEach(id => next.add(id));
                                  setEditSelectedUsers(next);
                                }}
                              />
                              <span className="text-text-secondary">全选</span>
                            </label>
                            {filtered.map(u => (
                              <label key={u.id} className="flex items-center gap-1.5 py-0.5 px-1 hover:bg-bg-layout rounded text-xs cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={editSelectedUsers.has(u.id)}
                                  onChange={() => {
                                    const next = new Set(editSelectedUsers);
                                    next.has(u.id) ? next.delete(u.id) : next.add(u.id);
                                    setEditSelectedUsers(next);
                                  }}
                                />
                                <span className="truncate">{u.name}</span>
                                {u.department && <span className="text-text-secondary truncate">({u.department})</span>}
                              </label>
                            ))}
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                </div>
                {/* 分配结果摘要 */}
                {(editSelectedDepts.size > 0 || editSelectedUsers.size > 0) && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {[...editSelectedDepts].map(id => {
                      const d = editAssignDepts.find(dep => dep.id === id);
                      return d ? (
                        <span key={id} className="inline-flex items-center gap-1 px-2 py-0.5 bg-primary/10 text-primary rounded text-xs">
                          {d.name}（部门）
                        </span>
                      ) : null;
                    })}
                    {editAssignUsers.filter(u => editSelectedUsers.has(u.id) && !editSelectedDepts.has(
                      editAssignDepts.find(d => d.name === u.department)?.id || ""
                    )).map(u => (
                      <span key={u.id} className="inline-flex items-center gap-1 px-2 py-0.5 bg-bg-layout rounded text-xs">
                        {u.name}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* 已有视频（仅编辑模式） */}
              {editingCourse && editVideos.length > 0 && (
                <div>
                  <label className="block text-sm text-text-secondary mb-2">已有视频 ({editVideos.length})</label>
                  <div className="space-y-2 max-h-96 overflow-y-auto">
                    {editVideos.map((v, i) => (
                      <div key={v.id} className="py-1.5 px-3 bg-bg-layout rounded-md">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-sm truncate">
                            <span className="text-text-secondary mr-1.5">{i + 1}.</span>
                            {v.title}
                          </span>
                          <button onClick={() => handleDeleteVideo(v.id)} className="text-xs text-red-500 border border-red-200 rounded px-1.5 py-0.5 hover:bg-red-50 shrink-0 ml-2">删除</button>
                        </div>
                        <video
                          src={`/api/videos/stream/${v.obs_key}?token=${localStorage.getItem("lp_token") || ""}`}
                          controls
                          className="w-full rounded-md max-h-56 bg-black"
                          preload="metadata"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 拖拽上传区 */}
              <div>
                <label className="block text-sm text-text-secondary mb-2">
                  上传视频{pendingFiles.length > 0 ? ` (${pendingFiles.length} 个待上传)` : ""}
                </label>
                <div
                  className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
                    dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/40 hover:bg-bg-layout"
                  }`}
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={handleDrop}
                >
                  <Upload size={28} className="mx-auto text-text-secondary mb-2" />
                  <p className="text-sm text-text-secondary">点击选择文件或拖拽视频文件到此处</p>
                  <p className="text-xs text-text-secondary/60 mt-0.5">支持 MP4 / MOV / AVI / MKV</p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="video/mp4,video/mov,video/avi,video/mkv,video/webm"
                    multiple
                    className="hidden"
                    onChange={e => { if (e.target.files) handleFiles(e.target.files); }}
                  />
                </div>
              </div>

              {/* 待上传文件列表 */}
              {pendingFiles.length > 0 && (
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {pendingFiles.map((pf, i) => (
                    <div key={i} className="py-1.5 px-3 bg-bg-layout rounded-md">
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className="text-sm text-text-secondary truncate flex-1 min-w-0" title={pf.file.name}>
                          {pf.file.name}
                        </span>
                        <span className="text-xs text-text-secondary/60 shrink-0">
                          {(pf.file.size / 1024 / 1024).toFixed(1)} MB
                        </span>
                        {!pf.uploading && (
                          <>
                            <input
                              type="text"
                              value={pf.title}
                              onChange={e => updatePendingTitle(i, e.target.value)}
                              placeholder="视频标题"
                              className="w-44 border border-border rounded-md px-2 py-1 text-xs shrink-0"
                            />
                            <button
                              onClick={() => removePendingFile(i)}
                              className="text-red-400 hover:text-red-600 shrink-0 p-0.5 border border-red-200 rounded hover:bg-red-50"
                            >
                              <X size={14} />
                            </button>
                          </>
                        )}
                      </div>
                      {!pf.uploading && (
                        <video
                          src={getBlobUrl(pf.file)}
                          controls
                          className="w-full rounded-md max-h-56 bg-black"
                        />
                      )}
                      {pf.uploading && (
                        <div className="mt-1.5">
                          <div className="flex items-center justify-between text-xs text-text-secondary mb-0.5">
                            <span>上传中...</span>
                            <span>{pf.progress}%</span>
                          </div>
                          <div className="w-full h-1.5 bg-border rounded-full overflow-hidden">
                            <div
                              className="h-full bg-primary rounded-full transition-all duration-200"
                              style={{ width: `${pf.progress}%` }}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex gap-3 px-5 py-4 border-t border-border">
              <button onClick={() => handleSaveCourse("draft")} disabled={saving}
                className="px-4 py-2 rounded-md text-sm border border-border hover:bg-bg-layout">
                保存草稿
              </button>
              <button onClick={() => handleSaveCourse("published")} disabled={saving}
                className="px-4 py-2 rounded-md text-sm bg-primary text-white hover:bg-primary-light border border-primary">
                发布
              </button>
              <button onClick={() => setShowEditModal(false)}
                className="px-4 py-2 rounded-md text-sm text-text-secondary hover:text-text-base ml-auto border border-border">
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 分配弹窗 */}
      {showAssignModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setShowAssignModal(false)}>
          <div className="bg-bg-base rounded-lg shadow-xl w-full max-w-3xl max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h3 className="font-bold text-sm">分配课程: {assigningTitle}</h3>
              <button onClick={() => setShowAssignModal(false)} className="text-text-secondary hover:text-text-base">
                <X size={18} />
              </button>
            </div>

            <div className="p-5">
              <div className="grid grid-cols-2 gap-4">
                {/* 部门 */}
                <div className="bg-bg-base rounded-lg border border-border p-3">
                  <h4 className="font-bold text-sm mb-2">选择部门</h4>
                  <input
                    type="text" placeholder="搜索部门..."
                    value={deptSearch} onChange={e => setDeptSearch(e.target.value)}
                    className="w-full border border-border rounded-md px-3 py-1.5 text-sm mb-2"
                  />
                  <div className="max-h-52 overflow-y-auto space-y-1 mb-2">
                    {allDepts.filter(d => d.name.includes(deptSearch)).map(d => {
                      const isActive = activeDeptId === d.id;
                      return (
                        <div key={d.id} className={`flex items-center gap-2 py-1 px-2 rounded text-sm ${
                          isActive ? "bg-primary/10" : "hover:bg-bg-layout"
                        }`}>
                          <input
                            type="checkbox"
                            checked={selectedDepts.has(d.id)}
                            onChange={() => {
                              const nextDepts = new Set(selectedDepts);
                              if (nextDepts.has(d.id)) {
                                nextDepts.delete(d.id);
                              } else {
                                nextDepts.add(d.id);
                              }
                              setSelectedDepts(nextDepts);
                            }}
                          />
                          <span
                            className="flex-1 cursor-pointer"
                            onClick={() => setActiveDeptId(isActive ? null : d.id)}
                          >
                            {d.name}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* 学员 */}
                <div className="bg-bg-base rounded-lg border border-border p-3">
                  <h4 className="font-bold text-sm mb-2">
                    选择学员
                    {activeDeptId && (
                      <span className="text-text-secondary font-normal ml-1">
                        ({allDepts.find(d => d.id === activeDeptId)?.name || ""})
                      </span>
                    )}
                  </h4>
                  <input
                    type="text" placeholder="搜索姓名..."
                    value={userSearch} onChange={e => setUserSearch(e.target.value)}
                    className="w-full border border-border rounded-md px-3 py-1.5 text-sm mb-2"
                  />
                  <div className="max-h-52 overflow-y-auto space-y-1 mb-2">
                    {(() => {
                      const activeDept = activeDeptId ? allDepts.find(d => d.id === activeDeptId) : null;
                      const filtered = allUsers.filter(u => {
                        if (activeDept && u.department !== activeDept.name) return false;
                        if (userSearch && !u.name.includes(userSearch) && !(u.department && u.department.includes(userSearch))) return false;
                        return true;
                      });
                      if (!activeDept) {
                        return <p className="text-sm text-text-secondary py-4 text-center">点击左侧部门名称查看学员</p>;
                      }
                      if (filtered.length === 0) {
                        return <p className="text-sm text-text-secondary py-2 text-center">该部门暂无用户</p>;
                      }
                      return (
                        <div>
                          <label className="flex items-center gap-2 py-1 px-2 hover:bg-bg-layout rounded text-sm cursor-pointer border-b border-border mb-1">
                            <input
                              type="checkbox"
                              checked={filtered.every(u => selectedUsers.has(u.id))}
                              onChange={() => {
                                const allIds = new Set(filtered.map(u => u.id));
                                const allSelected = filtered.every(u => selectedUsers.has(u.id));
                                if (allSelected) {
                                  const next = new Set(selectedUsers);
                                  allIds.forEach(id => next.delete(id));
                                  setSelectedUsers(next);
                                } else {
                                  setSelectedUsers(new Set([...selectedUsers, ...allIds]));
                                }
                              }}
                            />
                            <span className="text-text-secondary text-xs">全选</span>
                          </label>
                          {filtered.map(u => (
                            <label key={u.id} className="flex items-center gap-2 py-1 px-2 hover:bg-bg-layout rounded text-sm cursor-pointer">
                              <input
                                type="checkbox"
                                checked={selectedUsers.has(u.id)}
                                onChange={() => {
                                  const next = new Set(selectedUsers);
                                  next.has(u.id) ? next.delete(u.id) : next.add(u.id);
                                  setSelectedUsers(next);
                                }}
                              />
                              <span>{u.name}</span>
                              {u.department && <span className="text-text-secondary text-xs">({u.department})</span>}
                            </label>
                          ))}
                        </div>
                      );
                    })()}
                  </div>
                </div>
              </div>

              {/* 分配结果摘要 */}
              {(selectedDepts.size > 0 || selectedUsers.size > 0) && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {[...selectedDepts].map(id => {
                    const d = allDepts.find(dep => dep.id === id);
                    return d ? (
                      <span key={id} className="inline-flex items-center gap-1 px-2 py-0.5 bg-primary/10 text-primary rounded text-xs">
                        {d.name}（部门）
                      </span>
                    ) : null;
                  })}
                  {allUsers.filter(u => selectedUsers.has(u.id) && !selectedDepts.has(
                    allDepts.find(d => d.name === u.department)?.id || ""
                  )).map(u => (
                    <span key={u.id} className="inline-flex items-center gap-1 px-2 py-0.5 bg-bg-layout rounded text-xs">
                      {u.name}
                    </span>
                  ))}
                </div>
              )}

              <button
                onClick={handleAssign}
                disabled={selectedUsers.size === 0 && selectedDepts.size === 0}
                className="mt-3 bg-primary text-white px-4 py-2 rounded-md text-sm disabled:opacity-50 border border-primary"
              >
                分配选中 ({selectedDepts.size + selectedUsers.size})
              </button>

              {/* 已分配 */}
              <div className="mt-4">
                <h4 className="font-bold text-sm mb-2">已分配</h4>
                {assignedUsers.length === 0 && assignedDepts.length === 0 ? (
                  <p className="text-sm text-text-secondary">暂无分配</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {assignedDepts.map(d => (
                      <span key={d.id} className="inline-flex items-center gap-1 px-2 py-1 bg-primary/10 text-primary rounded text-sm">
                        {d.name}（部门）
                        <button onClick={() => handleRemoveAssignment("dept", d.id)} className="text-red-400 hover:text-red-600 border border-red-200 rounded px-1 hover:bg-red-50">x</button>
                      </span>
                    ))}
                    {assignedUsers.map(u => (
                      <span key={u.id} className="inline-flex items-center gap-1 px-2 py-1 bg-bg-layout rounded text-sm">
                        {u.name}
                        <button onClick={() => handleRemoveAssignment("user", u.id)} className="text-red-400 hover:text-red-600 border border-red-200 rounded px-1 hover:bg-red-50">x</button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}