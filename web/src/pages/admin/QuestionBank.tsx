import { useState, useEffect, useRef } from "react";
import { api } from "../../lib/api";
import QuestionManage, { type QuestionManageHandle } from "./QuestionManage";
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
  const [aiEnabled, setAiEnabled] = useState(false);
  // KPI 题型卡选中态：点击卡片即筛选下方试题列表，再点取消
  const [kpiType, setKpiType] = useState("");
  const qmRef = useRef<QuestionManageHandle>(null);

  const fetchTree = async () => {
    const data = await api<TreeNode[]>("/question-categories/tree");
    setTree(data);
    setLoading(false);
  };

  useEffect(() => { fetchTree(); }, []);

  // 探测 AI 出题可用性（未配置 LLM_API_KEY 时按钮置灰）
  useEffect(() => {
    api<{ enabled: boolean }>("/ai/status")
      .then(s => setAiEnabled(s.enabled))
      .catch(() => setAiEnabled(false));
  }, []);

  // 选中节点变化时加载统计
  useEffect(() => {
    if (selectedId === null) {
      api<CategoryStats>("/question-categories/stats").then(setStats);
    } else {
      api<CategoryStats>(`/question-categories/${selectedId}/stats`).then(setStats);
    }
  }, [selectedId]);

  const formatTime = (t: string | null) => {
    if (!t) return "-";
    return new Date(t).toLocaleString("zh-CN", {
      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    });
  };

  const toggleType = (type: string) => setKpiType((prev) => (prev === type ? "" : type));

  return (
    // 页面锁定在视口高度（100vh - 顶栏 52 - main 上下 padding 44），
    // 溢出只发生在试题列表内部滚动条，整页不再跟随滚动
    <div className="flex flex-col h-[calc(100vh-96px)]">
      <div className="flex gap-4 flex-1 min-h-0">
        {/* 左侧树（超长时树内部滚动，不撑高页面） */}
        <div className="w-56 shrink-0 pr-5 overflow-y-auto min-h-0">
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

        {/* 右侧：KPI 面板 + 试题列表 */}
        <div className="flex-1 min-w-0 flex flex-col min-h-0">
          {/* KPI 面板：题库统计 + 操作入口 */}
          <div className="bg-bg-layout/50 rounded-lg p-4 mb-4 shrink-0">
            <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
              <div className="flex items-baseline gap-2 min-w-0">
                {/* 页面标题并入 KPI 头部，省去独立标题行的留白 */}
                <h2 className="font-bold text-base text-primary whitespace-nowrap">试题管理</h2>
                <span className="text-border-dark whitespace-nowrap">/</span>
                <h3 className="font-bold text-sm text-primary truncate">{stats?.name || "加载中..."}</h3>
                {stats && (
                  <span className="text-[11px] text-text-secondary/60 whitespace-nowrap">
                    {stats.is_leaf ? "叶子题库" : stats.child_count > 0 ? `容器节点 / ${stats.child_count} 个子节点` : "全部题库"}
                    · 创建于 {formatTime(stats.created_at)}
                  </span>
                )}
              </div>
              <div className="flex gap-2 shrink-0">
                <button onClick={() => qmRef.current?.handleExport()} className="px-3 py-1.5 border border-border rounded-md text-xs hover:bg-bg-layout">导出</button>
                <button onClick={() => qmRef.current?.openImport()} className="px-3 py-1.5 border border-border rounded-md text-xs hover:bg-bg-layout">批量导入</button>
                <button
                  onClick={() => aiEnabled && qmRef.current?.openAI()}
                  disabled={!aiEnabled}
                  title={aiEnabled ? "按主题关键词 AI 生成题目草稿，人工审核后入库" : "AI 功能未启用：服务端未配置 LLM_API_KEY"}
                  className={`px-3 py-1.5 border border-border rounded-md text-xs ${aiEnabled ? "hover:bg-bg-layout" : "opacity-50 cursor-not-allowed"}`}
                >AI 出题</button>
                <button onClick={() => qmRef.current?.openCreate()} className="px-3.5 py-1.5 bg-primary text-white rounded-md text-xs hover:bg-primary-light">新增试题</button>
              </div>
            </div>
            <div className="grid grid-cols-6 gap-2">
              <button onClick={() => setKpiType("")}
                title="清除题型筛选"
                className={`flex flex-col items-start gap-0.5 px-3 py-2 rounded border text-xs transition-colors cursor-pointer ${
                  kpiType === "" ? "border-primary bg-primary/5" : "border-transparent bg-bg-base/80 hover:bg-bg-base"
                }`}>
                <span className="text-text-secondary">总题数</span>
                <span className="font-bold text-base text-text-base">{stats?.total_count ?? "-"}</span>
              </button>
              {TYPES.map((type) => (
                <button key={type} onClick={() => toggleType(type)}
                  title={kpiType === type ? "取消筛选" : `只看${TYPE_LABELS[type]}`}
                  className={`flex flex-col items-start gap-0.5 px-3 py-2 rounded border text-xs transition-colors cursor-pointer ${
                    kpiType === type ? "border-primary bg-primary/5" : "border-transparent bg-bg-base/80 hover:bg-bg-base"
                  }`}>
                  <span className="text-text-secondary">{TYPE_LABELS[type]}</span>
                  <span className="font-bold text-base text-text-base">{stats ? stats[type] : "-"}</span>
                </button>
              ))}
            </div>
          </div>

          {/* 试题列表 */}
          {stats && !stats.is_leaf && selectedId !== null ? (
            <div className="bg-bg-base rounded-lg p-12 border border-border text-center text-text-secondary">
              该题库为容器节点（题数统计已含子题库），请选择子题库管理试题
            </div>
          ) : (
            <QuestionManage ref={qmRef} categoryId={selectedId} externalTypeFilter={kpiType} onTypeFilterChange={setKpiType} />
          )}
        </div>
      </div>
    </div>
  );
}
