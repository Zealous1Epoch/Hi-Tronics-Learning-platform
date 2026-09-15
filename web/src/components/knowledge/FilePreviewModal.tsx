import { useState, useEffect, useRef } from "react";
import { X, Download, Loader2, FileWarning } from "lucide-react";
import * as XLSX from "xlsx";
import mammoth from "mammoth";

export interface FileItem {
  id: string;
  original_name: string;
  file_size: number | null;
  file_type: string;
}

/** 浏览器原生可嵌入预览的类型（fetch blob → Object URL） */
const EMBED_TYPES = ["pdf", "png", "jpg", "jpeg", "gif", "svg", "webp"];
/** PPT/PPTX 由服务端转为 PDF，按 PDF 方式预览 */
const PPTX_EMBED_TYPES = ["ppt", "pptx"];
/** 文本类（fetch text → <pre>） */
const TEXT_TYPES = ["txt", "md", "csv", "json", "xml", "yaml", "yml", "log"];
/** HTML 类（fetch text → iframe srcdoc） */
const HTML_TYPES = ["html", "htm"];
/** Excel（xlsx 库解析 → HTML table） */
const EXCEL_TYPES = ["xlsx", "xls"];
/** Word（mammoth 库解析 → HTML） */
const WORD_TYPES = ["docx"];

