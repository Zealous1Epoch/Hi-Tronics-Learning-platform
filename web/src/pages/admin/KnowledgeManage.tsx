import { useState, useEffect, useRef, useCallback } from "react";
import { api, uploadFile } from "../../lib/api";
import KnowledgeCanvas, { type TreeNode } from "../../components/knowledge/KnowledgeCanvas";
import FilePreviewModal, { type FileItem } from "../../components/knowledge/FilePreviewModal";
import { Plus, X, Upload, Trash2, Eye } from "lucide-react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import ImageExtension from "@tiptap/extension-image";

// ── TipTap 编辑器 ──

function RichEditor({
  content,
  onChange,
}: {
  content: string;
  onChange: (html: string) => void;
}) {
  const editor = useEditor({
    extensions: [StarterKit, ImageExtension],
    content,
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
    },
    editorProps: {
      attributes: {
        class: "prose prose-sm max-w-none min-h-[200px] px-3 py-2 outline-none",
      },
    },
  });

  // 同步外部 content 变化
  useEffect(() => {
    if (editor && editor.getHTML() !== content) {
      editor.commands.setContent(content || "");
    }
  }, [content, editor]);

  return (
    <div className="border border-border rounded-md overflow-hidden bg-white">
      {/* 工具栏 */}
      <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-border bg-bg-layout flex-wrap">
        {editor && (
          <>
            <ToolBtn
              active={editor.isActive("bold")}
              onClick={() => editor.chain().focus().toggleBold().run()}
            >
              <strong>B</strong>
            </ToolBtn>
            <ToolBtn
              active={editor.isActive("italic")}
              onClick={() => editor.chain().focus().toggleItalic().run()}
            >
              <em>I</em>
            </ToolBtn>
            <ToolBtn
              active={editor.isActive("heading", { level: 2 })}
              onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
            >
              H2
            </ToolBtn>
            <ToolBtn
              active={editor.isActive("heading", { level: 3 })}
              onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
            >
              H3
            </ToolBtn>
            <span className="w-px h-4 bg-border mx-0.5" />
            <ToolBtn
              active={editor.isActive("bulletList")}
              onClick={() => editor.chain().focus().toggleBulletList().run()}
            >
              &bull; List
            </ToolBtn>
            <ToolBtn
              active={editor.isActive("orderedList")}
              onClick={() => editor.chain().focus().toggleOrderedList().run()}
            >
              1. List
            </ToolBtn>
            <span className="w-px h-4 bg-border mx-0.5" />
            <ToolBtn onClick={() => editor.chain().focus().undo().run()}>
              Undo
            </ToolBtn>
            <ToolBtn onClick={() => editor.chain().focus().redo().run()}>
              Redo
            </ToolBtn>
          </>
        )}
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}

function ToolBtn({
  active,
  onClick,
  children,
}: {
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onMouseDown={(e) => { e.preventDefault(); onClick(); }}
      className={`px-1.5 py-0.5 text-xs rounded hover:bg-bg-base transition-colors ${
        active ? "bg-primary/10 text-primary font-medium" : "text-text-secondary"
      }`}
    >
      {children}
    </button>
  );
}

// ── 文件图标映射 ──

const FILE_ICON: Record<string, string> = {
  pdf: "PDF",
  ppt: "PPT",
  pptx: "PPT",
  doc: "DOC",
  docx: "DOC",
  xls: "XLS",
  xlsx: "XLS",
  html: "WEB",
  htm: "WEB",
  png: "IMG",
  jpg: "IMG",
  jpeg: "IMG",
  gif: "IMG",
  svg: "IMG",
  webp: "IMG",
  txt: "TXT",
  md: "TXT",
  csv: "CSV",
};

function getFileIcon(fileType: string): string {
  return FILE_ICON[fileType] || "FILE";
}

// ── 主组件 ──

