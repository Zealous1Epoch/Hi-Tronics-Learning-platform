/** 新增课程 · 右拉抽屉（鱼骨三段：课程内容 → 课程信息 → 课程分配）
 *
 * 表单流按学习设计的动线排列：先扔内容、再补信息、最后圈人发布。
 * - 步骤1 统一拖拽区：视频走 OSS 三步流、pdf/pptx/html 走课件接口，
 *   按扩展名自动路由；首次选择文件时静默创建课程草稿拿 ID（与编辑页
 *   ensureDraftForUpload 同套路），发布时才写入正式标题与信息。
 * - 中途关闭不丢已上传文件——它们已挂在草稿课程上，列表页可继续编辑。
 * - 步骤3 复用 DeptUserPicker（与编辑页/分配弹窗同源的全公司名册口径）。
 */
import { useEffect, useRef, useState } from "react";
import { X, Upload, Film, FileText, Trash2, RotateCw } from "lucide-react";
import DeptUserPicker from "./DeptUserPicker";
import CategorySelect from "./CategorySelect";
import MaterialViewer, { type MaterialFile } from "./MaterialViewer";
import DateField from "../ui/DateField";
import { useToast } from "../ui/Toast";
import { useConfirm } from "../ui/Confirm";
import { api, type OrgMemberRow, type OrgMembersResponse } from "../../lib/api";
import type { TreeNode, FlatCategory } from "../CourseTree";
import {
  addVideo, createCourse, deleteMaterial, deleteVideo, getCategoryFlat, getCategoryTree,
  getUploadToken, probeVideoDuration, postAssignments, updateCourse, uploadMaterial,
  uploadVideoToOSS, videoExtOf, videoStreamUrl,
} from "../../lib/courseApi";

type Kind = "video" | "material";

const VIDEO_EXTS = ["mp4", "mov", "avi", "mkv", "webm"];
const MATERIAL_EXTS = ["pdf", "ppt", "pptx", "html", "htm"];
const ACCEPT = [...VIDEO_EXTS, ...MATERIAL_EXTS].map(e => "." + e).join(",");
const STEPS = ["课程内容", "课程信息", "课程分配"] as const;

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
  onClose: () => void;
  /** 发布成功后回调（列表页刷新） */
  onPublished: () => void;
  /** 列表页当前选中的分类：新建课程静默沿用，避免筛选状态下建出「未分类」 */
  defaultCategoryId?: string | null;
}