function formatSize(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

interface Props {
  file: FileItem;
  /** API 路径（不含 BASE，如 "/knowledge-files/xxx/download"） */
  apiPath: string;
  onClose: () => void;
}

export default function FilePreviewModal({ file, apiPath, onClose }: Props) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [htmlContent, setHtmlContent] = useState<string | null>(null);
  const [textContent, setTextContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const blobUrlRef = useRef<string | null>(null);

  const ext = file.file_type.toLowerCase();
  const isImage = ["png", "jpg", "jpeg", "gif", "svg", "webp"].includes(ext);
  const isPdf = ext === "pdf";
  const isPptx = PPTX_EMBED_TYPES.includes(ext);
  const isText = TEXT_TYPES.includes(ext);
  const isHtml = HTML_TYPES.includes(ext);
  const isExcel = EXCEL_TYPES.includes(ext);
  const isWord = WORD_TYPES.includes(ext);

  const needsBlob = EMBED_TYPES.includes(ext) || PPTX_EMBED_TYPES.includes(ext);
  const needsTextFetch = isText || isHtml;
  const needsExcelParse = isExcel;
  const needsWordParse = isWord;
  const isPreviewable = needsBlob || needsTextFetch || needsExcelParse || needsWordParse;

  useEffect(() => {
    const token = localStorage.getItem("lp_token") || "";
    const url = `/api/learning-platform${apiPath}`;

    if (needsBlob) {
      setLoading(true);
      setError(null);
      fetch(url, { headers: { Authorization: `Bearer ${token}` } })
        .then(async (res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const blob = await res.blob();
          const objectUrl = URL.createObjectURL(blob);
          blobUrlRef.current = objectUrl;
          setBlobUrl(objectUrl);
        })
        .catch((e) => setError(`加载文件失败：${e.message}`))
        .finally(() => setLoading(false));
    } else if (needsTextFetch) {
      setLoading(true);
      setError(null);
      fetch(url, { headers: { Authorization: `Bearer ${token}` } })
        .then(async (res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          setTextContent(await res.text());
        })
        .catch((e) => setError(`加载文件失败：${e.message}`))
        .finally(() => setLoading(false));
    } else if (needsExcelParse) {
      // Excel: fetch ArrayBuffer → SheetJS 解析 → HTML table
      setLoading(true);
      setError(null);
      fetch(url, { headers: { Authorization: `Bearer ${token}` } })
        .then(async (res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const buffer = await res.arrayBuffer();
          const workbook = XLSX.read(new Uint8Array(buffer), { type: "array" });
          // 只渲染第一个 sheet
          const firstSheet = workbook.SheetNames[0];
          if (!firstSheet) throw new Error("工作簿中没有工作表");
          const html = XLSX.utils.sheet_to_html(workbook.Sheets[firstSheet], {
            id: "xlsx-preview",
            editable: false,
          });
          setHtmlContent(html);
        })
        .catch((e) => setError(`解析 Excel 失败：${e.message}`))
        .finally(() => setLoading(false));
    } else if (needsWordParse) {
      // Word: fetch ArrayBuffer → mammoth 转换 → HTML
      setLoading(true);
      setError(null);
      fetch(url, { headers: { Authorization: `Bearer ${token}` } })
        .then(async (res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const buffer = await res.arrayBuffer();
          const result = await mammoth.convertToHtml({ arrayBuffer: buffer });
          setHtmlContent(result.value);
          if (result.messages.length > 0) {
            console.warn("Mammoth 转换警告:", result.messages);
          }
        })
        .catch((e) => setError(`解析 Word 文档失败：${e.message}`))
        .finally(() => setLoading(false));
    }

    return () => {
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, [apiPath, needsBlob, needsTextFetch, needsExcelParse, needsWordParse]);

  // 下载（带 auth 的 fetch → blob → 触发下载）
  const handleDownload = async () => {
    const token = localStorage.getItem("lp_token") || "";
    const url = `/api/learning-platform${apiPath}`;
    setDownloading(true);
    try {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = file.original_name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch (e: any) {
      alert(`下载失败：${e.message}`);
    } finally {
      setDownloading(false);
    }
  };

  // ESC 关闭
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="bg-bg-base rounded-lg shadow-xl flex flex-col"
        style={{ width: "90vw", maxWidth: "1000px", height: "85vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 顶部信息栏 */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <span className="px-2 py-0.5 bg-primary/10 text-primary rounded text-[11px] font-medium shrink-0">
              {file.file_type.toUpperCase()}
            </span>
            <span className="font-medium text-sm truncate">{file.original_name}</span>
            {file.file_size && (
              <span className="text-xs text-text-secondary shrink-0">
                {formatSize(file.file_size)}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleDownload}
              disabled={downloading}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-border rounded-md hover:bg-bg-layout transition-colors disabled:opacity-50"
            >
              <Download size={14} />
              {downloading ? "下载中..." : "下载"}
            </button>
            <button
              onClick={onClose}
              className="text-text-secondary hover:text-text-base p-1"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* 预览内容区 */}
        <div className="flex-1 overflow-auto bg-[#f0efea]">
          {/* 加载中 */}
          {loading && (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-text-secondary">
              <Loader2 size={28} className="animate-spin" />
              <span className="text-sm">
                {file.file_size
                  ? `加载中... (${formatSize(file.file_size)})`
                  : "加载中..."}
              </span>
            </div>
          )}

          {/* 错误 */}
          {error && !loading && (
            <div className="flex flex-col items-center justify-center h-full text-text-secondary">
              <FileWarning size={40} className="mb-2 opacity-40" />
              <p className="text-sm">{error}</p>
            </div>
          )}

          {/* 图片预览 */}
          {isImage && blobUrl && (
            <div className="flex items-center justify-center h-full">
              <img
                src={blobUrl}
                alt={file.original_name}
                className="max-w-full max-h-full object-contain"
              />
            </div>
          )}

          {/* PDF / PPTX 预览（PPTX 由服务端转为 PDF） */}
          {(isPdf || isPptx) && blobUrl && (
            <iframe
              src={blobUrl}
              className="w-full h-full border-0"
              title={file.original_name}
            />
          )}

          {/* 文本预览 */}
          {isText && textContent !== null && (
            <pre className="p-6 text-sm font-mono text-text-base whitespace-pre-wrap break-words bg-white m-4 rounded-md border border-border min-h-full">
              {textContent}
            </pre>
          )}

          {/* HTML 预览 */}
          {isHtml && textContent !== null && (
            <iframe
              srcDoc={textContent}
              className="w-full h-full border-0 bg-white"
              title={file.original_name}
              sandbox="allow-scripts allow-same-origin"
            />
          )}

          {/* Excel 预览 */}
          {isExcel && htmlContent && (
            <div
              className="p-4 overflow-auto h-full"
              dangerouslySetInnerHTML={{ __html: htmlContent }}
            />
          )}

          {/* Word 预览 */}
          {isWord && htmlContent && (
            <div className="p-6 bg-white m-4 rounded-md border border-border overflow-auto min-h-fit">
              <div
                className="prose prose-sm max-w-none text-sm text-text-base"
                dangerouslySetInnerHTML={{ __html: htmlContent }}
              />
            </div>
          )}

          {/* 不支持预览（旧版 doc 等） */}
          {!isPreviewable && !loading && (
            <div className="flex flex-col items-center justify-center h-full text-text-secondary">
              <FileWarning size={40} className="mb-2 opacity-40" />
              <p className="text-sm mb-1">此文件格式不支持在线预览</p>
              <p className="text-xs text-text-secondary/60 mb-4">
                {file.file_type.toUpperCase()} 文件需要下载后用本地程序打开
              </p>
              <button
                onClick={handleDownload}
                disabled={downloading}
                className="inline-block px-4 py-1.5 text-sm bg-primary text-white rounded-md disabled:opacity-50"
              >
                {downloading ? "下载中..." : "下载文件"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}