export default function KnowledgeManage() {
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [loading, setLoading] = useState(true);

  // 右键菜单
  const [ctxMenu, setCtxMenu] = useState<{
    node: TreeNode;
    x: number;
    y: number;
  } | null>(null);
  const ctxMenuRef = useRef<HTMLDivElement>(null);
  const [ctxFileInputRef] = useState(() => ({ current: null as HTMLInputElement | null }));

  // 编辑弹窗
  const [showEditModal, setShowEditModal] = useState(false);
  const [editMode, setEditMode] = useState<"create" | "edit">("create");
  const [editParentId, setEditParentId] = useState<string | null>(null);
  const [editNodeId, setEditNodeId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [editStatus, setEditStatus] = useState<string>("draft");
  const [editFiles, setEditFiles] = useState<
    { id: string; original_name: string; file_size: number | null; file_type: string }[]
  >([]);
  const [saving, setSaving] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 文件预览
  const [previewFile, setPreviewFile] = useState<FileItem | null>(null);
  const [previewApiPath, setPreviewApiPath] = useState<string>("");

  // 拖拽保存坐标
  const pendingPositions = useRef<Map<string, { x: number; y: number }>>(new Map());

  const fetchTree = useCallback(async () => {
    const data = await api<TreeNode[]>("/knowledge-nodes");
    setTree(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchTree();
  }, [fetchTree]);

  // 点击外部关闭右键菜单
  useEffect(() => {
    if (!ctxMenu) return;
    const handler = (e: MouseEvent) => {
      if (ctxMenuRef.current && !ctxMenuRef.current.contains(e.target as Node)) {
        setCtxMenu(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [ctxMenu]);

  // ── 工具栏操作 ──

  const handleAddRoot = () => {
    setEditMode("create");
    setEditParentId(null);
    setEditNodeId(null);
    setEditTitle("");
    setEditContent("");
    setEditStatus("draft");
    setEditFiles([]);
    setShowEditModal(true);
  };

  const handleSaveLayout = async () => {
    if (pendingPositions.current.size === 0) return;
    const positions = Array.from(pendingPositions.current.entries()).map(
      ([id, pos]) => ({ id, x: pos.x, y: pos.y })
    );
    await api("/knowledge-nodes/positions", {
      method: "PUT",
      body: JSON.stringify({ positions }),
    });
    pendingPositions.current.clear();
  };

  // ── 右键菜单操作 ──

  const openEdit = async (nodeId: string) => {
    const node = await api<TreeNode & { files: { id: string; original_name: string; file_size: number | null; file_type: string }[] }>(
      `/knowledge-nodes/${nodeId}`
    );
    setEditMode("edit");
    setEditNodeId(node.id);
    setEditParentId(node.parent_id);
    setEditTitle(node.title);
    setEditContent(node.content || "");
    setEditStatus(node.status);
    setEditFiles(node.files || []);
    setCtxMenu(null);
    setShowEditModal(true);
  };

  const handleAddChild = (parentId: string) => {
    setEditMode("create");
    setEditParentId(parentId);
    setEditNodeId(null);
    setEditTitle("");
    setEditContent("");
    setEditStatus("draft");
    setEditFiles([]);
    setCtxMenu(null);
    setShowEditModal(true);
  };

  const handleDeleteNode = async (nodeId: string) => {
    if (!confirm("确定删除此知识节点？其子节点也将被删除。")) return;
    await api(`/knowledge-nodes/${nodeId}`, { method: "DELETE" });
    setCtxMenu(null);
    fetchTree();
  };

  const handleToggleStatus = async (nodeId: string, currentStatus: string) => {
    const newStatus = currentStatus === "published" ? "draft" : "published";
    await api(`/knowledge-nodes/${nodeId}`, {
      method: "PUT",
      body: JSON.stringify({ status: newStatus }),
    });
    setCtxMenu(null);
    fetchTree();
  };

  const handleCtxUploadFile = async (nodeId: string) => {
    const input = ctxFileInputRef.current;
    if (!input) return;
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const result = await uploadFile(`/knowledge-nodes/${nodeId}/files`, file);
        console.log("上传成功", result);
        setCtxMenu(null);
        fetchTree();
      } catch (e: any) {
        alert(`上传失败：${e.message || e}`);
      }
    };
    input.click();
  };

  // ── 编辑弹窗 ──

  const handleSave = async (publish: boolean) => {
    if (!editTitle.trim()) return;
    setSaving(true);
    try {
      const body = {
        title: editTitle,
        content: editContent || null,
        parent_id: editParentId || null,
        status: publish ? "published" : editStatus,
      };

      if (editMode === "edit" && editNodeId) {
        await api(`/knowledge-nodes/${editNodeId}`, {
          method: "PUT",
          body: JSON.stringify({ ...body, status: publish ? "published" : undefined }),
        });
      } else {
        await api("/knowledge-nodes", {
          method: "POST",
          body: JSON.stringify(body),
        });
      }

      setShowEditModal(false);
      fetchTree();
    } catch (e: any) {
      alert(`保存失败：${e.message || e}`);
    } finally {
      setSaving(false);
    }
  };

  const handleFileDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = e.dataTransfer.files;
    if (files.length === 0) return;

    for (const file of Array.from(files)) {
      try {
        const result = await uploadFile<{
          id: string; original_name: string; file_size: number | null; file_type: string;
        }>(
          `/knowledge-nodes/${editNodeId}/files`,
          file
        );
        setEditFiles((prev) => [...prev, result]);
      } catch (err: any) {
        alert(`上传「${file.name}」失败：${err.message || err}`);
      }
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || !editNodeId) return;
    for (const file of Array.from(files)) {
      try {
        const result = await uploadFile<{
          id: string; original_name: string; file_size: number | null; file_type: string;
        }>(
          `/knowledge-nodes/${editNodeId}/files`,
          file
        );
        setEditFiles((prev) => [...prev, result]);
      } catch (err: any) {
        alert(`上传「${file.name}」失败：${err.message || err}`);
      }
    }
  };

  const handleDeleteFile = async (fileId: string) => {
    if (!confirm("确定删除此文件？")) return;
    await api(`/knowledge-files/${fileId}`, { method: "DELETE" });
    setEditFiles((prev) => prev.filter((f) => f.id !== fileId));
  };

  // ── 画布回调 ──

  const handleNodeClick = useCallback((node: TreeNode) => {
    // 点击节点 -> 打开编辑弹窗查看/编辑内容
    openEdit(node.id);
  }, []);

  const handleNodeDragStop = useCallback((nodeId: string, x: number, y: number) => {
    pendingPositions.current.set(nodeId, { x, y });
  }, []);

  const handleNodeContextMenu = useCallback(
    (node: TreeNode, event: React.MouseEvent) => {
      setCtxMenu({ node, x: event.clientX, y: event.clientY });
    },
    []
  );

  if (loading) return <p className="text-text-secondary">加载中...</p>;

  return (
    <div className="h-[calc(100vh-140px)] flex flex-col">
      {/* 顶部工具栏 */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xl font-bold text-primary">知识管理</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={handleAddRoot}
            className="px-4 py-2 bg-primary text-white rounded-md text-sm hover:bg-primary-light transition-colors flex items-center gap-1.5"
          >
            <Plus size={14} /> 新建根节点
          </button>
          <button
            onClick={handleSaveLayout}
            className="px-4 py-2 border border-border rounded-md text-sm text-text-secondary hover:text-text-base hover:bg-bg-layout transition-colors"
          >
            保存布局
          </button>
        </div>
      </div>

      {/* 画布 */}
      <div className="flex-1 rounded-lg border border-border overflow-hidden bg-bg-layout">
        {tree.length === 0 ? (
          <div className="flex items-center justify-center h-full text-text-secondary">
            <div className="text-center">
              <p className="text-sm mb-2">暂无知识节点</p>
              <button
                onClick={handleAddRoot}
                className="px-4 py-2 bg-primary text-white rounded-md text-sm"
              >
                创建第一个知识节点
              </button>
            </div>
          </div>
        ) : (
          <KnowledgeCanvas
            tree={tree}
            editable
            onNodeClick={handleNodeClick}
            onNodeDragStop={handleNodeDragStop}
            onNodeContextMenu={handleNodeContextMenu}
          />
        )}
      </div>

      {/* 右键菜单 */}
      {ctxMenu && (
        <div
          ref={ctxMenuRef}
          className="fixed z-50 bg-bg-base border border-border rounded-lg shadow-lg py-1 min-w-[160px]"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
        >
          <div className="px-3 py-1.5 text-xs text-text-secondary border-b border-border truncate max-w-[200px]">
            {ctxMenu.node.title}
          </div>
          <button
            onClick={() => handleAddChild(ctxMenu.node.id)}
            className="w-full text-left px-3 py-1.5 text-sm hover:bg-bg-layout transition-colors"
          >
            + 添加子节点
          </button>
          <button
            onClick={() => openEdit(ctxMenu.node.id)}
            className="w-full text-left px-3 py-1.5 text-sm hover:bg-bg-layout transition-colors"
          >
            编辑节点
          </button>
          <button
            onClick={() => handleCtxUploadFile(ctxMenu.node.id)}
            className="w-full text-left px-3 py-1.5 text-sm hover:bg-bg-layout transition-colors"
          >
            上传文件
          </button>
          <button
            onClick={() => handleToggleStatus(ctxMenu.node.id, ctxMenu.node.status)}
            className="w-full text-left px-3 py-1.5 text-sm hover:bg-bg-layout transition-colors"
          >
            {ctxMenu.node.status === "published" ? "取消发布" : "发布"}
          </button>
          <div className="border-t border-border">
            <button
              onClick={() => handleDeleteNode(ctxMenu.node.id)}
              className="w-full text-left px-3 py-1.5 text-sm text-red-500 hover:bg-red-50 transition-colors"
            >
              删除节点
            </button>
          </div>
        </div>
      )}
      <input
        type="file"
        ref={(el) => { ctxFileInputRef.current = el; }}
        className="hidden"
        accept=".pdf,.ppt,.pptx,.doc,.docx,.xls,.xlsx,.html,.htm,.png,.jpg,.jpeg,.gif,.svg,.webp,.txt,.md,.csv"
      />

      {/* 编辑弹窗 */}
      {showEditModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
          onClick={() => setShowEditModal(false)}
        >
          <div
            className="bg-bg-base rounded-lg shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h3 className="font-bold text-sm">
                {editMode === "create" ? "新建知识节点" : "编辑知识节点"}
                {editParentId && (
                  <span className="text-text-secondary font-normal ml-2">
                    (子节点)
                  </span>
                )}
              </h3>
              <button
                onClick={() => setShowEditModal(false)}
                className="text-text-secondary hover:text-text-base"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {/* 标题 */}
              <div>
                <label className="block text-sm text-text-secondary mb-1">节点标题</label>
                <input
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="w-full border border-border rounded-md px-3 py-2 text-sm"
                  placeholder="输入知识节点标题"
                />
              </div>

              {/* 富文本正文 */}
              <div>
                <label className="block text-sm text-text-secondary mb-1">正文内容</label>
                <RichEditor content={editContent} onChange={setEditContent} />
              </div>

              {/* 课件文件（仅编辑模式可上传） */}
              {editMode === "edit" && editNodeId && (
                <div>
                  <label className="block text-sm text-text-secondary mb-2">
                    课件文件 ({editFiles.length})
                  </label>

                  {/* 已有文件列表 */}
                  {editFiles.length > 0 && (
                    <div className="space-y-1.5 mb-3">
                      {editFiles.map((f) => (
                        <div
                          key={f.id}
                          onClick={() => {
                            setPreviewFile({
                              id: f.id,
                              original_name: f.original_name,
                              file_size: f.file_size,
                              file_type: f.file_type,
                            });
                            setPreviewApiPath(`/knowledge-files/${f.id}/preview`);
                          }}
                          className="flex items-center gap-2 px-3 py-2 bg-bg-layout rounded-md text-sm group cursor-pointer hover:bg-primary/5 transition-colors"
                        >
                          <span className="px-1.5 py-0.5 bg-primary/10 text-primary rounded text-[11px] font-medium shrink-0 w-10 text-center">
                            {getFileIcon(f.file_type)}
                          </span>
                          <span className="truncate flex-1">{f.original_name}</span>
                          {f.file_size && (
                            <span className="text-xs text-text-secondary shrink-0">
                              {(f.file_size / 1024).toFixed(0)} KB
                            </span>
                          )}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setPreviewFile({
                                id: f.id,
                                original_name: f.original_name,
                                file_size: f.file_size,
                                file_type: f.file_type,
                              });
                              setPreviewApiPath(`/knowledge-files/${f.id}/preview`);
                            }}
                            className="text-text-secondary hover:text-primary shrink-0 p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                            title="预览"
                          >
                            <Eye size={14} />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDeleteFile(f.id); }}
                            className="text-red-400 hover:text-red-600 shrink-0 p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                            title="删除"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* 上传区 */}
                  <div
                    className={`border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors ${
                      dragOver
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-primary/40 hover:bg-bg-layout"
                    }`}
                    onClick={() => fileInputRef.current?.click()}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragOver(true);
                    }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={handleFileDrop}
                  >
                    <Upload size={20} className="mx-auto text-text-secondary mb-1" />
                    <p className="text-sm text-text-secondary">拖拽文件到此处或点击上传</p>
                    <p className="text-xs text-text-secondary/60 mt-0.5">
                      支持 PDF, PPT, Word, Excel, HTML, 图片, TXT
                    </p>
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      className="hidden"
                      accept=".pdf,.ppt,.pptx,.doc,.docx,.xls,.xlsx,.html,.htm,.png,.jpg,.jpeg,.gif,.svg,.webp,.txt,.md,.csv"
                      onChange={handleFileSelect}
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="flex gap-3 px-5 py-4 border-t border-border">
              <button
                onClick={() => handleSave(false)}
                disabled={saving}
                className="px-4 py-2 rounded-md text-sm border border-border hover:bg-bg-layout"
              >
                {editMode === "create" ? "保存草稿" : "保存"}
              </button>
              <button
                onClick={() => handleSave(true)}
                disabled={saving}
                className="px-4 py-2 rounded-md text-sm bg-primary text-white hover:bg-primary-light border border-primary"
              >
                保存并发布
              </button>
              <button
                onClick={() => setShowEditModal(false)}
                className="px-4 py-2 rounded-md text-sm text-text-secondary hover:text-text-base ml-auto border border-border"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 文件预览弹窗 */}
      {previewFile && (
        <FilePreviewModal
          file={previewFile}
          apiPath={previewApiPath}
          onClose={() => { setPreviewFile(null); setPreviewApiPath(""); }}
        />
      )}
    </div>
  );
}