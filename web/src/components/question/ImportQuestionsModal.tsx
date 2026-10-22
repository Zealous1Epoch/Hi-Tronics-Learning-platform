/**
 * Excel 批量导入试题弹窗（试题管理页 / 一键建考向导共用）
 *
 * 行为与接口：GET /questions/template 下载模板，POST /questions/import 上传导入。
 * categoryId 非空时导入题目自动归属该题库。
 */
import { useState } from "react";
import { BASE } from "../../lib/api";

interface ImportResult {
  created: number;
  skipped: number;
  errors: string[];
}

interface Props {
  onClose: () => void;
  /** 导入成功后刷新列表 */
  onDone: () => void;
  /** 导入题目归属的题库分类 */
  categoryId?: string | null;
}

export default function ImportQuestionsModal({ onClose, onDone, categoryId }: Props) {
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  const handleDownloadTemplate = async () => {
    const token = localStorage.getItem("lp_token");
    const res = await fetch(`${BASE}/questions/template`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "questions_template.xlsx";
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = async () => {
    if (!importFile) return;
    setImporting(true);
    setImportResult(null);
    const formData = new FormData();
    formData.append("file", importFile);
    if (categoryId) formData.append("category_id", categoryId);
    const token = localStorage.getItem("lp_token");
    try {
      const res = await fetch(`${BASE}/questions/import`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.detail || "导入失败");
      setImportResult(result);
      setImportFile(null);
      onDone();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div className="bg-bg-base rounded-lg shadow-xl w-full max-w-lg" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h3 className="font-bold text-base">批量导入试题</h3>
          <button onClick={onClose} className="text-text-secondary hover:text-text-base text-xl leading-none">&times;</button>
        </div>
        <div className="p-6 space-y-6">
          {/* 步骤 1: 下载模板 */}
          <div className="flex items-start gap-3">
            <span className="w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">1</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium mb-1">下载模板</p>
              <p className="text-xs text-text-secondary mb-2">按模板格式填写试题信息</p>
              <button
                onClick={handleDownloadTemplate}
                className="inline-flex items-center gap-1.5 text-xs text-primary border border-primary/30 rounded-md px-3 py-1.5 hover:bg-primary/5 transition-colors"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                下载导入模板
              </button>
              {categoryId && (
                <p className="text-xs text-text-secondary mt-2">
                  导入试题将自动归属到当前选中的题库
                </p>
              )}
            </div>
          </div>

          {/* 步骤 2: 上传文件 */}
          <div className="flex items-start gap-3">
            <span className="w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">2</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium mb-1">上传 Excel 文件</p>
              <label className={`block border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors ${
                importFile ? "border-primary/40 bg-primary/5" : "border-border hover:border-text-secondary/30"
              }`}>
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={e => setImportFile(e.target.files?.[0] || null)}
                  className="hidden"
                />
                {importFile ? (
                  <div className="flex items-center gap-2 justify-center">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-600"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                    <span className="text-sm font-medium text-text-base">{importFile.name}</span>
                    <button onClick={(e) => { e.stopPropagation(); setImportFile(null); }} className="text-xs text-red-500 hover:underline ml-1">移除</button>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-1">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-text-secondary"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                    <span className="text-sm text-text-secondary">点击选择文件或拖拽到此区域</span>
                    <span className="text-xs text-text-secondary">仅支持 .xlsx / .xls 格式</span>
                  </div>
                )}
              </label>
            </div>
          </div>

          {/* 导入结果 */}
          {importResult && (
            <div className={`rounded-lg border p-4 text-sm ${
              importResult.errors.length > 0 ? "border-yellow-200 bg-yellow-50" : "border-emerald-200 bg-emerald-50"
            }`}>
              <div className="flex items-center gap-2 mb-2">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={importResult.errors.length > 0 ? "text-yellow-600" : "text-emerald-600"}>
                  {importResult.errors.length > 0
                    ? <><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></>
                    : <><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></>
                  }
                </svg>
                <span className={`font-medium ${importResult.errors.length > 0 ? "text-yellow-800" : "text-emerald-800"}`}>
                  导入完成
                </span>
              </div>
              <div className="flex gap-4 text-xs">
                <span className="text-text-secondary">新增 <span className="text-emerald-600 font-bold">{importResult.created}</span> 道</span>
                <span className="text-text-secondary">跳过 <span className="text-text-secondary font-bold">{importResult.skipped}</span> 道</span>
              </div>
              {importResult.errors.length > 0 && (
                <div className="mt-2 max-h-28 overflow-y-auto space-y-0.5">
                  {importResult.errors.map((err, i) => (
                    <p key={i} className="text-red-500 text-xs">{err}</p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border bg-bg-layout/50">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-md text-sm border border-border text-text-secondary hover:text-text-base hover:bg-bg-base transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleImport}
            disabled={!importFile || importing}
            className="px-5 py-2 rounded-md text-sm bg-primary text-white hover:bg-primary-light disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
          >
            {importing ? (
              <>
                <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" strokeDasharray="31.4 31.4" strokeLinecap="round"/></svg>
                导入中...
              </>
            ) : (
              "开始导入"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
