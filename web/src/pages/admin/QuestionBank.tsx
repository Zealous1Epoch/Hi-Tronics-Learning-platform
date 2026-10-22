import { useState, useEffect } from "react";
import { api } from "../../lib/api";
import QuestionManage from "./QuestionManage";
import CourseTree, { type TreeNode } from "../../components/CourseTree";

interface CategoryStats {
  id: string; name: string; is_leaf: boolean; child_count: number;
  single_choice: number; multi_choice: number; true_false: number;
  fill_blank: number; essay: number; total_count: number;
  created_at: string | null;
}

const TYPES = ["single_choice", "multi_choice", "true_false", "fill_blank", "essay"] as const;

const TYPE_LABELS: Record<string, string> = {
  single_choice: "单选题", multi_choice: "多选题", true_false: "判断题",
  fill_blank: "填空题", essay: "问答题",
};

export default function QuestionBank() {
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [stats, setStats] = useState<CategoryStats | null>(null);
  const [loading, setLoading] = useState(true);
  // KPI 题型卡选中态：点击卡片即筛选下方试题列表，再点取消
  const [kpiType, setKpiType] = useState("");

  const fetchTree = async () => {
    const data = await api<TreeNode[]>("/question-categories/tree");
    setTree(data);
    setLoading(false);
  };

  useEffect(() => { fetchTree(); }, []);

  // 选中节点变化时加载统计
  useEffect(() => {
    if (selectedId === null) {
      api<CategoryStats>("/question-categories/stats").then(setStats);
    } else {
      api<CategoryStats>(`/question-categories/${selectedId}/stats`).then(setStats);
    }
  }, [selectedId]);

  const toggleType = (type: string) => setKpiType((prev) => (prev === type ? "" : type));

  return (
    // 页面锁定在视口高度（100vh - 顶栏 52 - main 上下 padding 44），
    // 溢出只发生在试题列表内部滚动条，整页不再跟随滚动
    <div className="flex flex-col h-[calc(100vh-96px)]">
      {/* KPI 面板：题库题型统计卡，通栏横贯页面左右（操作入口在下方筛选栏右侧） */}
      <div className="k-card p-4 mb-4 shrink-0">
        <div className="grid grid-cols-6 gap-2">
          <button onClick={() => setKpiType("")}
            title="清除题型筛选"
            className={`k-stat-card ${kpiType === "" ? "is-active" : ""}`}>
            <span className="k-stat-label">总题数</span>
            <span className="k-stat-value">{stats?.total_count ?? "-"}</span>
          </button>
          {TYPES.map((type) => (
            <button key={type} onClick={() => toggleType(type)}
              title={kpiType === type ? "取消筛选" : `只看${TYPE_LABELS[type]}`}
              className={`k-stat-card ${kpiType === type ? "is-active" : ""}`}>
              <span className="k-stat-label">{TYPE_LABELS[type]}</span>
              <span className="k-stat-value">{stats ? stats[type] : "-"}</span>
            </button>
          ))}
        </div>
      </div>

      {/* 下半区：左=题库树（超长内部滚动） 右=试题列表，两栏顶部齐平 */}
      <div className="flex gap-4 flex-1 min-h-0">
        <div className="w-56 shrink-0 overflow-y-auto min-h-0">
          <CourseTree
            tree={tree}
            flatCategories={[]}
            selectedId={selectedId}
            onSelect={setSelectedId}
            rootLabel="全部试题"
            placeholder="搜索题库名..."
            loading={loading}
            emptyText="暂无题库"
          />
        </div>
        <div className="flex-1 min-w-0 flex flex-col min-h-0">
          {/* 试题列表 */}
          {stats && !stats.is_leaf && selectedId !== null ? (
            <div className="k-card k-empty">
              该题库为容器节点（题数统计已含子题库），请选择子题库管理试题
            </div>
          ) : (
            <QuestionManage categoryId={selectedId} externalTypeFilter={kpiType} onTypeFilterChange={setKpiType} />
          )}
        </div>
      </div>
    </div>
  );
}