export default function CourseCreateDrawer({ onClose, onPublished, defaultCategoryId = null }: DrawerProps) {
  const toast = useToast();
  const confirm = useConfirm();

  // 进出场动画
  const [entered, setEntered] = useState(false);
  const [closing, setClosing] = useState(false);

  const [step, setStep] = useState(0);

  // 草稿课程：首次上传时静默落库；发布时转正式
  const [courseId, setCourseId] = useState<string | null>(null);
  const courseIdRef = useRef<string | null>(null);
  const creatingRef = useRef<Promise<string | null> | null>(null);

  // 步骤1：上传队列、已传列表与下方预览（previewKey = `${kind}-${id}`）
  const [tasks, setTasks] = useState<UploadTask[]>([]);
  const [uploaded, setUploaded] = useState<UploadedItem[]>([]);
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const busyRef = useRef(false);
  const chainRef = useRef<Promise<void>>(Promise.resolve());
  const keySeq = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 步骤2：课程信息（分类初值沿用列表页当前筛选的分类）
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [categoryId, setCategoryId] = useState<string>(defaultCategoryId ?? "");
  const [catTree, setCatTree] = useState<TreeNode[]>([]);
  const [catFlat, setCatFlat] = useState<FlatCategory[]>([]);

  // 步骤3：分配（进入该步才拉名册）
  const [members, setMembers] = useState<OrgMemberRow[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const membersLoaded = useRef(false);
  const [selectedUsers, setSelectedUsers] = useState<Set<string>>(new Set());

  const [publishing, setPublishing] = useState(false);
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
    } catch { /* 分类拉取失败不阻塞建课：下拉留空，可在编辑页补选 */ }
  };

  useEffect(() => {
    void loadCategories();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (step !== 2 || membersLoaded.current) return;
    membersLoaded.current = true;
    setMembersLoading(true);
    api<OrgMembersResponse>("/org/members")
      .then(r => setMembers([...r.members, ...r.unlinked_accounts]))
      .catch(e => toast.error(`加载名册失败：${e.message || e}`))
      .finally(() => setMembersLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

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
        const [duration, tok] = await Promise.all([
          probeVideoDuration(task.file),
          getUploadToken(ext, content_type),
        ]);
        await uploadVideoToOSS(tok.upload_url, task.file, content_type,
          pct => patchTask(task.key, { progress: pct }));
        const created = await addVideo(task.cid, {
          title: stripExt(task.file.name),
          obs_key: tok.filename,
          file_size: task.file.size,
          duration,
          chapter_id: null,
        });
        setUploaded(prev => [...prev, { kind: "video", id: created.id, name: created.title, size: task.file.size, obsKey: tok.filename }]);
        setPreviewKey(`video-${created.id}`);
      } else {
        const created = await uploadMaterial(task.cid, task.file,
          pct => patchTask(task.key, { progress: pct }));
        setUploaded(prev => [...prev, { kind: "material", id: created.id, name: created.original_name, size: task.file.size, fileType: created.file_type }]);
        setPreviewKey(`material-${created.id}`);
      }
      dropTask(task.key);
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
    if (!publishedRef.current && uploaded.length > 0) {
      toast.info("已上传文件保存在课程草稿中，可在课程列表继续编辑");
    }
    finish();
  };

  const goNext = () => {
    if (step === 1) {
      if (!title.trim()) { toast.error("请填写课程标题"); return; }
      if (startDate && endDate && endDate < startDate) { toast.error("结束日期不能早于开始日期"); return; }
    }
    setStep(s => Math.min(2, s + 1));
  };

  const publish = async () => {
    if (publishing) return;
    if (!title.trim()) { setStep(1); toast.error("请填写课程标题"); return; }
    if (busyRef.current) { toast.info("还有文件正在上传，请等待完成后发布"); return; }
    setPublishing(true);
    try {
      const payload = {
        title: title.trim(),
        description: description.trim() || null,
        start_date: startDate || null,
        end_date: endDate || null,
        category_id: categoryId || null,
        status: "published",
      };
      // 草稿可能正在创建（上传触发）：等它落库后转 update，避免重复建课
      let id = courseIdRef.current ?? (creatingRef.current ? await creatingRef.current : null);
      if (id) await updateCourse(id, payload);
      else id = (await createCourse(payload)).id;
      if (selectedUsers.size > 0) {
        await postAssignments(id, { user_ids: [...selectedUsers], department_ids: [] });
      }
      publishedRef.current = true;
      toast.success("课程已发布");
      onPublished();
      finish();
    } catch (e: any) {
      toast.error(`发布失败：${e.message || e}`);
    } finally {
      setPublishing(false);
    }
  };

  const shifted = entered && !closing;
  const previewItem = previewKey ? uploaded.find(x => `${x.kind}-${x.id}` === previewKey) || null : null;

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
        aria-label="新建课程"
      >
        {/* 标题栏 */}
        <div className="shrink-0 flex items-center justify-between px-5 h-12 border-b border-border">
          <h3 className="text-sm font-medium" style={{ color: "var(--color-primary)" }}>新建课程</h3>
          <button type="button" onClick={requestClose} className="text-text-secondary hover:text-text-base" aria-label="关闭">
            <X size={16} />
          </button>
        </div>

        {/* 鱼骨步骤条：三段箭头咬合，已走过的一步可点回 */}
        <div className="shrink-0 flex items-stretch gap-0.5 px-5 pt-3 pb-1">
          {STEPS.map((label, i) => {
            const state = i === step ? "current" : i < step ? "done" : "todo";
            return (
              <button
                key={label}
                type="button"
                disabled={i > step}
                onClick={() => { if (i < step) setStep(i); }}
                className={`flex-1 h-8 flex items-center justify-center gap-1.5 text-xs transition-colors ${
                  state === "current" ? "bg-primary text-white"
                    : state === "done" ? "bg-primary/10 text-primary hover:bg-primary/15"
                      : "bg-bg-layout text-text-secondary"
                }`}
                style={{
                  clipPath: i === 0
                    ? "polygon(0 0, calc(100% - 9px) 0, 100% 50%, calc(100% - 9px) 100%, 0 100%)"
                    : "polygon(0 0, calc(100% - 9px) 0, 100% 50%, calc(100% - 9px) 100%, 0 50%)",
                  cursor: i < step ? "pointer" : state === "current" ? "default" : "not-allowed",
                }}
              >
                <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] shrink-0 ${
                  state === "current" ? "bg-white/25" : state === "done" ? "bg-primary/15" : "bg-border"
                }`}>{i + 1}</span>
                {label}
              </button>
            );
          })}
        </div>

        {/* 步骤内容 */}
        <div className="flex-1 min-h-0 overflow-y-auto k-scroll px-5 py-4">
          {step === 0 && (
            <div className="space-y-3">
              <div
                className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer ${
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
                <Upload size={26} className="mx-auto text-text-secondary mb-2" />
                <p className="text-sm text-text-secondary">点击选择文件，或拖拽到此处</p>
                <p className="text-xs text-text-secondary/60 mt-1">
                  支持视频（MP4 / MOV / AVI / MKV / WEBM）与课件（PDF / PPT / PPTX / HTML），选择后立即上传
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
                    {t.kind === "video" ? <Film size={13} className="text-text-secondary shrink-0" /> : <FileText size={13} className="text-text-secondary shrink-0" />}
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
                  <label className="k-label">已上传（{uploaded.length}）</label>
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
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4 max-w-[520px]">
              <div>
                <label className="k-label">课程标题 *</label>
                <input
                  type="text" value={title} onChange={e => setTitle(e.target.value)}
                  className="k-input" placeholder="输入课程标题"
                />
              </div>
              <div>
                <label className="k-label">课程分类</label>
                <CategorySelect
                  tree={catTree} flatCategories={catFlat}
                  value={categoryId} onChange={setCategoryId}
                  placeholder="未分类" allowCreate
                  onCreated={() => void loadCategories()}
                />
              </div>
              <div>
                <label className="k-label">课程简介</label>
                <textarea
                  value={description} rows={3} onChange={e => setDescription(e.target.value)}
                  className="k-textarea" placeholder="输入课程简介"
                />
              </div>
              <div className="flex gap-4">
                <div className="flex-1">
                  <label className="k-label">开始日期</label>
                  <DateField value={startDate} max={endDate || undefined}
                    onChange={setStartDate} placeholder="选择开始日期（可选）" />
                </div>
                <div className="flex-1">
                  <label className="k-label">结束日期</label>
                  <DateField value={endDate} min={startDate || undefined}
                    onChange={setEndDate} placeholder="选择结束日期（可选）" />
                </div>
              </div>
              {courseId && (
                <p className="text-xs text-text-secondary/70">内容已挂在课程草稿上，发布后生效</p>
              )}
            </div>
          )}

          {step === 2 && (
            membersLoading ? (
              <p className="text-sm text-text-secondary py-10 text-center">加载名册…</p>
            ) : members.length === 0 ? (
              <p className="text-sm text-text-secondary py-10 text-center">名册加载失败，可返回后重新进入本步重试</p>
            ) : (
              <DeptUserPicker
                members={members}
                selectedUsers={selectedUsers}
                onChange={setSelectedUsers}
                listClass="max-h-[44vh]"
              />
            )
          )}
        </div>

        {/* 底栏 */}
        <div className="shrink-0 h-14 border-t border-border px-5 flex items-center justify-between">
          <span className="text-xs text-text-secondary">第 {step + 1} / {STEPS.length} 步 · {STEPS[step]}{selectedUsers.size > 0 && step === 2 ? ` · 已选 ${selectedUsers.size} 人` : ""}</span>
          <div className="flex items-center gap-2">
            {step > 0 && (
              <button type="button" className="k-btn k-btn-default" onClick={() => setStep(s => s - 1)}>上一步</button>
            )}
            {step < STEPS.length - 1 ? (
              <button type="button" className="k-btn k-btn-primary" onClick={goNext}>下一步</button>
            ) : (
              <button type="button" className="k-btn k-btn-primary" disabled={publishing} onClick={publish}>
                {publishing ? "发布中…" : "发布课程"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
