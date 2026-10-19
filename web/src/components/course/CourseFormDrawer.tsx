/** 课程新建 / 编辑 · 右拉抽屉（单页分区：课程内容 → 课程信息 → 课程分配 [→ 现场签到]）
 *
 * 所有信息同页展示、不换面板：一个滚动面板内按分区排列，校验失败自动滚动定位。
 * 两种模式共用一套界面与上传动线（用户要求：编辑与新建界面一致）：
 * - 新建：不传 editCourseId。首次选文件静默创建课程草稿拿 ID（与编辑页
 *   ensureDraftForUpload 同套路），发布时才写入正式标题与信息。
 * - 编辑：传 editCourseId。挂载即装载课程详情/分配/场次——既有视频与课件
 *   直接进「已上传」列表（可预览、删除即时落库，与旧编辑页同口径）；
 *   分配装载含历史「整部门分配」展开为成员的兼容逻辑。
 * - 保存语义：编辑模式底栏恒有「保存」（维持当前状态，抽屉不关），
 *   状态为草稿时另有「发布」（终态达成即关）；新建模式「保存草稿/发布课程」。
 * - 签到是可选分区：开关打开才出现第 4 分区；场次为暂存式，
 *   保存时按编辑页同款编排（增改删 + 有签到记录删除的 force 二次确认）。
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { X, Upload, Film, FileText, Image as ImageIcon, Trash2, RotateCw } from "lucide-react";
import DeptUserPicker from "./DeptUserPicker";
import CategorySelect from "./CategorySelect";
import MaterialViewer, { type MaterialFile } from "./MaterialViewer";
import DateField from "../ui/DateField";
import StatusTag from "../ui/StatusTag";
import SessionInlineEditor, {
  type InlineSession, validateInlineSessions,
} from "../attendance/SessionInlineEditor";
import AttendanceSessionModal, { toNaiveLocal } from "../attendance/AttendanceSessionModal";
import { useToast } from "../ui/Toast";
import { useConfirm } from "../ui/Confirm";
import { api, type OrgMemberRow, type OrgMembersResponse } from "../../lib/api";
import type { TreeNode, FlatCategory } from "../CourseTree";
import {
  addVideo, createCourse, createSession, deleteMaterial, deleteSession, deleteVideo,
  getAssignments, getCategoryFlat, getCategoryTree, getCourse, getUploadToken,
  listAllUsers, listSessions, postAssignments, probeVideoDuration, removeAssignments,
  updateCourse, updateSession, uploadMaterial, uploadVideoRelay, uploadVideoToOSS, videoExtOf, videoStreamUrl,
  type CoursePayload, type SessionPayload,
} from "../../lib/courseApi";

type Kind = "video" | "material";

const VIDEO_EXTS = ["mp4", "mov", "avi", "mkv", "webm"];
/** 图片课件：与 PDF/PPT/HTML 同走 materials 上传接口，预览按 <img> 渲染 */
const IMAGE_EXTS = ["png", "jpg", "jpeg", "gif", "webp"];
const MATERIAL_EXTS = ["pdf", "ppt", "pptx", "html", "htm", ...IMAGE_EXTS];
const ACCEPT = [...VIDEO_EXTS, ...MATERIAL_EXTS].map(e => "." + e).join(",");

const extOfName = (name: string) => name.toLowerCase().split(".").pop() || "";

function kindOf(name: string): Kind | null {
  const ext = name.toLowerCase().split(".").pop() || "";
  if (VIDEO_EXTS.includes(ext)) return "video";
  if (MATERIAL_EXTS.includes(ext)) return "material";
  return null;
}

