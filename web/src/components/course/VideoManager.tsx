/** 视频管理（课程管理重构 S5，迁自 CourseManage :1490-1579 + 上传编排 :573-601）
 *
 * 与旧实现的核心差异（已确认决策）：上传时机从「随课程保存批量补传」改为
 * 「逐文件即时上传落库」——选中文件立刻走 三步流（upload-token → OSS 直传 →
 * POST /courses/{id}/videos），单文件失败可独立重试，不影响其余文件。
 * 前置条件：课程必须已有 ID（新建场景先「保存草稿」拿到 ID 后才允许上传）。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Upload, X, Trash2, Pencil } from "lucide-react";
import {
  addVideo, deleteVideo, getUploadToken, renameVideo, uploadVideoToOSS, videoStreamUrl, type Video,
} from "../../lib/courseApi";
import { useToast } from "../ui/Toast";
import { useConfirm } from "../ui/Confirm";

/** 文件名 → 合法扩展名（后端白名单 mp4/mov/avi/mkv/webm） */
function extOf(name: string): string {
  const ext = name.toLowerCase().split(".").pop() || "mp4";
  return ["mp4", "mov", "avi", "mkv", "webm"].includes(ext) ? ext : "mp4";
}

/** 读取视频时长（秒），失败返回 null */
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

interface UploadTask {
  key: number;
  file: File;
  progress: number;
  status: "uploading" | "error";
  error?: string;
}

interface VideoManagerProps {
  /** null = 课程还没有 ID（新建未保存草稿），禁止上传 */
  courseId: string | null;
  /** 已落库视频（父组件从课程详情装载，增删后同步） */
  videos: Video[];
  onAdded: (video: Video) => void;
  onDeleted: (videoId: string) => void;
  onRenamed?: (videoId: string, title: string) => void;
  /** 是否有文件正在上传（编辑页据此拦截保存/离开） */
  onUploadingChange?: (busy: boolean) => void;
}

