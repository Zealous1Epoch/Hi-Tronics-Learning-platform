/** 课程编辑页（课程管理重构 S6，替代旧的巨型编辑弹窗）
 *
 * 路由：/admin/courses/new（新建） · /admin/courses/:id/edit（编辑）
 * - 4 个 Tab：基本信息 / 课程内容（视频；章节勾选功能已按用户要求暂时下线）/ 课程分配 / 现场签到（开关开启才出现）
 * - 课程分配与用户管理同源：/org/members 全公司名册组织树，勾选只产 user_ids
 *   （存量「整部门分配」装载时展开为成员；保存覆盖后统一转成员口径）
 * - 右上角统一「保存草稿 / 发布」；表单/章节/学员/场次为暂存式，保存时一次性编排提交
 * - 视频是例外：逐文件即时上传落库（VideoManager）。新建态首次上传时由
 *   ensureDraftForUpload 静默创建课程草稿拿 ID（createdId 存内存，页面不重挂载，
 *   分配/场次等暂存态不丢）；之后的显式保存对该 ID 做 update，保存成功后
 *   navigate replace 到编辑路由（整页重挂载，从后端拉全量，状态天然干净）
 * - BrowserRouter 无 useBlocker：离开拦截用 beforeunload + 返回按钮 dirty 确认
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import PageHead from "../../components/ui/PageHead";
import TabBar from "../../components/ui/TabBar";
import DataPanel from "../../components/ui/DataPanel";
import StatusTag from "../../components/ui/StatusTag";
import CategorySelect from "../../components/course/CategorySelect";
import DeptUserPicker from "../../components/course/DeptUserPicker";
import DateField from "../../components/ui/DateField";
import VideoManager from "../../components/course/VideoManager";
import SessionInlineEditor, {
  type InlineSession, validateInlineSessions,
} from "../../components/attendance/SessionInlineEditor";
import AttendanceSessionModal, { toNaiveLocal } from "../../components/attendance/AttendanceSessionModal";
import { useToast } from "../../components/ui/Toast";
import { useConfirm } from "../../components/ui/Confirm";
import { api, type OrgMemberRow, type OrgMembersResponse } from "../../lib/api";
import {
  createCourse, createSession, deleteSession, getAssignments, getCourse, getCategoryFlat,
  getCategoryTree, listAllUsers, listSessions,
  postAssignments, removeAssignments, updateCourse, updateSession,
  type Course, type UserRow, type Video,
  type TreeNode, type FlatCategory,
} from "../../lib/courseApi";

/** ISO 时间串 → datetime-local 输入值（本地时区，精确到分钟） */
function toLocalInputVal(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

type TabKey = "basic" | "content" | "students" | "attendance";

export default function CourseEditorPage() {
  const navigate = useNavigate();
  const { id: routeId } = useParams();
  /** 新建模式为 null */
  const courseId = routeId ?? null;
  const toast = useToast();
  const confirm = useConfirm();

  // 基础数据（两模式都要）
  const [loading, setLoading] = useState(true);
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [flatCategories, setFlatCategories] = useState<FlatCategory[]>([]);
  /** 全公司名册（含无账号成员与不在名册的账号），课程分配选择器数据源 */
  const [members, setMembers] = useState<OrgMemberRow[]>([]);

  // 基本信息
  const [status, setStatus] = useState<string>("draft");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [requireAttendance, setRequireAttendance] = useState(false);

  // 课程内容
  const [selectedChapterIds, setSelectedChapterIds] = useState<Set<string>>(new Set());
  const [videos, setVideos] = useState<Video[]>([]);
  const [uploading, setUploading] = useState(false);

  // 课程分配（暂存，纯 user_ids）；existing 为上次落库口径，保存时先清旧再写新
  const [selectedUsers, setSelectedUsers] = useState<Set<string>>(new Set());
  const existingAssignments = useRef<{ user_ids: string[]; department_ids: string[] }>({ user_ids: [], department_ids: [] });

  // 现场签到（暂存）；loadedSessionIds 为已落库场次，保存时识别被删场次
  const [sessions, setSessions] = useState<InlineSession[]>([]);
  const loadedSessionIds = useRef<string[]>([]);

  const [activeTab, setActiveTab] = useState<TabKey>("basic");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  // 新建态自动建草稿：ID 先存内存（不导航不重挂载），显式保存后才 replace 到编辑路由
  const [createdId, setCreatedId] = useState<string | null>(null);
  const createdIdRef = useRef<string | null>(null);
  const creatingRef = useRef<Promise<string | null> | null>(null);
  /** 已落库的课程 ID：路由带 id 或自动建号成功后的内存 id */
  const effCourseId = courseId ?? createdId;
  // 完整场次管理弹窗（即时写库），与 Tab4 暂存并存
  const [attendanceModalOpen, setAttendanceModalOpen] = useState(false);

  const markDirty = () => setDirty(true);

  // ── 数据装载 ──
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      const base: [TreeNode[], FlatCategory[], UserRow[], OrgMembersResponse] = await Promise.all([
        getCategoryTree(), getCategoryFlat(), listAllUsers(), api<OrgMembersResponse>("/org/members"),
      ]);
      if (cancelled) return;
      setTree(base[0]);
      setFlatCategories(base[1]);
      setMembers([...base[3].members, ...base[3].unlinked_accounts]);
      if (courseId) {
        const [detail, assignments, sessionRows] = await Promise.all([
          getCourse(courseId), getAssignments(courseId), listSessions(courseId),
        ]);
        if (cancelled) return;
        applyCourse(detail);
        // 存量「整部门分配」展开为该部门（含子级命名口径）下的账号，统一转成员选择口径
        const deptUserIds = assignments.departments.flatMap(d =>
          base[2]
            .filter(u => u.department === d.name || (u.department || "").startsWith(d.name + "-"))
            .map(u => u.id));
        setSelectedUsers(new Set([...assignments.users.map(u => u.id), ...deptUserIds]));
        // 删除旧分配时按落库原样清（含 department 行），写入时只发 user_ids
        existingAssignments.current = {
          user_ids: assignments.users.map(u => u.id),
          department_ids: assignments.departments.map(d => d.id),
        };
        applySessions(sessionRows);
      }
      if (!cancelled) { setLoading(false); setDirty(false); }
    })().catch(e => {
      if (!cancelled) {
        toast.error(`加载课程数据失败：${e.message || e}`);
        setLoading(false);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId]);

  const applyCourse = (detail: Course) => {
    setStatus(detail.status);
    setTitle(detail.title);
    setDescription(detail.description || "");
    setCategoryId(detail.category_id || "");
    setStartDate((detail.start_date || "").slice(0, 10));
    setEndDate((detail.end_date || "").slice(0, 10));
    setRequireAttendance(Boolean(detail.require_attendance));
    setSelectedChapterIds(new Set((detail.chapters || []).map(ch => ch.id)));
    // 合并根级视频与章节内视频（与旧弹窗口径一致）
    setVideos([...(detail.videos || []), ...(detail.chapters || []).flatMap(ch => ch.videos)]);
  };

  /** 后端场次 → 内联编辑器暂存态（datetime-local 本地格式） */
  const applySessions = (rows: { id: string; title: string; start_time: string; end_time: string; location_name: string | null; late_after_minutes: number | null }[]) => {
    const inline: InlineSession[] = rows.map(s => ({
      id: s.id,
      title: s.title,
      start_time: toLocalInputVal(s.start_time),
      end_time: toLocalInputVal(s.end_time),
      location_name: s.location_name || "",
      late_after_minutes: s.late_after_minutes == null ? "" : String(s.late_after_minutes),
    }));
    setSessions(inline);
    loadedSessionIds.current = inline.map(s => s.id).filter(Boolean) as string[];
  };

  /** 打开完整场次弹窗（即时写库）：dirty 先确认，随后以服务端数据覆盖暂存态 */
  const openAttendanceModal = async () => {
    // 新建态：完整场次弹窗即时写库，需要课程 ID——与上传视频一样自动建草稿
    const cid = await ensureDraftForUpload();
    if (!cid) return;
    if (dirty) {
      const ok = await confirm({
        title: "打开完整场次弹窗",
        message: "该弹窗直接读写服务端数据。当前页面有未保存的修改，本地暂存的场次编辑将以服务端数据为准（可能被丢弃）。继续？",
        confirmText: "打开",
        danger: true,
      });
      if (!ok) return;
    }
    try {
      applySessions(await listSessions(cid));
      setAttendanceModalOpen(true);
    } catch (e: any) {
      toast.error(`加载场次失败：${e.message || e}`);
    }
  };

  const closeAttendanceModal = async () => {
    setAttendanceModalOpen(false);
    if (effCourseId) {
      // 弹窗内是即时写库，关闭后重拉保持两边一致
      try { applySessions(await listSessions(effCourseId)); } catch { /* 保留现状，下次保存时以后端为准 */ }
    }
  };

  // ── 离开拦截 ──
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const guardedBack = async () => {
    if (uploading) {
      toast.info("有视频正在上传，建议等待完成后再离开");
    }
    if (dirty) {
      const ok = await confirm({
        title: "放弃未保存的修改？",
        message: "当前编辑尚未保存，返回列表后修改将丢失。",
        confirmText: "放弃并返回",
        cancelText: "继续编辑",
        danger: true,
      });
      if (!ok) return;
      setDirty(false); // 放行后再导航
    }
    navigate("/admin/courses");
  };

  // 签到 Tab 只在开关开启时存在；关闭开关时把活动 Tab 拉回课程内容
  useEffect(() => {
    if (!requireAttendance && activeTab === "attendance") setActiveTab("content");
  }, [requireAttendance, activeTab]);

  const tabs = useMemo(() => {
    const items: { key: TabKey; label: string }[] = [
      { key: "basic", label: "基本信息" },
      { key: "content", label: "课程内容" },
      { key: "students", label: "课程分配" },
    ];
    if (requireAttendance) items.push({ key: "attendance", label: "现场签到" });
    return items;
  }, [requireAttendance]);

  /** 表单 → 课程本体 payload（显式保存与自动建草稿共用，口径唯一） */
  const buildPayload = (nextStatus: string) => ({
    title: title.trim(),
    require_attendance: requireAttendance,
    description: description || null,
    category_id: categoryId || null,
    start_date: startDate || null,
    end_date: endDate || null,
    status: nextStatus,
    chapter_ids: [...selectedChapterIds],
  });

  /**
   * 新建态上传视频前的静默建号：只落课程本体（draft），页面不重挂载，
   * 分配/场次等暂存态保留；并发调用共享同一个进行中的请求。
   * 返回 null 表示被拦截（无标题）或创建失败，调用方放弃本次上传。
   */
  const ensureDraftForUpload = async (): Promise<string | null> => {
    if (courseId) return courseId;
    if (createdIdRef.current) return createdIdRef.current;
    if (creatingRef.current) return creatingRef.current;
    if (!title.trim()) {
      toast.error("请先在「基本信息」填写课程标题——上传视频会自动创建课程");
      setActiveTab("basic");
      return null;
    }
    creatingRef.current = (async () => {
      try {
        const created = await createCourse(buildPayload("draft"));
        createdIdRef.current = created.id;
        setCreatedId(created.id);
        toast.success("已自动创建课程草稿，开始上传视频");
        return created.id;
      } catch (e: any) {
        toast.error(`自动创建课程失败：${e.message || e}`);
        return null;
      } finally {
        creatingRef.current = null;
      }
    })();
    return creatingRef.current;
  };

  // ── 保存编排 ──
  const save = async (nextStatus: string) => {
    if (!title.trim()) {
      toast.error("请填写课程标题");
      setActiveTab("basic");
      return;
    }
    if (startDate && endDate && endDate < startDate) {
      toast.error("结束日期不能早于开始日期");
      setActiveTab("basic");
      return;
    }
    if (requireAttendance) {
      if (sessions.length === 0) {
        toast.error("启用了「现场签到」必须至少配置 1 个签到场次");
        setActiveTab("attendance");
        return;
      }
      const sessionErr = validateInlineSessions(sessions);
      if (sessionErr) {
        toast.error(sessionErr);
        setActiveTab("attendance");
        return;
      }
    }
    if (saving) return;
    setSaving(true);
    try {
      // 1. 课程本体（章节为覆盖式 chapter_ids）
      const payload = buildPayload(nextStatus);
      // 自动建草稿可能正在进行（视频上传触发）：等它落库后转 update，避免重复建课
      let id = effCourseId ?? (creatingRef.current ? await creatingRef.current : null);
      if (id) {
        await updateCourse(id, payload);
      } else {
        const created = await createCourse(payload);
        id = created.id;
      }
      // 2. 分配：先清上次落库集合（含历史 department 行），再写本次选择。
      //    新口径只写 user_ids——部门维度由全公司名册在前端展开为成员
      const prev = existingAssignments.current;
      if (prev.user_ids.length > 0 || prev.department_ids.length > 0) {
        await removeAssignments(id, prev);
      }
      if (selectedUsers.size > 0) {
        await postAssignments(id, { user_ids: [...selectedUsers], department_ids: [] });
      }
      existingAssignments.current = { user_ids: [...selectedUsers], department_ids: [] };
      // 3. 签到场次（统一按北京时间 naive 提交）
      if (requireAttendance) {
        const bodyFor = (s: InlineSession) => ({
          title: s.title.trim(),
          start_time: toNaiveLocal(s.start_time),
          end_time: toNaiveLocal(s.end_time),
          location_name: s.location_name.trim() || null,
          late_after_minutes: s.late_after_minutes === "" ? null : Number(s.late_after_minutes),
          code_rotate_seconds: 30,
          dedupe_device: false,
        });
        const newIds: (string | undefined)[] = [];
        for (const s of sessions) {
          if (s.id) {
            await updateSession(s.id, bodyFor(s));
            newIds.push(s.id);
          } else {
            const created = await createSession(id, bodyFor(s));
            newIds.push(created.id);
          }
        }
        // 回填 id：避免再次保存时把已落库场次当新的重复创建
        setSessions(prev0 => prev0.map((s, i) => (s.id ? s : { ...s, id: newIds[i] })));
        const keptIds = new Set(newIds.filter(Boolean) as string[]);
        for (const oldId of loadedSessionIds.current) {
          if (keptIds.has(oldId)) continue;
          try {
            await deleteSession(oldId);
          } catch (e: any) {
            const msg = String(e?.message || e);
            if (msg.includes("签到记录")) {
              const ok = await confirm({
                title: "删除签到场次",
                message: "该场次已有签到记录，确定连记录一起删除吗？此操作不可恢复。",
                confirmText: "删除",
                danger: true,
              });
              if (ok) await deleteSession(oldId, true);
            } else {
              throw e;
            }
          }
        }
        loadedSessionIds.current = [...keptIds];
      }
      setStatus(nextStatus);
      setDirty(false);
      toast.success(nextStatus === "published" ? "已发布" : "草稿已保存");
      // 新建（含自动建号后转 update）：replace 到编辑路由。路由切换整页
      // 重挂载，所有数据从后端重拉；此时分配/场次均已落库，不会丢暂存态
      if (!courseId) navigate(`/admin/courses/${id}/edit`, { replace: true });
    } catch (e: any) {
      toast.error(`保存失败：${e.message || e}`);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="text-center">
          <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full mx-auto mb-3" />
          <p className="text-text-secondary text-sm">加载课程…</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHead
        title={courseId ? "编辑课程" : "新建课程"}
        description={
          dirty ? "有未保存的修改"
            : courseId ? "所有修改需点击右上角保存后生效"
            : "填好课程标题即可直接上传视频（首次上传会自动创建课程）"
        }
        back={{ onClick: guardedBack }}
        actions={
          <>
            {effCourseId && <StatusTag value={status} title="点击表格页状态标签可发布/下架" />}
            <button className="k-btn k-btn-default" disabled={saving} onClick={() => save("draft")}>
              保存草稿
            </button>
            <button className="k-btn k-btn-primary" disabled={saving} onClick={() => save("published")}>
              发布
            </button>
          </>
        }
      />

      <TabBar
        items={tabs}
        active={activeTab}
        onChange={(k) => setActiveTab(k as TabKey)}
      />

      <div className="mt-4">
        {activeTab === "basic" && (
          <DataPanel title="基本信息" bodyPadding={16} style={{ maxWidth: 720 }}>
            <div className="space-y-4">
              <div>
                <label className="k-label">课程标题 *</label>
                <input
                  type="text" value={title}
                  onChange={e => { setTitle(e.target.value); markDirty(); }}
                  className="k-input" placeholder="输入课程标题"
                />
              </div>
              <div>
                <label className="k-label">课程分类</label>
                <CategorySelect
                  tree={tree} flatCategories={flatCategories}
                  value={categoryId}
                  onChange={v => { setCategoryId(v); markDirty(); }}
                  allowCreate
                  onCreated={() => {
                    void Promise.all([getCategoryTree(), getCategoryFlat()])
                      .then(([t, flat]) => { setTree(t); setFlatCategories(flat); })
                      .catch(() => { /* 分类列表刷新失败不阻断填写，下次装载会兜底 */ });
                  }}
                />
              </div>
              <div>
                <label className="k-label">课程简介</label>
                <textarea
                  value={description} rows={3}
                  onChange={e => { setDescription(e.target.value); markDirty(); }}
                  className="k-textarea" placeholder="输入课程简介"
                />
              </div>
              <div className="flex gap-4">
                <div className="flex-1">
                  <label className="k-label">开始日期</label>
                  <DateField value={startDate} min={endDate || undefined}
                    onChange={v => { setStartDate(v); markDirty(); }} placeholder="选择开始日期（可选）" />
                </div>
                <div className="flex-1">
                  <label className="k-label">结束日期</label>
                  <DateField value={endDate} min={startDate || undefined}
                    onChange={v => { setEndDate(v); markDirty(); }} placeholder="选择结束日期（可选）" />
                </div>
              </div>
              <div>
                <label className="k-label">现场签到</label>
                <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox" role="switch"
                    checked={requireAttendance}
                    onChange={(e) => { setRequireAttendance(e.target.checked); markDirty(); }}
                    className="appearance-none w-9 h-5 rounded-full bg-border checked:bg-primary transition-colors relative
                               before:content-[''] before:absolute before:top-0.5 before:left-0.5 before:w-4 before:h-4
                               before:rounded-full before:bg-white before:transition-transform
                               checked:before:translate-x-4"
                  />
                  <span className="text-sm">启用现场签到</span>
                </label>
                <p className="text-xs text-text-secondary/70 mt-1.5">
                  {requireAttendance
                    ? "开启后学员可通过扫码/输码在现场签到；请在「现场签到」Tab 配置场次（签到不影响考试解锁）。"
                    : "关闭时课程为纯线上学习：学员看视频 → 考试，无签到环节。"}
                </p>
              </div>
            </div>
          </DataPanel>
        )}

        {activeTab === "content" && (
          <div className="space-y-4">
            <DataPanel
              title={<span>视频 {videos.length > 0 && <span className="text-text-secondary font-normal ml-1">（{videos.length} 个）</span>}</span>}
              bodyPadding={14}
              style={{ maxWidth: 860 }}
            >
              <VideoManager
                courseId={effCourseId}
                ensureCourseId={ensureDraftForUpload}
                videos={videos}
                onAdded={v => setVideos(prev => [...prev, v])}
                onDeleted={vid => setVideos(prev => prev.filter(v => v.id !== vid))}
                onRenamed={(vid, t) => setVideos(prev => prev.map(v => (v.id === vid ? { ...v, title: t } : v)))}
                onUploadingChange={setUploading}
              />
            </DataPanel>
          </div>
        )}

        {activeTab === "students" && (
          <DataPanel
            title={<span>课程分配 {selectedUsers.size > 0 && <span className="text-primary font-normal ml-1">（已选 {selectedUsers.size} 人）</span>}</span>}
            bodyPadding={16}
          >
            <div style={{ maxWidth: 900 }}>
              <DeptUserPicker
                members={members}
                selectedUsers={selectedUsers}
                onChange={users => { setSelectedUsers(users); markDirty(); }}
                listClass="max-h-[420px]"
              />
              <p className="text-xs text-text-secondary/70 mt-2">
                组织口径与用户管理的全公司名册一致；勾选部门连带其全部有账号成员，无账号人员需先在用户管理开通。分配结果在点击右上角保存后生效。
              </p>
            </div>
          </DataPanel>
        )}

        {activeTab === "attendance" && requireAttendance && (
          <DataPanel
            title="签到场次"
            extra={
              <span className="inline-flex items-center gap-3">
                <span className="text-xs text-text-secondary">共 {sessions.length} 场</span>
                <button className="k-btn k-btn-default k-btn-sm" onClick={openAttendanceModal}
                  title="直接读写服务端：定位/网络校验/设备去重/手动补签等完整功能">
                  完整场次管理
                </button>
              </span>
            }
            bodyPadding={16}
            style={{ maxWidth: 860 }}
          >
            <SessionInlineEditor
              sessions={sessions}
              onChange={next => { setSessions(next); markDirty(); }}
            />
            <p className="text-xs text-text-secondary/70 mt-3">
              场次为简化配置（名称/起止时间/地点/迟到阈值），动态码 30 秒轮换；防代签高级选项保持默认。保存后生效；
              需要定位/网络校验、手动补签等完整能力请用右上角「完整场次管理」（即时写库）。
            </p>
          </DataPanel>
        )}
      </div>

      {attendanceModalOpen && effCourseId && (
        <AttendanceSessionModal
          courseId={effCourseId}
          courseTitle={title}
          onClose={closeAttendanceModal}
        />
      )}
    </div>
  );
}
