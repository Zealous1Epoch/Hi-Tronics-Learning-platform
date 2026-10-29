import { useState, useEffect, useCallback, useMemo } from "react";
import { api } from "../../lib/api";
import KnowledgeCanvas, { type TreeNode } from "../../components/knowledge/KnowledgeCanvas";
import FilePreviewModal, { type FileItem } from "../../components/knowledge/FilePreviewModal";
import { Search, ChevronRight, X, Eye } from "lucide-react";

interface KnowledgeFileItem {
  id: string;
  original_name: string;
  file_size: number | null;
  file_type: string;
}

interface DetailNode {
  id: string;
  title: string;
  content: string | null;
  files: KnowledgeFileItem[];
}

const FILE_ICON_MAP: Record<string, string> = {
  pdf: "PDF", ppt: "PPT", pptx: "PPT", doc: "DOC", docx: "DOC",
  xls: "XLS", xlsx: "XLS", html: "WEB", htm: "WEB",
  png: "IMG", jpg: "IMG", jpeg: "IMG", gif: "IMG", svg: "IMG", webp: "IMG",
  txt: "TXT", md: "TXT", csv: "CSV",
};

function formatSize(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function KnowledgeBrowse() {
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [loading, setLoading] = useState(true);

  // Prezi 聚焦
  const [focusId, setFocusId] = useState<string | null>(null);

  // 搜索
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<TreeNode[]>([]);

  // 详情面板
  const [detailNode, setDetailNode] = useState<DetailNode | null>(null);
  const [showDetail, setShowDetail] = useState(false);

  // 文件预览
  const [previewFile, setPreviewFile] = useState<FileItem | null>(null);
  const [previewApiPath, setPreviewApiPath] = useState<string>("");

  // 面包屑：从树中计算 focusId 的祖先路径
  const breadcrumb = useMemo(() => {
    if (!focusId) return [];
    const path: { id: string; title: string }[] = [];

    const find = (nodes: TreeNode[], ancestors: { id: string; title: string }[]): boolean => {
      for (const n of nodes) {
        const current = [...ancestors, { id: n.id, title: n.title }];
        if (n.id === focusId) {
          path.push(...current);
          return true;
        }
        if (find(n.children, current)) return true;
      }
      return false;
    };

    find(tree, []);
    return path;
  }, [tree, focusId]);

  // 收集所有已发布节点用于搜索
  const allNodes = useMemo(() => {
    const result: { id: string; title: string }[] = [];
    const walk = (nodes: TreeNode[]) => {
      for (const n of nodes) {
        result.push({ id: n.id, title: n.title });
        walk(n.children);
      }
    };
    walk(tree);
    return result;
  }, [tree]);

  // 搜索
  useEffect(() => {
    if (!search.trim()) {
      setSearchResults([]);
      return;
    }
    const lower = search.toLowerCase();
    const matched = allNodes.filter((n) => n.title.toLowerCase().includes(lower));
    // 最多 8 条结果
    setSearchResults(
      matched.slice(0, 8).map((m) => ({
        id: m.id, title: m.title, description: null, content: null,
        parent_id: null, position_x: null, position_y: null,
        sort_order: 0, status: "published", children: [], files: [],
      }))
    );
  }, [search, allNodes]);

  // 加载数据
  useEffect(() => {
    api<TreeNode[]>("/student/knowledge-nodes")
      .then((data) => {
        setTree(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  // 节点点击 -> Prezi 聚焦，如果叶子节点且无子节点则打开详情
  const handleNodeClick = useCallback(
    async (node: TreeNode) => {
      // 查找该节点的完整信息（含 children）
      const fullNode = await api<TreeNode & { files: KnowledgeFileItem[] }>(
        `/student/knowledge-nodes/${node.id}`
      );

      if (fullNode.children && fullNode.children.length > 0) {
        // 有子节点 -> 聚焦
        setFocusId(node.id);
        setShowDetail(false);
      } else {
        // 叶子节点 -> 打开详情面板
        setDetailNode({
          id: fullNode.id,
          title: fullNode.title,
          content: fullNode.content,
          files: fullNode.files || [],
        });
        setFocusId(node.id);
        setShowDetail(true);
      }
    },
    []
  );

  // 搜索选择
  const handleSearchSelect = (nodeId: string) => {
    setFocusId(nodeId);
    setSearch("");
    setSearchResults([]);
    setShowDetail(false);
    handleNodeClick({ id: nodeId } as TreeNode);
  };

  // 面包屑点击 -> 回退聚焦
  const handleBreadcrumbClick = (nodeId: string) => {
    setFocusId(nodeId);
    setShowDetail(false);
    setDetailNode(null);
  };

  // 预览文件
  const handlePreview = (f: KnowledgeFileItem) => {
    setPreviewFile({
      id: f.id,
      original_name: f.original_name,
      file_size: f.file_size,
      file_type: f.file_type,
    });
    setPreviewApiPath(`/student/knowledge-files/${f.id}/preview`);
  };

  if (loading) return <p className="text-text-secondary">加载中...</p>;

  return (
    <div>
      <h2 className="text-xl font-bold text-primary mb-4">知识地图</h2>

      {/* 搜索栏 */}
      <div className="relative mb-3">
        <div className="flex items-center gap-2 px-3 py-2 bg-bg-base rounded-lg border border-border">
          <Search size={16} className="text-text-secondary shrink-0" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索知识点..."
            className="flex-1 bg-transparent outline-none text-sm"
          />
          {search && (
            <button onClick={() => setSearch("")} className="text-text-secondary hover:text-text-base">
              <X size={14} />
            </button>
          )}
        </div>

        {/* 搜索结果下拉 */}
        {searchResults.length > 0 && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-bg-base border border-border rounded-lg shadow-lg z-20 max-h-60 overflow-y-auto">
            {searchResults.map((r) => (
              <button
                key={r.id}
                onClick={() => handleSearchSelect(r.id)}
                className="w-full text-left px-3 py-2 text-sm hover:bg-bg-layout transition-colors"
              >
                {r.title}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 面包屑 */}
      {breadcrumb.length > 0 && (
        <div className="flex items-center gap-1.5 mb-3 text-sm overflow-x-auto whitespace-nowrap">
          <button
            onClick={() => { setFocusId(null); setShowDetail(false); setDetailNode(null); }}
            className="text-text-secondary hover:text-primary transition-colors"
          >
            知识库
          </button>
          {breadcrumb.map((item, i) => (
            <span key={item.id} className="flex items-center gap-1.5">
              <ChevronRight size={14} className="text-text-secondary" />
              <button
                onClick={() => handleBreadcrumbClick(item.id)}
                className={`hover:text-primary transition-colors ${
                  i === breadcrumb.length - 1
                    ? "text-primary font-medium"
                    : "text-text-secondary"
                }`}
              >
                {item.title}
              </button>
            </span>
          ))}
        </div>
      )}

      {/* 画布 + 详情面板（小屏上下堆叠） */}
      <div className="flex flex-col lg:flex-row gap-4">
        {/* 画布 */}
        <div
          className={`rounded-lg border border-border overflow-hidden bg-bg-layout transition-all ${
            showDetail ? "flex-1" : "flex-1"
          }`}
          style={{ height: "min(60vh, 420px)" }}
        >
          {tree.length === 0 ? (
            <div className="flex items-center justify-center h-full text-text-secondary">
              暂无知识内容
            </div>
          ) : (
            <KnowledgeCanvas
              tree={tree}
              editable={false}
              onNodeClick={handleNodeClick}
              focusNodeId={focusId}
            />
          )}
        </div>

        {/* 详情面板 */}
        {showDetail && detailNode && (
          <div className="w-full lg:w-96 shrink-0 bg-bg-base rounded-lg border border-border overflow-y-auto max-h-[calc(100vh-260px)]">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <h3 className="font-bold text-sm text-primary truncate">{detailNode.title}</h3>
              <button
                onClick={() => { setShowDetail(false); setDetailNode(null); }}
                className="text-text-secondary hover:text-text-base"
              >
                <X size={16} />
              </button>
            </div>

            <div className="p-4 space-y-4">
              {/* 富文本内容 */}
              {detailNode.content ? (
                <div
                  className="prose prose-sm max-w-none text-sm text-text-base"
                  dangerouslySetInnerHTML={{ __html: detailNode.content }}
                />
              ) : (
                <p className="text-sm text-text-secondary">暂无正文内容</p>
              )}

              {/* 课件文件 */}
              {detailNode.files && detailNode.files.length > 0 && (
                <div>
                  <h4 className="text-sm font-bold text-text-base mb-2">
                    课件资料 ({detailNode.files.length})
                  </h4>
                  <div className="space-y-1.5">
                    {detailNode.files.map((f) => (
                      <button
                        key={f.id}
                        onClick={() => handlePreview(f)}
                        className="w-full flex items-center gap-2 px-3 py-2 bg-bg-layout rounded-md text-sm hover:bg-primary/5 transition-colors group"
                      >
                        <span className="px-1.5 py-0.5 bg-primary/10 text-primary rounded text-[11px] font-medium shrink-0 w-10 text-center">
                          {FILE_ICON_MAP[f.file_type] || "FILE"}
                        </span>
                        <span className="truncate flex-1 text-left">{f.original_name}</span>
                        {f.file_size && (
                          <span className="text-xs text-text-secondary shrink-0">
                            {formatSize(f.file_size)}
                          </span>
                        )}
                        <Eye
                          size={14}
                          className="text-text-secondary opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                        />
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

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