function stripExt(name: string): string {
  return name.replace(/\.[^.]+$/, "");
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** ISO 时间串 → datetime-local 输入值（本地时区，精确到分钟） */
function toLocalInputVal(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

interface UploadTask {
  key: number;
  file: File;
  cid: string;
  kind: Kind;
  progress: number;
  status: "uploading" | "error";
  error?: string;
}

interface UploadedItem {
  kind: Kind;
  id: string;
  name: string;
  size: number;
  /** 视频：OSS key，用于 videoStreamUrl 直接播 */
  obsKey?: string;
  /** 课件：扩展名，MaterialViewer 内嵌判定用 */
  fileType?: string;
}

function toMaterialFile(it: UploadedItem): MaterialFile {
  return { id: it.id, original_name: it.name, file_size: it.size, file_type: it.fileType || "" };
}

interface DrawerProps {
  /** 编辑模式传课程 ID；省略/为空 = 新建 */
  editCourseId?: string | null;
  onClose: () => void;
  /** 发布成功（关闭）或编辑保存成功（保持打开）后回调，列表页刷新 */
  onSaved: () => void;
  /** 列表页当前选中的分类：新建课程默认沿用，避免筛选状态下建出「未分类」 */
  defaultCategoryId?: string | null;
}

/** 分区标题（编号圆点 + 名称，右侧可挂操作按钮） */
function SectionHead({ n, title, extra }: { n: number; title: string; extra?: ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <div className="flex items-center gap-2">
        <span className="w-5 h-5 rounded-full bg-primary/10 text-primary text-xs flex items-center justify-center shrink-0">{n}</span>
        <h4 className="text-sm font-medium">{title}</h4>
      </div>
      {extra}
    </div>
  );
}

export default function CourseFormDrawer({ editCourseId = null, onClose, onSaved, defaultCategoryId = null }: DrawerProps) {
  const toast = useToast();
  const confirm = useConfirm();
  const isEdit = Boolean(editCourseId);

  // 进出场动画
  const [entered, setEntered] = useState(false);
  const [closing, setClosing] = useState(false);

  // 课程 ID：编辑模式即传即有；新建模式首次上传时静默落库
  const [courseId, setCourseId] = useState<string | null>(editCourseId);
  const courseIdRef = useRef<string | null>(editCourseId);
  const creatingRef = useRef<Promise<string | null> | null>(null);

  // 编辑模式装载态
  const [dataReady, setDataReady] = useState(!isEdit);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("draft");
  const dirtyRef = useRef(false);

  // 单页分区：校验失败滚动定位用
  const secRefs = useRef<Record<string, HTMLElement | null>>({});
  const gotoSection = (key: string) => {
    secRefs.current[key]?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // 分区1：上传队列、已传列表与下方预览（previewKey = `${kind}-${id}`）
  const [tasks, setTasks] = useState<UploadTask[]>([]);
  const [uploaded, setUploaded] = useState<UploadedItem[]>([]);
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const busyRef = useRef(false);
  const chainRef = useRef<Promise<void>>(Promise.resolve());
  const keySeq = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 分区2：课程信息（分类初值沿用列表页当前筛选的分类）
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [categoryId, setCategoryId] = useState<string>(defaultCategoryId ?? "");
  const [catTree, setCatTree] = useState<TreeNode[]>([]);
  const [catFlat, setCatFlat] = useState<FlatCategory[]>([]);
  const [requireAttendance, setRequireAttendance] = useState(false);

  // 章节归属（编辑模式回传存量，UI 不提供勾选——与旧编辑页"章节勾选已下线"口径一致）
  const chapterIdsRef = useRef<string[]>([]);

  // 签到场次（暂存式，保存时编排）；loadedSessionIds 为已落库场次
  const [sessions, setSessions] = useState<InlineSession[]>([]);
  const loadedSessionIds = useRef<string[]>([]);
  const [attendanceModalOpen, setAttendanceModalOpen] = useState(false);

  // 分区3：分配（单页形态挂载即拉名册）
  const [members, setMembers] = useState<OrgMemberRow[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const membersLoaded = useRef(false);
  const [selectedUsers, setSelectedUsers] = useState<Set<string>>(new Set());
  /** 上次落库口径（编辑模式装载），保存时先清旧再写新 */
  const existingAssignments = useRef<{ user_ids: string[]; department_ids: string[] }>({ user_ids: [], department_ids: [] });

  const [saving, setSaving] = useState(false);
  const publishedRef = useRef(false);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    busyRef.current = tasks.some(t => t.status === "uploading");
  }, [tasks]);

  const loadCategories = async () => {
    try {
      const [t, f] = await Promise.all([getCategoryTree(), getCategoryFlat()]);
      setCatTree(t);
      setCatFlat(f);
    } catch { /* 分类拉取失败不阻塞建课：下拉留空，可稍后补选 */ }
  };

  useEffect(() => {
    void loadCategories();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (membersLoaded.current) return;
    membersLoaded.current = true;
    setMembersLoading(true);
    api<OrgMembersResponse>("/org/members")
      .then(r => setMembers([...r.members, ...r.unlinked_accounts]))
      .catch(e => toast.error(`加载名册失败：${e.message || e}`))
      .finally(() => setMembersLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const touch = () => { dirtyRef.current = true; };

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

  // 编辑模式：挂载装载全量（详情/分配/场次/用户表——部门分配展开需要）
  useEffect(() => {
    if (!editCourseId) return;
    let cancelled = false;
    (async () => {
      try {
        const [detail, assignments, sessionRows, users] = await Promise.all([
          getCourse(editCourseId), getAssignments(editCourseId), listSessions(editCourseId), listAllUsers(),
        ]);
        if (cancelled) return;
        setStatus(detail.status);
        setTitle(detail.title);
        setDescription(detail.description || "");
        setCategoryId(detail.category_id || "");
        setStartDate((detail.start_date || "").slice(0, 10));
        setEndDate((detail.end_date || "").slice(0, 10));
        setRequireAttendance(Boolean(detail.require_attendance));
        chapterIdsRef.current = (detail.chapters || []).map(ch => ch.id);
        // 存量视频（根级 + 章节内）与课件进统一「已上传」列表，可预览可删
        const allVids = [...(detail.videos || []), ...(detail.chapters || []).flatMap(ch => ch.videos)];
        setUploaded([
          ...allVids.map(v => ({ kind: "video" as Kind, id: v.id, name: v.title, size: v.file_size ?? 0, obsKey: v.obs_key })),
          ...(detail.materials || []).map(m => ({ kind: "material" as Kind, id: m.id, name: m.original_name, size: m.file_size ?? 0, fileType: m.file_type })),
        ]);
        // 存量「整部门分配」展开为该部门（含子级命名口径）下的账号，统一转成员选择口径
        const deptUserIds = assignments.departments.flatMap(d =>
          users
            .filter(u => u.department === d.name || (u.department || "").startsWith(d.name + "-"))
            .map(u => u.id));
        setSelectedUsers(new Set([...assignments.users.map(u => u.id), ...deptUserIds]));
        // 删除旧分配时按落库原样清（含 department 行），写入时只发 user_ids
        existingAssignments.current = {
          user_ids: assignments.users.map(u => u.id),
          department_ids: assignments.departments.map(d => d.id),
        };
        applySessions(sessionRows);
        setDataReady(true);
        dirtyRef.current = false;
      } catch (e: any) {
        if (!cancelled) {
          setLoadError(String(e?.message || e));
          setDataReady(true);
        }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editCourseId]);

  const finish = () => {
    setClosing(true);
    setTimeout(onClose, 220);
  };

  /** 首次上传前静默建草稿（并发共享同一请求），失败返回 null 放弃本次上传 */
  const ensureDraft = (): Promise<string | null> => {
    if (courseIdRef.current) return Promise.resolve(courseIdRef.current);
    if (creatingRef.current) return creatingRef.current;
    creatingRef.current = (async () => {
      try {
        const created = await createCourse({
          title: title.trim() || "未命名课程",
          status: "draft",
          category_id: categoryId || null,
        });
        courseIdRef.current = created.id;
        setCourseId(created.id);
        return created.id;
      } catch (e: any) {
        toast.error(`创建课程草稿失败：${e.message || e}`);
        return null;
      } finally {
        creatingRef.current = null;
      }
    })();
    return creatingRef.current;
  };

  const patchTask = (key: number, patch: Partial<UploadTask>) =>
    setTasks(prev => prev.map(t => (t.key === key ? { ...t, ...patch } : t)));
  const dropTask = (key: number) => setTasks(prev => prev.filter(t => t.key !== key));

  /** 单文件上传：视频三步流 / 课件 multipart。失败置 error 可重试 */
  const runUpload = async (task: UploadTask) => {
    patchTask(task.key, { status: "uploading", progress: 0, error: undefined });
    try {
      if (task.kind === "video") {
        const ext = videoExtOf(task.file.name);
        const content_type = task.file.type || `video/${ext}`;
        const duration = await probeVideoDuration(task.file);
        let obsKey = "";
        try {
          // 首选浏览器直传 OSS（不走服务器带宽）
          const tok = await getUploadToken(ext, content_type);
          await uploadVideoToOSS(tok.upload_url, task.file, content_type,
            pct => patchTask(task.key, { progress: pct }));
          obsKey = tok.filename;
        } catch (ossErr) {
          // 直传不可用（OSS 凭证失效/内网/CORS 等，本地开发常见）→ 服务器中转回退
          console.warn("OSS 直传失败，改用服务器中转:", ossErr);
          const relayed = await uploadVideoRelay(task.file,
            pct => patchTask(task.key, { progress: pct }));
          obsKey = relayed.filename;
        }
        const created = await addVideo(task.cid, {
          title: stripExt(task.file.name),
          obs_key: obsKey,
          file_size: task.file.size,
          duration,
          chapter_id: null,
        });
        setUploaded(prev => [...prev, { kind: "video", id: created.id, name: created.title, size: task.file.size, obsKey }]);
        setPreviewKey(`video-${created.id}`);
      } else {
        const created = await uploadMaterial(task.cid, task.file,
          pct => patchTask(task.key, { progress: pct }));
        setUploaded(prev => [...prev, { kind: "material", id: created.id, name: created.original_name, size: task.file.size, fileType: created.file_type }]);
        setPreviewKey(`material-${created.id}`);
      }
      dropTask(task.key);
      touch();
    } catch (e: any) {
      patchTask(task.key, { status: "error", error: String(e?.message || e) });
    }
  };

  /** 串行队列：混合大文件时避免并发挤带宽，也便于失败单条重试 */
  const enqueue = (file: File, cid: string, kind: Kind) => {
    const t: UploadTask = { key: ++keySeq.current, file, cid, kind, progress: 0, status: "uploading" };
    setTasks(prev => [...prev, t]);
    chainRef.current = chainRef.current.then(() => runUpload(t));
  };

  const handleFiles = async (list: FileList) => {
    const files = Array.from(list);
    if (files.length === 0) return;
    const usable = files.filter(f => kindOf(f.name) !== null);
    const skipped = files.length - usable.length;
    if (skipped > 0) {
      const names = files.filter(f => kindOf(f.name) === null).map(f => f.name).slice(0, 3).join("、");
      toast.error(`已跳过 ${skipped} 个不支持的文件（${names}${skipped > 3 ? " 等" : ""}）`);
    }
    if (usable.length === 0) return;
    const cid = await ensureDraft();
    if (!cid) return;
    usable.forEach(f => enqueue(f, cid, kindOf(f.name)!));
  };

  const removeItem = async (it: UploadedItem) => {
    try {
      if (it.kind === "video") await deleteVideo(it.id);
      else await deleteMaterial(it.id);
      setUploaded(prev => prev.filter(x => !(x.kind === it.kind && x.id === it.id)));
      setPreviewKey(prev => (prev === `${it.kind}-${it.id}` ? null : prev));
      touch();
    } catch (e: any) {
      toast.error(`删除失败：${e.message || e}`);
    }
  };

  /** 打开完整场次弹窗（即时写库）：装载后以服务端数据覆盖暂存态 */
  const openAttendanceModal = async () => {
    const cid = await ensureDraft();
    if (!cid) return;
    try {
      applySessions(await listSessions(cid));
      dirtyRef.current = false;
      setAttendanceModalOpen(true);
    } catch (e: any) {
      toast.error(`加载场次失败：${e.message || e}`);
    }
  };

  const closeAttendanceModal = async () => {
    setAttendanceModalOpen(false);
    if (courseId) {
      // 弹窗内是即时写库，关闭后重拉保持两边一致
      try { applySessions(await listSessions(courseId)); } catch { /* 保留现状，下次保存时以后端为准 */ }
    }
  };

  const requestClose = async () => {
    if (busyRef.current) {
      const ok = await confirm({
        title: "关闭抽屉",
        message: "有文件正在上传，关闭会中断上传。仍要关闭？",
        confirmText: "关闭",
        cancelText: "继续上传",
        danger: true,
      });
      if (!ok) return;
    }
    if (isEdit && dirtyRef.current) {
      const ok = await confirm({
        title: "放弃未保存的修改？",
        message: "当前编辑尚未保存，关闭后表单与分配、场次的改动将丢失（已上传文件不受影响）。",
        confirmText: "放弃并关闭",
        cancelText: "继续编辑",
        danger: true,
      });
      if (!ok) return;
    }
    if (!isEdit && !publishedRef.current && uploaded.length > 0) {
      toast.info("已上传文件保存在课程草稿中，可在课程列表继续编辑");
    }
    finish();
  };

  /** 统一保存编排（新建发布 / 编辑保存、发布共用，口径唯一） */
  const submit = async (targetStatus: "draft" | "published") => {
    if (saving) return;
    if (!title.trim()) { gotoSection("info"); toast.error("请填写课程标题"); return; }
    if (startDate && endDate && endDate < startDate) { gotoSection("info"); toast.error("结束日期不能早于开始日期"); return; }
    if (busyRef.current) { gotoSection("content"); toast.info("还有文件正在上传，请等待完成后再保存"); return; }
    if (requireAttendance) {
      if (sessions.length === 0) {
        gotoSection("attendance"); toast.error("启用了「现场签到」必须至少配置 1 个签到场次"); return;
      }
      const sessionErr = validateInlineSessions(sessions);
      if (sessionErr) { gotoSection("attendance"); toast.error(sessionErr); return; }
    }
    setSaving(true);
    try {
      const payload: CoursePayload = {
        title: title.trim(),
        description: description.trim() || null,
        start_date: startDate || null,
        end_date: endDate || null,
        category_id: categoryId || null,
        require_attendance: requireAttendance,
        status: targetStatus,
        // 编辑模式回传存量章节归属（UI 不提供勾选，防止后端把关联清掉）
        ...(isEdit ? { chapter_ids: [...chapterIdsRef.current] } : {}),
      };
      // 草稿可能正在创建（上传触发）：等它落库后转 update，避免重复建课
      let id = courseIdRef.current ?? (creatingRef.current ? await creatingRef.current : null);
      if (id) {
        await updateCourse(id, payload);
      } else {
        id = (await createCourse(payload)).id;
        courseIdRef.current = id;
        setCourseId(id);
      }
      // 分配：编辑先清上次落库集合（含历史 department 行）再写本次；新建直接写
      if (isEdit) {
        const prev = existingAssignments.current;
        if (prev.user_ids.length > 0 || prev.department_ids.length > 0) {
          await removeAssignments(id, prev);
        }
        if (selectedUsers.size > 0) {
          await postAssignments(id, { user_ids: [...selectedUsers], department_ids: [] });
        }
        existingAssignments.current = { user_ids: [...selectedUsers], department_ids: [] };
      } else if (selectedUsers.size > 0) {
        await postAssignments(id, { user_ids: [...selectedUsers], department_ids: [] });
      }
      // 签到场次（统一按北京时间 naive 提交）
      if (requireAttendance) {
        const bodyFor = (s: InlineSession): SessionPayload => ({
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
      setStatus(targetStatus);
      dirtyRef.current = false;
      onSaved();
      if (targetStatus === "published") {
        publishedRef.current = true;
        toast.success(isEdit ? "已发布" : "课程已发布");
        finish();
      } else {
        toast.success(isEdit ? "已保存" : "草稿已保存，可在课程列表继续编辑");
        if (!isEdit) finish();
      }
    } catch (e: any) {
      toast.error(`保存失败：${e.message || e}`);
    } finally {
      setSaving(false);
    }
  };

  const shifted = entered && !closing;
  const previewItem = previewKey ? uploaded.find(x => `${x.kind}-${x.id}` === previewKey) || null : null;
  const videoCount = uploaded.filter(x => x.kind === "video").length;
  const materialCount = uploaded.length - videoCount;

  return (
    <div
      className="fixed inset-0"
      style={{ zIndex: 60, background: "rgba(20, 20, 19, 0.32)", opacity: shifted ? 1 : 0, transition: "opacity 200ms ease" }}
      onClick={requestClose}
    >
      <div
        className="absolute top-0 right-0 h-full flex flex-col border-l border-border"
        style={{
          width: "min(680px, 96vw)",
          background: "var(--color-bg-card)",
          boxShadow: "-12px 0 32px rgba(0,0,0,0.12)",
          transform: shifted ? "translateX(0)" : "translateX(100%)",
          transition: "transform 220ms ease",
        }}
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-label={isEdit ? "编辑课程" : "新建课程"}
      >
        {/* 标题栏 */}
        <div className="shrink-0 flex items-center justify-between px-5 h-12 border-b border-border">
          <div className="flex items-center gap-3 min-w-0">
            <h3 className="text-sm font-medium shrink-0" style={{ color: "var(--color-primary)" }}>{isEdit ? "编辑课程" : "新建课程"}</h3>
            {isEdit && courseId && <StatusTag value={status} />}
          </div>
          <button type="button" onClick={requestClose} className="text-text-secondary hover:text-text-base" aria-label="关闭">
            <X size={16} />
          </button>
        </div>

        {/* 单页表单：所有分区同屏展示，整页滚动 */}
        <div className="flex-1 min-h-0 overflow-y-auto k-scroll px-5 py-4">
          {!dataReady ? (
            <p className="text-sm text-text-secondary py-10 text-center">加载课程…</p>
          ) : loadError ? (
            <p className="text-sm text-red-500 py-10 text-center">加载失败：{loadError}</p>
          ) : (
            <div className="space-y-7">
              {/* 1 课程内容：拖拽上传 + 队列 + 已上传（点击行即在下方预览） */}
              <section ref={el => { secRefs.current.content = el; }}>
                <SectionHead n={1} title="课程内容" />
                <div className="space-y-3">
                  <div
                    className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors cursor-pointer ${
                      dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/40 hover:bg-bg-layout"
                    }`}
                    onClick={() => fileInputRef.current?.click()}
                    onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={e => {
                      e.preventDefault();
                      setDragOver(false);
                      if (e.dataTransfer.files.length > 0) void handleFiles(e.dataTransfer.files);
                    }}
                  >
                    <Upload size={24} className="mx-auto text-text-secondary mb-1.5" />
                    <p className="text-sm text-text-secondary">点击选择文件，或拖拽到此处</p>
                    <p className="text-xs text-text-secondary/60 mt-1">
                      支持视频（MP4 / MOV / AVI / MKV / WEBM）与课件（PDF / PPT / PPTX / HTML / PNG / JPG 等图片），选择后立即上传
                    </p>
                    <input
                      ref={fileInputRef} type="file" accept={ACCEPT} multiple className="hidden"
                      onChange={e => { if (e.target.files) void handleFiles(e.target.files); e.target.value = ""; }}
                    />
                  </div>

                  {/* 上传队列 */}
                  {tasks.map(t => (
                    <div key={t.key} className="py-1.5 px-3 bg-bg-layout rounded-md">
                      <div className="flex items-center gap-2">
                        {t.kind === "video"
                          ? <Film size={13} className="text-text-secondary shrink-0" />
                          : IMAGE_EXTS.includes(extOfName(t.file.name))
                            ? <ImageIcon size={13} className="text-text-secondary shrink-0" />
                            : <FileText size={13} className="text-text-secondary shrink-0" />}
                        <span className="text-sm text-text-secondary truncate flex-1 min-w-0" title={t.file.name}>{t.file.name}</span>
                        <span className="text-xs text-text-secondary/60 shrink-0">{fmtSize(t.file.size)}</span>
                        {t.status === "error" && (
                          <button type="button" onClick={() => { dropTask(t.key); enqueue(t.file, t.cid, t.kind); }} className="k-btn k-btn-sm k-btn-default shrink-0" title="重试">
                            <RotateCw size={12} />
                          </button>
                        )}
                        {t.status === "error" && (
                          <button type="button" onClick={() => dropTask(t.key)}
                            className="text-red-400 hover:text-red-600 shrink-0 p-0.5 border border-red-200 rounded hover:bg-red-50" aria-label="移除">
                            <X size={13} />
                          </button>
                        )}
                      </div>
                      {t.status === "uploading" && (
                        <div className="mt-1.5">
                          <div className="flex items-center justify-between text-xs text-text-secondary mb-0.5">
                            <span>上传中...</span>
                            <span>{t.progress}%</span>
                          </div>
                          <div className="w-full h-1.5 bg-border rounded-full overflow-hidden">
                            <div className="h-full bg-primary rounded-full transition-all duration-200" style={{ width: `${t.progress}%` }} />
                          </div>
                        </div>
                      )}
                      {t.status === "error" && <p className="mt-1 text-xs text-red-500">上传失败：{t.error}</p>}
                    </div>
                  ))}

                  {/* 已上传：点击行即在下方预览（视频直接播 / 课件内嵌查看器） */}
                  {uploaded.length > 0 && (
                    <div>
                      <label className="k-label">
                        已上传（视频 {videoCount} · 课件 {materialCount}）
                      </label>
                      <div className="space-y-1.5">
                        {uploaded.map(it => {
                          const pkey = `${it.kind}-${it.id}`;
                          const isPreview = previewKey === pkey;
                          return (
                            <div key={pkey} onClick={() => setPreviewKey(isPreview ? null : pkey)}
                              className={`flex items-center gap-2 py-1.5 px-3 rounded-md cursor-pointer border-l-2 transition-colors ${
                                isPreview ? "bg-primary/5 border-l-primary" : "bg-bg-layout border-l-transparent hover:bg-border/50"
                              }`}
                              title={isPreview ? "收起预览" : "点击预览"}>
                              {it.kind === "video"
                                ? <Film size={13} className="text-primary shrink-0" />
                                : IMAGE_EXTS.includes((it.fileType || "").toLowerCase())
                                  ? <ImageIcon size={13} className="text-primary shrink-0" />
                                  : <FileText size={13} className="text-primary shrink-0" />}
                              <span className="text-sm truncate flex-1 min-w-0" title={it.name}>{it.name}</span>
                              <span className="text-xs text-text-secondary/60 shrink-0">{fmtSize(it.size)}</span>
                              <button type="button" onClick={e => { e.stopPropagation(); void removeItem(it); }}
                                className="text-text-secondary hover:text-danger shrink-0 p-0.5" title="删除">
                                <Trash2 size={13} />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                      {previewItem && (
                        <div className="mt-2 rounded-md border border-border overflow-hidden bg-bg-layout">
                          {previewItem.kind === "video" ? (
                            previewItem.obsKey ? (
                              <video key={previewItem.id} controls className="w-full max-h-[75vh] bg-black"
                                src={videoStreamUrl(previewItem.obsKey)} />
                            ) : (
                              <p className="p-6 text-center text-sm text-text-secondary">视频缺少存储信息，无法预览</p>
                            )
                          ) : (
                            <div className="h-[75vh]">
                              <MaterialViewer key={previewItem.id} material={toMaterialFile(previewItem)} />
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {courseId && !isEdit && (
                    <p className="text-xs text-text-secondary/70">内容已挂在课程草稿上，发布后生效</p>
                  )}
                </div>
              </section>

              {/* 2 课程信息 */}
              <section ref={el => { secRefs.current.info = el; }}>
                <SectionHead n={2} title="课程信息" />
                <div className="space-y-4">
                  <div>
                    <label className="k-label">课程标题 *</label>
                    <input
                      type="text" value={title} onChange={e => { setTitle(e.target.value); touch(); }}
                      className="k-input" placeholder="输入课程标题"
                    />
                  </div>
                  <div>
                    <label className="k-label">课程分类</label>
                    <CategorySelect
                      tree={catTree} flatCategories={catFlat}
                      value={categoryId} onChange={v => { setCategoryId(v); touch(); }}
                      placeholder="未分类" allowCreate
                      onCreated={() => void loadCategories()}
                    />
                  </div>
                  <div>
                    <label className="k-label">课程简介</label>
                    <textarea
                      value={description} rows={3} onChange={e => { setDescription(e.target.value); touch(); }}
                      className="k-textarea" placeholder="输入课程简介"
                    />
                  </div>
                  <div className="flex gap-4">
                    <div className="flex-1">
                      <label className="k-label">开始日期</label>
                      <DateField value={startDate} max={endDate || undefined}
                        onChange={v => { setStartDate(v); touch(); }} placeholder="选择开始日期（可选）" />
                    </div>
                    <div className="flex-1">
                      <label className="k-label">结束日期</label>
                      <DateField value={endDate} min={startDate || undefined}
                        onChange={v => { setEndDate(v); touch(); }} placeholder="选择结束日期（可选）" />
                    </div>
                  </div>
                  <div>
                    <label className="k-label">现场签到</label>
                    <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox" role="switch"
                        checked={requireAttendance}
                        onChange={(e) => { setRequireAttendance(e.target.checked); touch(); }}
                        className="appearance-none w-9 h-5 rounded-full bg-border checked:bg-primary transition-colors relative
                                   before:content-[''] before:absolute before:top-0.5 before:left-0.5 before:w-4 before:h-4
                                   before:rounded-full before:bg-white before:transition-transform
                                   checked:before:translate-x-4"
                      />
                      <span className="text-sm">启用现场签到</span>
                    </label>
                  </div>
                </div>
              </section>

              {/* 3 课程分配 */}
              <section ref={el => { secRefs.current.assign = el; }}>
                <SectionHead n={3} title="课程分配" extra={
                  selectedUsers.size > 0 ? (
                    <span className="text-xs text-primary">已选 {selectedUsers.size} 人</span>
                  ) : undefined
                } />
                {membersLoading ? (
                  <p className="text-sm text-text-secondary py-6 text-center">加载名册…</p>
                ) : members.length === 0 ? (
                  <p className="text-sm text-text-secondary py-6 text-center">名册加载失败，关闭抽屉后重新打开可重试</p>
                ) : (
                  <DeptUserPicker
                    members={members}
                    selectedUsers={selectedUsers}
                    onChange={users => { setSelectedUsers(users); touch(); }}
                    listClass="max-h-[44vh]"
                  />
                )}
              </section>

              {/* 4 现场签到（可选分区，开关打开才出现） */}
              {requireAttendance && (
                <section ref={el => { secRefs.current.attendance = el; }}>
                  <SectionHead n={4} title="现场签到" extra={
                    <button type="button" className="k-btn k-btn-sm k-btn-default" onClick={openAttendanceModal}
                      title="直接读写服务端：定位/网络校验/设备去重/手动补签等完整功能">
                      完整场次管理
                    </button>
                  } />
                  <div className="space-y-3">
                    <SessionInlineEditor
                      sessions={sessions}
                      onChange={next => { setSessions(next); touch(); }}
                    />
                    <p className="text-xs text-text-secondary/70">
                      场次为简化配置（名称/起止时间/地点/迟到阈值），动态码 30 秒轮换；防代签高级选项保持默认，保存后生效。
                      需要定位/网络校验、手动补签等完整能力请用「完整场次管理」（即时写库）。
                    </p>
                  </div>
                </section>
              )}
            </div>
          )}
        </div>

        {/* 底栏 */}
        <div className="shrink-0 h-14 border-t border-border px-5 flex items-center justify-end gap-2">
          {isEdit ? (
            <>
              <button type="button" className="k-btn k-btn-default" disabled={saving} onClick={() => void submit(status as "draft" | "published")}>
                {saving ? "保存中…" : "保存"}
              </button>
              {status === "draft" && (
                <button type="button" className="k-btn k-btn-primary" disabled={saving} onClick={() => void submit("published")}>
                  发布
                </button>
              )}
            </>
          ) : (
            <>
              <button type="button" className="k-btn k-btn-default" disabled={saving} onClick={() => void submit("draft")}>
                保存草稿
              </button>
              <button type="button" className="k-btn k-btn-primary" disabled={saving} onClick={() => void submit("published")}>
                {saving ? "发布中…" : "发布课程"}
              </button>
            </>
          )}
        </div>
      </div>

      {attendanceModalOpen && courseId && (
        <AttendanceSessionModal
          courseId={courseId}
          courseTitle={title}
          onClose={closeAttendanceModal}
        />
      )}
    </div>
  );
}