export default function VideoManager({
  courseId,
  videos,
  onAdded,
  onDeleted,
  onRenamed,
  onUploadingChange,
}: VideoManagerProps) {
  const toast = useToast();
  const confirm = useConfirm();
  const [tasks, setTasks] = useState<UploadTask[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const keySeq = useRef(0);

  // 上传中状态同步给父组件
  useEffect(() => {
    onUploadingChange?.(tasks.some(t => t.status === "uploading"));
  }, [tasks, onUploadingChange]);

  const patchTask = (key: number, patch: Partial<UploadTask>) => {
    setTasks(prev => prev.map(t => (t.key === key ? { ...t, ...patch } : t)));
  };

  const dropTask = (key: number) => {
    setTasks(prev => prev.filter(t => t.key !== key));
  };

  /** 三步流：token → OSS 直传 → 落库。失败置 error 可重试 */
  const startUpload = async (task: UploadTask) => {
    if (!courseId) return;
    const { key, file } = task;
    patchTask(key, { status: "uploading", progress: 0, error: undefined });
    try {
      const ext = extOf(file.name);
      const content_type = file.type || `video/${ext}`;
      const [duration, { filename, upload_url }] = await Promise.all([
        probeVideoDuration(file),
        getUploadToken(ext, content_type),
      ]);
      await uploadVideoToOSS(upload_url, file, content_type, (pct) => patchTask(key, { progress: pct }));
      const created = await addVideo(courseId, {
        title: file.name.replace(/\.[^.]+$/, ""),
        obs_key: filename,
        file_size: file.size,
        duration,
        chapter_id: null,
      });
      onAdded(created);
      dropTask(key);
      toast.success(`视频「${created.title}」上传完成`);
    } catch (e: any) {
      const msg = String(e?.message || e);
      patchTask(key, { status: "error", error: msg });
      toast.error(`视频「${file.name}」上传失败：${msg}`);
    }
  };

  const handleFiles = (files: FileList) => {
    if (!courseId) return;
    const fresh: UploadTask[] = [];
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("video/")) continue;
      fresh.push({ key: ++keySeq.current, file, progress: 0, status: "uploading" });
    }
    if (fresh.length === 0) return;
    setTasks(prev => [...prev, ...fresh]);
    fresh.forEach(t => { void startUpload(t); });
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files);
  };

  const handleDeleteVideo = async (v: Video) => {
    const ok = await confirm({
      title: "删除视频",
      message: `确定删除「${v.title}」？已产生的学习记录将保留在日志中。`,
      confirmText: "删除",
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteVideo(v.id);
      onDeleted(v.id);
      toast.success("视频已删除");
    } catch (e: any) {
      toast.error(`删除失败：${e.message || e}`);
    }
  };

  return (
    <div className="space-y-4">
      {/* 上传区 */}
      <div>
        <label className="k-label">上传视频</label>
        <div
          className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
            courseId
              ? "cursor-pointer " + (dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/40 hover:bg-bg-layout")
              : "cursor-not-allowed border-border bg-bg-layout opacity-60"
          }`}
          onClick={() => courseId && fileInputRef.current?.click()}
          onDragOver={e => { e.preventDefault(); if (courseId) setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
        >
          <Upload size={28} className="mx-auto text-text-secondary mb-2" />
          {courseId ? (
            <>
              <p className="text-sm text-text-secondary">点击选择文件或拖拽视频文件到此处</p>
              <p className="text-xs text-text-secondary/60 mt-0.5">支持 MP4 / MOV / AVI / MKV / WEBM，选择后立即上传并保存</p>
            </>
          ) : (
            <>
              <p className="text-sm text-text-secondary">暂时无法上传视频</p>
              <p className="text-xs text-text-secondary/60 mt-0.5">请先点右上角「保存草稿」创建课程，保存后此处即可逐文件上传</p>
            </>
          )}
          <input ref={fileInputRef} type="file" accept="video/mp4,video/mov,video/avi,video/mkv,video/webm"
            multiple className="hidden" disabled={!courseId}
            onChange={e => { if (e.target.files) handleFiles(e.target.files); e.target.value = ""; }} />
        </div>
      </div>

      {/* 上传队列（进行中 / 失败重试） */}
      {tasks.length > 0 && (
        <div className="space-y-2">
          {tasks.map(t => (
            <div key={t.key} className="py-1.5 px-3 bg-bg-layout rounded-md">
              <div className="flex items-center gap-2">
                <span className="text-sm text-text-secondary truncate flex-1 min-w-0" title={t.file.name}>{t.file.name}</span>
                <span className="text-xs text-text-secondary/60 shrink-0">{(t.file.size / 1024 / 1024).toFixed(1)} MB</span>
                {t.status === "error" && (
                  <button onClick={() => startUpload(t)} className="k-btn k-btn-sm k-btn-default shrink-0">重试</button>
                )}
                {t.status === "error" && (
                  <button onClick={() => dropTask(t.key)}
                    className="text-red-400 hover:text-red-600 shrink-0 p-0.5 border border-red-200 rounded hover:bg-red-50">
                    <X size={14} />
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
              {t.status === "error" && (
                <p className="mt-1 text-xs text-red-500">上传失败：{t.error}</p>
              )}
              {t.status === "error" && <BlobPreview file={t.file} />}
            </div>
          ))}
        </div>
      )}

      {/* 已落库视频 */}
      {videos.length > 0 && (
        <div>
          <label className="k-label">已有视频 ({videos.length})</label>
          <div className="space-y-2 max-h-[560px] overflow-y-auto k-scroll">
            {videos.map((v, i) => (
              <VideoRow
                key={v.id}
                index={i}
                video={v}
                onDelete={() => handleDeleteVideo(v)}
                onRenamed={(title) => onRenamed?.(v.id, title)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function VideoRow({ index, video, onDelete, onRenamed }: {
  index: number;
  video: Video;
  onDelete: () => void;
  onRenamed: (title: string) => void;
}) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(video.title);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const title = draft.trim();
    if (!title || title === video.title) { setEditing(false); setDraft(video.title); return; }
    setBusy(true);
    try {
      await renameVideo(video.id, title);
      onRenamed(title);
      setEditing(false);
      toast.success("标题已更新");
    } catch (e: any) {
      toast.error(`改名失败：${e.message || e}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="py-1.5 px-3 bg-bg-layout rounded-md">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-sm truncate flex-1 min-w-0">
          <span className="text-text-secondary mr-1.5">{index + 1}.</span>
          {editing ? (
            <input
              autoFocus value={draft} disabled={busy}
              onChange={e => setDraft(e.target.value)}
              onBlur={save}
              onKeyDown={e => { if (e.key === "Enter") save(); if (e.key === "Escape") { setEditing(false); setDraft(video.title); } }}
              className="w-2/3 border border-border rounded px-2 py-0.5 text-sm"
              onClick={e => e.stopPropagation()}
            />
          ) : (
            video.title
          )}
        </span>
        {!editing && (
          <button onClick={() => setEditing(true)} title="重命名"
            className="text-text-secondary hover:text-primary shrink-0 p-0.5">
            <Pencil size={13} />
          </button>
        )}
        <button onClick={onDelete} title="删除视频"
          className="text-text-secondary hover:text-danger shrink-0 p-0.5">
          <Trash2 size={14} />
        </button>
      </div>
      <video src={videoStreamUrl(video.obs_key)} controls
        className="w-full rounded-md max-h-56 bg-black" preload="metadata" />
    </div>
  );
}

/** 失败行的本地预览：blob 生命周期跟随组件（挂载创建、卸载释放） */
function BlobPreview({ file }: { file: File }) {
  const url = useMemo(() => URL.createObjectURL(file), [file]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return <video src={url} controls className="mt-1.5 w-full rounded-md max-h-56 bg-black" />;
}
