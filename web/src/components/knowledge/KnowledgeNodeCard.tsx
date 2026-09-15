import { Handle, Position } from "@xyflow/react";
import { FileText } from "lucide-react";

export interface KnowledgeNodeData {
  [key: string]: unknown;
  id: string;
  title: string;
  description: string | null;
  content: string | null;
  fileCount: number;
  childCount: number;
  depth: number;
  status: string;
}

// 不同层级的卡片尺寸
const SIZE_MAP = [
  { width: 200, height: 110, fontSize: "text-sm", gap: "gap-2" },   // 根节点
  { width: 170, height: 95, fontSize: "text-[13px]", gap: "gap-1.5" },  // 二级
  { width: 150, height: 80, fontSize: "text-xs", gap: "gap-1" },    // 三级+
];

export default function KnowledgeNodeCard({
  data,
  selected,
}: {
  data: KnowledgeNodeData;
  selected: boolean;
}) {
  const depth = Math.min(data.depth, 2);
  const size = SIZE_MAP[depth];
  const hasChildren = data.childCount > 0;
  const hasFiles = data.fileCount > 0;

  return (
    <div
      className={`rounded-lg border-2 bg-bg-base shadow-sm transition-all cursor-pointer
        ${selected
          ? "border-primary shadow-md ring-2 ring-primary/20"
          : "border-border hover:border-primary/40 hover:shadow-md"
        }
        ${data.status === "draft" ? "opacity-60" : ""}
      `}
      style={{ width: size.width, height: size.height }}
    >
      <Handle type="target" position={Position.Top} className="opacity-0" />
      <Handle type="source" position={Position.Bottom} className="opacity-0" />

      <div className={`flex flex-col items-center justify-center h-full px-3 ${size.gap}`}>
        {/* 标题 */}
        <span className={`${size.fontSize} font-bold text-primary text-center line-clamp-2 leading-snug`}>
          {data.title}
        </span>

        {/* 底部指示器 */}
        <div className="flex items-center gap-2 text-[11px] text-text-secondary">
          {hasFiles && (
            <span className="flex items-center gap-0.5">
              <FileText size={11} />
              {data.fileCount}
            </span>
          )}
          {hasChildren && (
            <span className="text-primary/50">
              +{data.childCount}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}