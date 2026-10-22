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

const tabs = [
  { key: "manage", label: "题库管理" },
  { key: "questions", label: "试题" },
] as const;

type TabKey = (typeof tabs)[number]["key"];

const TYPE_LABELS: Record<string, string> = {
  single_choice: "单选题", multi_choice: "多选题", true_false: "判断题",
  fill_blank: "填空题", essay: "问答题",
};

const STAT_COLORS: Record<string, string> = {
  single_choice: "bg-bg-base/80 text-text-secondary/80 rounded",
  multi_choice: "bg-bg-base/80 text-text-secondary/80 rounded",
  true_false: "bg-bg-base/80 text-text-secondary/80 rounded",
  fill_blank: "bg-bg-base/80 text-text-secondary/80 rounded",
  essay: "bg-bg-base/80 text-text-secondary/80 rounded",
  total: "bg-bg-base text-text-secondary rounded font-medium",
};

export default function QuestionBank() {
  const [activeTab, setActiveTab] = useState<TabKey>("manage");
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [stats, setStats] = useState<CategoryStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [aiEnabled, setAiEnabled] = useState(false);
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

  return (
    <div>
      <h2 className="text-xl font-bold text-primary mb-4">试题管理</h2>

      <div className="flex gap-4 min-h-[calc(100vh-180px)]">
        {/* 左侧树 */}
        <div className="w-56 shrink-0 pr-5">
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

        {/* 右侧面板 */}
        <div className="flex-1 min-w-0">
          <div className="mb-4 pb-3 border-b border-border">
            <div className="flex items-center justify-between">
              <div className="flex gap-3">
                {tabs.map(t => (
                  <button
                    key={t.key}
                    onClick={() => setActiveTab(t.key)}
                    className={`px-4 py-2 rounded-md text-sm transition-colors ${
                      activeTab === t.key
                        ? "bg-primary/5 text-primary font-medium"
                        : "text-text-secondary hover:bg-bg-layout"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              {activeTab === "questions" && (
                <div className="flex gap-2">
                  <button onClick={() => qmRef.current?.handleExport()} className="px-3 py-2 border border-border rounded-md text-sm hover:bg-bg-layout">导出</button>
                  <button onClick={() => qmRef.current?.openImport()} className="px-3 py-2 border border-border rounded-md text-sm hover:bg-bg-layout">批量导入</button>
                  <button
                    onClick={() => aiEnabled && qmRef.current?.openAI()}
                    disabled={!aiEnabled}
                    title={aiEnabled ? "按主题关键词 AI 生成题目草稿，人工审核后入库" : "AI 功能未启用：服务端未配置 LLM_API_KEY"}
                    className={`px-3 py-2 border border-border rounded-md text-sm ${aiEnabled ? "hover:bg-bg-layout" : "opacity-50 cursor-not-allowed"}`}
                  >AI 出题</button>
                  <button onClick={() => qmRef.current?.openCreate()} className="px-4 py-2 bg-primary text-white rounded-md text-sm hover:bg-primary-light">新增试题</button>
                </div>
              )}
            </div>
          </div>

          {/* Tab 1: 题库管理 */}
          {activeTab === "manage" && (
            <div>
              {stats ? (
                <div className="space-y-4">
                  <div className="bg-bg-layout/50 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="font-bold text-sm text-primary">{stats.name}</h3>
                      <span className="text-[11px] text-text-secondary/60">
                        {stats.is_leaf ? "叶子题库" : stats.child_count > 0 ? `容器节点 / ${stats.child_count} 个子节点` : "全部题库"}
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 mb-3">
                      {(["single_choice", "multi_choice", "true_false", "fill_blank", "essay"] as const).map(type => (
                        <div key={type} className={`flex items-center justify-between px-3 py-2 rounded text-xs ${STAT_COLORS[type]}`}>
                          <span>{TYPE_LABELS[type]}</span>
                          <span className="font-bold">{stats[type]}</span>
                        </div>
                      ))}
                      <div className={`flex items-center justify-between px-3 py-2 rounded text-xs ${STAT_COLORS.total}`}>
                        <span>合计</span>
                        <span className="font-bold">{stats.total_count}</span>
                      </div>
                    </div>
                    <p className="text-xs text-text-secondary">
                      创建时间: {formatTime(stats.created_at)}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="bg-bg-base rounded-lg p-12 border border-border text-center text-text-secondary">
                  加载中...
                </div>
              )}
            </div>
          )}

          {/* Tab 2: 试题 */}
          {activeTab === "questions" && (
            <div>
              {selectedId && stats && !stats.is_leaf ? (
                <div className="bg-bg-base rounded-lg p-12 border border-border text-center text-text-secondary">
                  请选择子题库查看试题
                </div>
              ) : (
                <QuestionManage ref={qmRef} categoryId={selectedId} />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}