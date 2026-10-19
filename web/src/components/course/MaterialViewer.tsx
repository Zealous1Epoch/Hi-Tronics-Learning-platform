/** 课件内嵌查看器：直接在页面主内容区展示 PDF / PPT / HTML 课件。
 *
 * 课件与视频同为课程内容——无视频的课程里它就是学员的「播放画面」。
 * PDF/PPT 走 blob iframe（PPT 由后端预览端点返回转好的 PDF），
 * HTML 走 srcdoc 沙箱；其余情况降级为下载引导。
 */
import { useEffect, useRef, useState } from "react";
import { Download, Loader2, FileWarning } from "lucide-react";
import { BASE } from "../../lib/api";
import { materialPreviewPath, materialDownloadPath } from "../../lib/courseApi";

export interface MaterialFile {
  id: string;
  original_name: string;
  file_size: number | null;
  file_type: string;
}

function formatSize(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function authedFetch(path: string): Promise<Response> {
  const token = localStorage.getItem("lp_token") || "";
  return fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
}

async function downloadMaterialFile(material: MaterialFile) {
  const res = await authedFetch(materialDownloadPath(material.id));
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = material.original_name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 下载引导（不可内嵌的格式 / 预览加载失败时的兜底） */
function Fallback({ material }: { material: MaterialFile }) {
  const [downloading, setDownloading] = useState(false);
  const go = async () => {
    setDownloading(true);
    try {
      await downloadMaterialFile(material);
    } catch { /* 静默 */ }
    setDownloading(false);
  };
  return (
    <div className="h-full flex flex-col items-center justify-center gap-3 text-text-secondary py-12">
      <FileWarning size={28} className="text-text-secondary/60" />
      <p className="text-sm">该格式暂不支持在线预览，请下载后查看</p>
      <button
        onClick={go}
        disabled={downloading}
        className="px-4 py-1.5 text-sm bg-primary text-white rounded-md hover:bg-primary-light disabled:opacity-50"
      >
        {downloading ? "下载中..." : "下载文件"}
      </button>
    </div>
  );
}

/** 内嵌主体：父级以 key=material.id 重挂载，每份课件状态从干净开始，无需 effect 重置 */
function ViewerBody({ material, isHtml }: { material: MaterialFile; isHtml: boolean }) {
  const [failed, setFailed] = useState(false);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [htmlText, setHtmlText] = useState<string | null>(null);
  const blobUrlRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await authedFetch(materialPreviewPath(material.id));
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        if (isHtml) {
          const text = await res.text();
          if (!cancelled) setHtmlText(text);
        } else {
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          if (cancelled) { URL.revokeObjectURL(url); return; }
          blobUrlRef.current = url;
          setBlobUrl(url);
        }
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, [material.id, isHtml]);

  if (failed) return <Fallback material={material} />;

  if (isHtml) {
    if (htmlText == null) {
      return (
        <div className="h-full flex items-center justify-center gap-2 text-text-secondary">
          <Loader2 size={16} className="animate-spin" />
          <span className="text-sm">加载资料中...</span>
        </div>
      );
    }
    return (
      <iframe
        srcDoc={htmlText}
        className="w-full h-full border-0 bg-white"
        title={material.original_name}
        sandbox="allow-scripts allow-same-origin"
      />
    );
  }

  if (!blobUrl) {
    return (
      <div className="h-full flex items-center justify-center gap-2 text-text-secondary">
        <Loader2 size={16} className="animate-spin" />
        <span className="text-sm">加载资料中...</span>
      </div>
    );
  }
  return <iframe src={blobUrl} title={material.original_name} className="w-full h-full border-0 bg-white" />;
}

export default function MaterialViewer({ material }: { material: MaterialFile }) {
  const ext = material.file_type.toLowerCase();
  const isBlobEmbed = ["pdf", "ppt", "pptx"].includes(ext);
  const isHtml = ["html", "htm"].includes(ext);
  const embeddable = isBlobEmbed || isHtml;

  const [downloading, setDownloading] = useState(false);
  const handleDownload = async () => {
    setDownloading(true);
    try {
      await downloadMaterialFile(material);
    } catch { /* 静默：下载失败不闪断课程页面 */ }
    setDownloading(false);
  };

  return (
    <div className="flex flex-col h-full min-h-[420px]">
      {/* 资料标题栏（与视频底部信息条同构） */}
      <div className="px-4 py-2.5 border-b border-border flex items-center gap-2 shrink-0">
        <span className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />
        <span className="text-sm font-medium truncate flex-1" title={material.original_name}>
          {material.original_name}
        </span>
        {material.file_size && <span className="text-xs text-text-secondary shrink-0">{formatSize(material.file_size)}</span>}
        <button
          onClick={handleDownload}
          disabled={downloading}
          className="flex items-center gap-1 px-2 py-1 text-xs border border-border rounded hover:bg-bg-layout transition-colors disabled:opacity-50 shrink-0"
        >
          <Download size={12} />
          {downloading ? "下载中..." : "下载"}
        </button>
      </div>

      {/* 内容区：不可内嵌预览的格式直接落到下载引导（派生自 file_type） */}
      <div className="flex-1 min-h-0 bg-bg-layout">
        {embeddable ? <ViewerBody key={material.id} material={material} isHtml={isHtml} /> : <Fallback material={material} />}
      </div>
    </div>
  );
}
