/** 课程新建 / 编辑 · 右拉抽屉（单页分区：课程内容 → 课程信息 → 课程分配）
 *
 * 所有信息同页展示、不换面板：一个滚动面板内按分区排列，校验失败自动滚动定位。
 * 两种模式共用一套界面与上传动线（用户要求：编辑与新建界面一致）：
 * - 新建流程独有「一键创建考试」开关（分区4，仅新建模式）：勾选后抽屉变分步模式，
 *   顶部出现「课程 → 出题 → 试卷 → 考试」步骤进度条，课程保存后紧接着
 *   POST /exams/quick-create 一次完成「试卷入库（published）+ 建考试绑本课」。
 * - 新建：不传 editCourseId。首次选文件静默创建课程草稿拿 ID（与编辑页
 *   ensureDraftForUpload 同套路），发布时才写入正式标题与信息。
 * - 编辑：传 editCourseId。挂载即装载课程详情/分配——既有视频与课件
 *   直接进「已上传」列表（可预览、删除即时落库，与旧编辑页同口径）；
 *   分配装载含历史「整部门分配」展开为成员的兼容逻辑。
 * - 保存语义：编辑模式底栏恒有「保存」（维持当前状态，抽屉不关），
 *   状态为草稿时另有「发布」（终态达成即关）；新建模式「保存草稿/发布课程」。
 * - 签到不在本抽屉配置（2026-10-19 起）：任何课程都可签到，入口是课程列表
 *   操作列的「签到」按钮（AttendanceSessionModal：场次列表 + 名单/补签/导出）。
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { X, Upload, Film, FileText, Image as ImageIcon, Trash2, RotateCw } from "lucide-react";
import DeptUserPicker from "./DeptUserPicker";
import CategorySelect from "./CategorySelect";
import MaterialViewer, { type MaterialFile } from "./MaterialViewer";
import QuestionPickerPanel, { type PickedQuestion, TYPE_LABELS, DIFF_LABELS } from "../exam/QuestionPickerPanel";
import RandomRulesPanel, { type RandomRule } from "../exam/RandomRulesPanel";
import AIGenerateModal from "../question/AIGenerateModal";
import ImportQuestionsModal from "../question/ImportQuestionsModal";
import DateField, { DateTimeField } from "../ui/DateField";
import StatusTag from "../ui/StatusTag";
import { useToast } from "../ui/Toast";
import { useConfirm } from "../ui/Confirm";
import { api, type OrgMemberRow, type OrgMembersResponse } from "../../lib/api";
import type { TreeNode, FlatCategory } from "../CourseTree";
import {
  addVideo, createCourse, deleteMaterial, deleteVideo,
  getAssignments, getCategoryFlat, getCategoryTree, getCourse, getUploadToken,
  listAllUsers, postAssignments, probeVideoDuration, removeAssignments,
  updateCourse, uploadMaterial, uploadVideoRelay, uploadVideoToOSS, videoExtOf, videoStreamUrl,
  type CoursePayload,
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

  // 章节归属（编辑模式回传存量，UI 不提供勾选——与旧编辑页"章节勾选已下线"口径一致）
  const chapterIdsRef = useRef<string[]>([]);

  // 分区3：分配（单页形态挂载即拉名册）
  const [members, setMembers] = useState<OrgMemberRow[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const membersLoaded = useRef(false);
  const [selectedUsers, setSelectedUsers] = useState<Set<string>>(new Set());
  /** 上次落库口径（编辑模式装载），保存时先清旧再写新 */
  const existingAssignments = useRef<{ user_ids: string[]; department_ids: string[] }>({ user_ids: [], department_ids: [] });

  // 分区4：一键创建考试（仅新建流程）。勾选后抽屉进入分步模式，按出题→试卷→考试推进，
  // 末步一次提交：课程先落库（submit quiet 模式），再 quick-create 建考试+试卷入库
  const [withExam, setWithExam] = useState(false);
  const [examStep, setExamStep] = useState(0); // 0 课程 1 出题 2 试卷 3 考试（仅 withExam 时 >0）
  const [examTab, setExamTab] = useState<"bank_fixed" | "bank_random">("bank_fixed");
  const [qCat, setQCat] = useState<string | null>(null);
  const [picked, setPicked] = useState<PickedQuestion[]>([]);
  const [splitTarget, setSplitTarget] = useState(100);
  const [randBanks, setRandBanks] = useState<string[]>([]);
  const [randRules, setRandRules] = useState<RandomRule[]>([]);
  const [pickerRefreshKey, setPickerRefreshKey] = useState(0);
  const [showAI, setShowAI] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [aiEnabled, setAiEnabled] = useState(false);
  const aiProbed = useRef(false);
  const [paperName, setPaperName] = useState("");
  const [examTitle, setExamTitle] = useState("");
  const [exDuration, setExDuration] = useState(60);
  const [exMaxAttempts, setExMaxAttempts] = useState("");
  const [exStart, setExStart] = useState("");
  const [exEnd, setExEnd] = useState("");
  const [exPass, setExPass] = useState("");

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

  // ── 一键建考：派生与步骤推进 ──
  // AI 出题可用性：首次开启时探测一次（与试题管理/建考向导同一门控口径）
  useEffect(() => {
    if (!withExam || aiProbed.current) return;
    aiProbed.current = true;
    api<{ enabled: boolean }>("/ai/status").then(s => setAiEnabled(s.enabled)).catch(() => setAiEnabled(false));
  }, [withExam]);

  const allScoresSet = picked.length > 0 && picked.every(q => q.score > 0);
  const examTotal = examTab === "bank_fixed"
    ? (allScoresSet ? picked.reduce((s, q) => s + q.score, 0) : splitTarget)
    : randRules.reduce((s, r) => s + r.count * (r.score || 0), 0);
  const contentReady = examTab === "bank_fixed"
    ? picked.length > 0
    : randRules.length > 0 && randRules.every(r => r.score > 0);
  const passDefault = Math.max(1, Math.round(examTotal * 0.6));
  const passScoreInput = exPass.trim() === "" ? passDefault : (parseInt(exPass) || 0);

  const toggleExamFlow = (on: boolean) => {
    setWithExam(on);
    setExamStep(on ? 1 : 0);
  };

  /** 步间跳转：进入试卷/考试步时按课程标题预填默认名 */
  const gotoExamStep = (i: number) => {
    if (i === 2 && !paperName.trim()) setPaperName(`${title.trim() || "新课程"}测试卷`);
    if (i === 3 && !examTitle.trim()) setExamTitle(`${title.trim() || "新课程"}考试`);
    setExamStep(i);
  };

  // 编辑模式：挂载装载全量（详情/分配/用户表——部门分配展开需要）
  useEffect(() => {
    if (!editCourseId) return;
    let cancelled = false;
    (async () => {
      try {
        const [detail, assignments, users] = await Promise.all([
          getCourse(editCourseId), getAssignments(editCourseId), listAllUsers(),
        ]);
        if (cancelled) return;
        setStatus(detail.status);
        setTitle(detail.title);
        setDescription(detail.description || "");
        setCategoryId(detail.category_id || "");
        setStartDate((detail.start_date || "").slice(0, 10));
        setEndDate((detail.end_date || "").slice(0, 10));
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
    if (withExam && examStep > 0 && (picked.length > 0 || randRules.length > 0)) {
      const ok = await confirm({
        title: "关闭抽屉",
        message: "考试尚未创建，已选的出题/试卷配置将丢弃（课程草稿与已传文件不受影响）。仍要关闭？",
        confirmText: "放弃考试并关闭",
        cancelText: "继续配置",
        danger: true,
      });
      if (!ok) return;
    }
    if (!isEdit && !publishedRef.current && uploaded.length > 0) {
      toast.info("已上传文件保存在课程草稿中，可在课程列表继续编辑");
    }
    finish();
  };

  /** 统一保存编排（新建发布 / 编辑保存、发布 / 一键建考组合流共用，口径唯一）
   * quiet=true：保存成功只返回课程 ID，不 toast/不关闭/不回调 onSaved（供 finishWithExam 续挂建考） */
  const submit = async (targetStatus: "draft" | "published", opts: { quiet?: boolean } = {}): Promise<string | null> => {
    if (saving) return null;
    if (!title.trim()) { gotoSection("info"); toast.error("请填写课程标题"); return null; }
    if (startDate && endDate && endDate < startDate) { gotoSection("info"); toast.error("结束日期不能早于开始日期"); return null; }
    if (busyRef.current) { gotoSection("content"); toast.info("还有文件正在上传，请等待完成后再保存"); return null; }
    setSaving(true);
    try {
      // 不携带 require_attendance：签到与课程类型解绑，由列表「签到」按钮独立管理
      const payload: CoursePayload = {
        title: title.trim(),
        description: description.trim() || null,
        start_date: startDate || null,
        end_date: endDate || null,
        category_id: categoryId || null,
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
      setStatus(targetStatus);
      dirtyRef.current = false;
      // quiet：课程已落库，交由调用方（一键建考组合流）继续建考试，此处不 toast/不关闭
      if (opts.quiet) return id;
      onSaved();
      if (targetStatus === "published") {
        publishedRef.current = true;
        toast.success(isEdit ? "已发布" : "课程已发布");
        finish();
      } else {
        toast.success(isEdit ? "已保存" : "草稿已保存，可在课程列表继续编辑");
        if (!isEdit) finish();
      }
      return id;
    } catch (e: any) {
      toast.error(`保存失败：${e.message || e}`);
      return null;
    } finally {
      setSaving(false);
    }
  };

  /** 一键建考末步提交：课程先落库（quiet），再 POST /exams/quick-create 建试卷（published 入库）+考试。
   * 课程成功而考试失败时不白关——toast 指明课程已保存，考试可去考试管理重试 */
  const finishWithExam = async (targetStatus: "draft" | "published") => {
    if (saving) return;
    if (!contentReady) { setExamStep(1); toast.error("请先在「出题」步选题或配置随机抽题规则"); return; }
    if (!paperName.trim()) { setExamStep(2); toast.error("请填写试卷名称"); return; }
    if (!examTitle.trim()) { toast.error("请填写考试名称"); return; }
    if (exStart && exEnd && exStart >= exEnd) { toast.error("开放时间必须早于截止时间"); return; }
    const id = await submit(targetStatus, { quiet: true });
    if (!id) return;
    const content = examTab === "bank_fixed"
      ? {
          source: "bank", paper_type: "fixed",
          questions: picked.map(q => ({ question_id: q.question_id, score: allScoresSet ? q.score : 0 })),
          category_id: qCat,
        }
      : {
          source: "bank", paper_type: "random",
          random_rules: randRules,
          source_banks: randBanks.length ? randBanks : null,
        };
    try {
      const res = await api<{ replaced_exam_title: string | null }>("/exams/quick-create", {
        method: "POST",
        body: JSON.stringify({
          title: examTitle.trim(),
          course_id: id,
          content,
          duration: exDuration,
          publish: targetStatus === "published",
          save_paper_as: paperName.trim(),
          // 未逐题设分值 → 传平摊目标；及格分被手改 → 传值（与一键建考向导同口径）
          ...(examTab === "bank_fixed" && !allScoresSet ? { total_score: splitTarget } : {}),
          ...(exPass.trim() !== "" ? { pass_score: passScoreInput } : {}),
          ...(exMaxAttempts.trim() ? { max_attempts: parseInt(exMaxAttempts) } : {}),
          ...(exStart ? { start_time: exStart } : {}),
          ...(exEnd ? { end_time: exEnd } : {}),
        }),
      });
      if (res.replaced_exam_title) toast.info(`原绑定考试《${res.replaced_exam_title}》已自动置为已结束`);
      toast.success(targetStatus === "published"
        ? "课程已发布，试卷已存入试卷管理，考试已创建并开放"
        : "课程与考试草稿已保存，试卷已存入试卷管理");
      if (targetStatus === "published") publishedRef.current = true;
      onSaved();
      finish();
    } catch (e: any) {
      toast.error(`课程已保存，但考试创建失败：${e?.message || e}。可稍后到「考试管理 → 新增考试」重试`);
      onSaved();
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
          width: withExam ? "min(940px, 96vw)" : "min(680px, 96vw)",
          background: "var(--color-bg-card)",
          boxShadow: "-12px 0 32px rgba(0,0,0,0.12)",
          transform: shifted ? "translateX(0)" : "translateX(100%)",
          transition: "transform 220ms ease",
        }}
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-label={isEdit ? "编辑课程" : "新建课程"}
      >
        {/* 标题栏：衬线标题（与 k-card-title 同族，平台的「盖章」识别） */}
        <div className="shrink-0 flex items-center justify-between px-6 h-12 border-b border-border">
          <div className="flex items-center gap-3 min-w-0">
            <h3 className="k-card-title shrink-0">{isEdit ? "编辑课程" : "新建课程"}</h3>
            {isEdit && courseId && <StatusTag value={status} />}
          </div>
          <button type="button" onClick={requestClose}
            className="p-1.5 -mr-1.5 rounded-md text-text-secondary hover:text-text-base hover:bg-bg-hover transition-colors" aria-label="关闭">
            <X size={16} />
          </button>
        </div>

        {/* 步骤进度条（仅一键建考分步模式）：当前步实心藏青是全场唯一强点；
            已完成浅蓝底可点回退，未到达细描边灰字；2px 细连接线随进度填充 */}
        {withExam && (
          <div className="shrink-0 px-6 py-3 border-b border-border bg-bg-layout/70 flex items-center">
            {["课程", "出题", "试卷", "考试"].map((label, i) => {
              const done = i < examStep;
              const current = i === examStep;
              return (
                <div key={label} className={`flex items-center min-w-0 ${i > 0 ? "flex-1" : ""}`}>
                  {i > 0 && <div className={`flex-1 h-0.5 mx-2.5 rounded-full transition-colors ${i <= examStep ? "bg-primary/60" : "bg-border"}`} />}
                  <button type="button" onClick={() => done && setExamStep(i)} disabled={!done}
                    title={done ? `返回「${label}」步修改` : undefined}
                    className={`flex items-center gap-1.5 whitespace-nowrap text-[13px] transition-colors ${
                      current ? "text-primary font-bold" : done ? "text-primary hover:text-primary-dark" : "text-text-meta"}`}>
                    <span className={`w-[22px] h-[22px] rounded-full flex items-center justify-center text-xs shrink-0 transition-colors ${
                      current ? "bg-primary text-bg-card font-medium"
                        : done ? "bg-accent-fill text-primary"
                          : "bg-bg-card border border-border text-text-meta"}`}>
                      {done ? "✓" : i + 1}
                    </span>
                    <span>{label}</span>
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* 单页表单：所有分区同屏展示，整页滚动 */}
        <div className="flex-1 min-h-0 overflow-y-auto k-scroll px-6 py-4">
          {!dataReady ? (
            <p className="text-sm text-text-secondary py-10 text-center">加载课程…</p>
          ) : loadError ? (
            <p className="text-sm text-red-500 py-10 text-center">加载失败：{loadError}</p>
          ) : examStep === 1 ? (
            /* 一键建考·步1 出题：题库选题 / 随机规则 二选一，支持就地 AI/导入补题 */
            <div>
              <div className="flex items-center gap-1 mb-4 border-b border-border">
                {([["bank_fixed", "从题库选题"], ["bank_random", "随机抽题规则"]] as const).map(([k, l]) => (
                  <button key={k} type="button" onClick={() => setExamTab(k)}
                    className={`px-4 py-2 text-sm border-b-2 -mb-px transition-colors ${examTab === k ? "border-primary text-primary font-medium" : "border-transparent text-text-secondary hover:text-text-base"}`}>{l}</button>
                ))}
                <div className="ml-auto mb-1 flex items-center gap-2">
                  <button type="button" onClick={() => aiEnabled && setShowAI(true)} disabled={!aiEnabled}
                    title={aiEnabled ? "按主题关键词 AI 生成题目草稿，人工审核后入库" : "AI 功能未启用：服务端未配置 LLM_API_KEY"}
                    className="k-btn k-btn-default k-btn-sm">AI 出题</button>
                  <button type="button" onClick={() => setShowImport(true)} className="k-btn k-btn-default k-btn-sm">Excel 导入</button>
                </div>
              </div>
              {examTab === "bank_fixed" ? (
                <QuestionPickerPanel refreshKey={pickerRefreshKey}
                  onChange={(cat, items) => { setQCat(cat); setPicked(items); }} />
              ) : (
                <RandomRulesPanel onChange={(banks, rules) => { setRandBanks(banks); setRandRules(rules); }} />
              )}
              {examTab === "bank_fixed" && picked.length > 0 && !allScoresSet && (
                <div className="k-note mt-3 flex items-center gap-2">
                  <span>{picked.filter(q => q.score <= 0).length} 题未设分值，将按目标总分自动平摊为</span>
                  <input type="number" min={picked.length} value={splitTarget || ""}
                    onChange={e => setSplitTarget(parseInt(e.target.value) || 0)}
                    className="k-ctl w-16 text-center" />
                  <span className="text-text-meta">分（不少于题数 {picked.length}）</span>
                </div>
              )}
            </div>
          ) : examStep === 2 ? (
            /* 一键建考·步2 试卷：组卷结果摘要（总分=衬线大数字，全抽屉唯一强调）+ 试卷命名 */
            <div className="max-w-xl space-y-4">
              <div className="k-card">
                <div className="k-card-head">
                  <h4 className="k-card-title">组卷结果</h4>
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-xs text-text-meta">合计</span>
                    <span className="k-num text-2xl leading-none">{examTotal}</span>
                    <span className="text-xs text-text-meta">分</span>
                  </div>
                </div>
                <div className="k-card-body">
                  {examTab === "bank_fixed" ? (
                    <p className="text-sm text-text-secondary">
                      固定 {picked.length} 题
                      {!allScoresSet && <span className="text-text-meta">（未设分值项按总分自动平摊）</span>}
                    </p>
                  ) : (
                    <div className="divide-y divide-border">
                      {randRules.map((r, i) => (
                        <div key={i} className="flex items-center gap-2 py-2 text-sm first:pt-0 last:pb-0">
                          <span className="k-tag">{TYPE_LABELS[r.type] || r.type}</span>
                          <span className="k-tag">{DIFF_LABELS[r.difficulty] || r.difficulty}</span>
                          <span className="text-text-secondary">抽 {r.count} 题 × {r.score} 分</span>
                          <span className="ml-auto font-medium tabular-nums">{r.count * r.score} 分</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div>
                <label className="k-label">试卷名称 *</label>
                <input type="text" value={paperName} onChange={e => setPaperName(e.target.value)}
                  className="k-input" placeholder={`${title.trim() || "新课程"}测试卷`} />
                <p className="mt-2 flex items-center gap-2 text-xs text-text-meta">
                  <span className="k-tag shrink-0">入库即「已发布」</span>
                  之后可在考试管理「新增考试」直接复用这份试卷
                </p>
              </div>
            </div>
          ) : examStep === 3 ? (
            /* 一键建考·步3 考试：考试属性配置，末步一次提交课程+试卷+考试 */
            <div className="max-w-xl space-y-4">
              <div>
                <label className="k-label">考试名称 *</label>
                <input type="text" value={examTitle} onChange={e => setExamTitle(e.target.value)}
                  className="k-input" placeholder={`${title.trim() || "新课程"}考试`} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="k-label">考试时长（分钟）</label>
                  <input type="number" min={1} value={exDuration || ""} onChange={e => setExDuration(parseInt(e.target.value) || 0)} className="k-input" />
                </div>
                <div>
                  <label className="k-label">最大考试次数</label>
                  <input type="number" min={1} value={exMaxAttempts} onChange={e => setExMaxAttempts(e.target.value)} placeholder="不限" className="k-input" />
                </div>
                <div>
                  <label className="k-label">开放时间（留空=立即开放）</label>
                  <DateTimeField value={exStart} onChange={setExStart} placeholder="选择开放日期时间" />
                </div>
                <div>
                  <label className="k-label">截止时间（留空=不限）</label>
                  <DateTimeField value={exEnd} onChange={setExEnd} placeholder="选择截止日期时间" />
                </div>
                <div>
                  <label className="k-label">及格分</label>
                  <input type="number" min={1} max={examTotal || undefined} value={exPass} onChange={e => setExPass(e.target.value)}
                    placeholder={`默认 ${passDefault}`} className="k-input" />
                </div>
                <div className="rounded-md px-3 py-2 bg-accent-fill/60 border border-primary/15 flex flex-col justify-center min-w-0">
                  <p className="text-[11px] text-text-meta leading-tight">总分 / 试卷</p>
                  <p className="truncate leading-snug">
                    <span className="k-num text-base">{examTotal}</span>
                    <span className="text-xs text-text-secondary"> 分 · {paperName || "-"}</span>
                  </p>
                </div>
              </div>
              <div className="k-note">考生 = 本课程已分配的学员（回「课程」步的分配区增减）。点「发布课程并开放考试」一次完成课程发布 + 试卷入库 + 考试发布。</div>
            </div>
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

              {/* 4 课程考试（仅新建流程）：勾选后进入「出题→试卷→考试」分步模式，课程与考试一次创建 */}
              {!isEdit && (
                <section ref={el => { secRefs.current.exam = el; }}>
                  <SectionHead n={4} title="课程考试（可选）" />
                  <label className="flex items-start gap-2 text-sm cursor-pointer k-card p-3">
                    <input type="checkbox" className="mt-0.5 shrink-0" checked={withExam}
                      onChange={e => toggleExamFlow(e.target.checked)} />
                    <span>
                      <span className="font-medium">同时一键创建考试</span>
                      <span className="block text-xs text-text-secondary mt-0.5">
                        勾选后按「出题 → 试卷 → 考试」分步继续：所选题目自动组卷并存入试卷管理，同时创建考试并绑定本课；不勾选则只创建课程
                      </span>
                    </span>
                  </label>
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
          ) : withExam ? (
            /* 一键建考分步底栏：步0 只留「下一步」（想纯建课就回步4取消勾选）；末步 草稿/发布 双出口 */
            <>
              {examStep > 0 && (
                <button type="button" className="k-btn k-btn-default mr-auto" disabled={saving} onClick={() => setExamStep(examStep - 1)}>
                  上一步
                </button>
              )}
              {examStep >= 1 && (
                <span className="k-tag">
                  {examTab === "bank_fixed" ? `已选 ${picked.length} 题 · ` : ""}合计 <b className="k-num text-sm leading-none">{examTotal}</b> 分
                </span>
              )}
              {examStep === 0 && (
                <button type="button" className="k-btn k-btn-primary" onClick={() => gotoExamStep(1)}>下一步：出题 →</button>
              )}
              {examStep === 1 && (
                <button type="button" className="k-btn k-btn-primary" disabled={!contentReady} onClick={() => gotoExamStep(2)}>下一步：试卷 →</button>
              )}
              {examStep === 2 && (
                <button type="button" className="k-btn k-btn-primary" disabled={!paperName.trim()} onClick={() => gotoExamStep(3)}>下一步：考试 →</button>
              )}
              {examStep === 3 && (
                <>
                  <button type="button" className="k-btn k-btn-default" disabled={saving} onClick={() => void finishWithExam("draft")}>
                    {saving ? "提交中…" : "存为草稿"}
                  </button>
                  <button type="button" className="k-btn k-btn-primary" disabled={saving} onClick={() => void finishWithExam("published")}>
                    {saving ? "提交中…" : "发布课程并开放考试"}
                  </button>
                </>
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

        {/* 就地补题子弹窗：挂在面板内（面板已 stopPropagation），点子弹窗遮罩只关子弹窗不误关抽屉 */}
        {showAI && (
          <AIGenerateModal onClose={() => setShowAI(false)} onDone={() => setPickerRefreshKey(k => k + 1)}
            defaultCategoryId={qCat} categories={catFlat} />
        )}
        {showImport && (
          <ImportQuestionsModal categoryId={qCat} onClose={() => setShowImport(false)}
            onDone={() => setPickerRefreshKey(k => k + 1)} />
        )}
      </div>
    </div>
  );
}
