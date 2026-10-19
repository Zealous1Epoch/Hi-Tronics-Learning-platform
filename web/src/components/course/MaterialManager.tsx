/** 课程课件管理：PDF / PPT / HTML 等学习文件的上传、预览、下载、删除。
 *
 * 与 VideoManager 同套路：新建态无课程 ID 时经 ensureCourseId 静默建草稿后继续上传；
 * 预览复用知识库 FilePreviewModal（PPT 走后端转好的 PDF，HTML 走 iframe srcdoc）。
 */
import { useRef, useState } from "react";
import { Upload, X, Trash2, Eye } from "lucide-react";
import {
  deleteMaterial, materialPreviewPath, uploadMaterial,
  type CourseMaterial,
} from "../../lib/courseApi";
import FilePreviewModal, { type FileItem } from "../knowledge/FilePreviewModal";
import { useToast } from "../ui/Toast";
import { useConfirm } from "../ui/Confirm";

const ACCEPT = ".pdf,.ppt,.pptx,.html,.htm";

function formatSize(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

interface UploadTask {
  key: number;
  file: File;
  progress: number;
  status: "uploading" | "error";
  error?: string;
}

interface MaterialManagerProps {
  /** null = 课程未落库；配合 ensureCourseId 自动建草稿 */
  courseId: string | null;
  materials: CourseMaterial[];
  onAdded: (m: CourseMaterial) => void;
  onDeleted: (id: string) => void;
  /** 是否有文件正在上传（编辑页据此拦截保存/离开） */
  onUploadingChange?: (busy: boolean) => void;
  ensureCourseId?: () => Promise<string | null>;
}

export default function MaterialManager({
  courseId,
  materials,
  onAdded,
  onDeleted,
  onUploadingChange,
  ensureCourseId,
}: MaterialManagerProps) {
  const toast = useToast();
  const confirm = useConfirm();
  const [tasks, setTasks] = useState<UploadTask[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [preview, setPreview] = useState<CourseMaterial | null>(null);
  const canUpload = Boolean(courseId || ensureCourseId);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const keySeq = useRef(0);

  const notifyBusy = (list: UploadTask[]) => {
    onUploadingChange?.(list.some(t => t.status === "uploading"));
  };

  const patchTask = (key: number, patch: Partial<UploadTask>) => {
    setTasks(prev => {
      const next = prev.map(t => (t.key === key ? { ...t, ...patch } : t));
      notifyBusy(next);
      return next;
    });
  };

  const dropTask = (key: number) => {
    setTasks(prev => {
      const next = prev.filter(t => t.key !== key);
      notifyBusy(next);
      return next;
    });
  };

  const startUpload = async (task: UploadTask, cid: string) => {
    const { key, file } = task;
    patchTask(key, { status: "uploading", progress: 0, error: undefined });
    try {
      const created = await uploadMaterial(cid, file, (pct) => patchTask(key, { progress: pct }));
      onAdded(created);
      dropTask(key);
      toast.success(`课件「${created.original_name}」上传完成`);
    } catch (e: any) {
      const msg = String(e?.message || e);
      patchTask(key, { status: "error", error: msg });
      toast.error(`课件「${file.name}」上传失败：${msg}`);
    }
  };

  const handleFiles = async (files: FileList) => {
    let cid = courseId;
    if (!cid) {
      if (!ensureCourseId) return;
      cid = await ensureCourseId();
      if (!cid) return;
    }
    const fresh: UploadTask[] = Array.from(files).map(file => ({
      key: ++keySeq.current, file, progress: 0, status: "uploading" as const,
    }));
    if (fresh.length === 0) return;
    setTasks(prev => {
      const next = [...prev, ...fresh];
      notifyBusy(next);
      return next;
    });
    // 逐个串行上传，避免大文件并发挤占带宽；单个失败不影响其余
    for (const t of fresh) {
      await startUpload(t, cid);
    }
  };

  const handleDelete = async (m: CourseMaterial) => {
    const ok = await confirm({
      title: "删除课件",
      message: `确定删除课件「${m.original_name}」？文件将从服务器移除。`,
      confirmText: "删除",
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteMaterial(m.id);
      onDeleted(m.id);
      toast.success("课件已删除");
    } catch (e: any) {
      toast.error(`删除失败：${e.message || e}`);
    }
  };

  return (
    <div className="space-y-4">
      {/* 上传区 */}
      <div>
        <label className="k-label">上传课件</label>
        <div
          className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
            canUpload
              ? "cursor-pointer " + (dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/40 hover:bg-bg-layout")
              : "cursor-not-allowed border-border bg-bg-layout opacity-60"
          }`}
          onClick={() => canUpload && fileInputRef.current?.click()}
          onDragOver={e => { e.preventDefault(); if (canUpload) setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => {
            e.preventDefault();
            setDragOver(false);
            if (e.dataTransfer.files.length > 0) void handleFiles(e.dataTransfer.files);
          }}
        >
          <Upload size={28} className="mx-auto text-text-secondary mb-2" />
          {canUpload ? (
            <>
              <p className="text-sm text-text-secondary">点击选择文件或拖拽到此处</p>
              <p className="text-xs text-text-secondary/60 mt-0.5">支持 PDF / PPT / PPTX / HTML，选择后立即上传并保存</p>
            </>
          ) : (
            <>
              <p className="text-sm text-text-secondary">暂时无法上传课件</p>
              <p className="text-xs text-text-secondary/60 mt-0.5">课程数据异常，请返回列表刷新后重试</p>
            </>
          )}
          <input ref={fileInputRef} type="file" accept={ACCEPT}
            multiple className="hidden" disabled={!canUpload}
            onChange={e => { if (e.target.files) void handleFiles(e.target.files); e.target.value = ""; }} />
        </div>
      </div>

      {/* 上传队列 */}
      {tasks.length > 0 && (
        <div className="space-y-2">
          {tasks.map(t => (
            <div key={t.key} className="py-1.5 px-3 bg-bg-layout rounded-md">
              <div className="flex items-center gap-2">
                <span className="text-sm text-text-secondary truncate flex-1 min-w-0" title={t.file.name}>{t.file.name}</span>
                <span className="text-xs text-text-secondary/60 shrink-0">{formatSize(t.file.size)}</span>
                {t.status === "error" && (
                  <button onClick={() => courseId && void startUpload(t, courseId)} className="k-btn k-btn-sm k-btn-default shrink-0">重试</button>
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
            </div>
          ))}
        </div>
      )}

      {/* 已落库课件 */}
      {materials.length > 0 && (
        <div>
          <label className="k-label">课程课件 ({materials.length})</label>
          <div className="space-y-2">
            {materials.map(m => (
              <div key={m.id} className="flex items-center gap-2 py-1.5 px-3 bg-bg-layout rounded-md">
                <span className="text-sm truncate flex-1 min-w-0" title={m.original_name}>{m.original_name}</span>
                <span className="text-xs uppercase text-text-secondary/60 shrink-0">{m.file_type}</span>
                <span className="text-xs text-text-secondary/60 shrink-0">{formatSize(m.file_size)}</span>
                <button onClick={() => setPreview(m)} title="预览"
                  className="text-text-secondary hover:text-primary shrink-0 p-0.5">
                  <Eye size={14} />
                </button>
                <button onClick={() => handleDelete(m)} title="删除课件"
                  className="text-text-secondary hover:text-danger shrink-0 p-0.5">
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {preview && (
        <FilePreviewModal
          file={{
            id: preview.id,
            original_name: preview.original_name,
            file_size: preview.file_size,
            file_type: preview.file_type,
          } as FileItem}
          apiPath={materialPreviewPath(preview.id)}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  );
}
