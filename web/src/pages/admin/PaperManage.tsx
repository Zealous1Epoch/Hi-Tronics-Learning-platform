import { useState, useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";
import PaperCreate from "./PaperCreate";
import CourseTree, { type TreeNode, type FlatCategory, getCategoryPath, buildDescendantMap } from "../../components/CourseTree";
import { Plus } from "lucide-react";

interface PaperItem {
  id: string; title: string; category_id: string | null;
  paper_type: string; total_score: number; status: string;
  mandatory_questions: { question_id: string; score: number }[] | null;
  random_rules: { type: string; difficulty: string; count: number; score: number }[] | null;
  created_at: string;
}

export default function PaperManage() {
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [papers, setPapers] = useState<PaperItem[]>([]);
  const [flatCategories, setFlatCategories] = useState<FlatCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const fetchData = async () => {
    const [treeData, papersData, flatData] = await Promise.all([
      api<TreeNode[]>("/question-categories/tree"),
      api<PaperItem[]>("/papers"),
      api<FlatCategory[]>("/question-categories/flat"),
    ]);
    setTree(treeData);
    setPapers(papersData);
    setFlatCategories(flatData);
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  const handleDeletePaper = async (id: string) => {
    if (!confirm("确定删除此试卷？")) return;
    try {
      await api(`/papers/${id}`, { method: "DELETE" });
      fetchData();
    } catch (e: any) {
      alert(e.message || "删除失败");
    }
  };

  const handleCreateDone = () => {
    setShowCreate(false);
    fetchData();
  };

  const openCreate = () => {
    setShowCreate(true);
  };

  // 使用递归后代匹配筛选试卷（修复精确匹配 bug）
  const categoryDescendants = useMemo(() => buildDescendantMap(flatCategories), [flatCategories]);

  const filteredPapers = useMemo(() => {
    if (!selectedId) return papers;
    const descendantIds = categoryDescendants.get(selectedId);
    if (!descendantIds) return [];
    return papers.filter((p) => p.category_id && descendantIds.has(p.category_id));
  }, [selectedId, papers, categoryDescendants]);

  const getQuestionCount = (p: PaperItem) => {
    if (p.paper_type === "fixed") {
      return p.mandatory_questions?.length || 0;
    }
    const random = p.random_rules?.reduce((sum, r) => sum + r.count, 0) || 0;
    return random;
  };

  if (loading) return <p className="k-empty">加载中...</p>;

  return (
    <div>
      <h2 className="k-title text-[22px] text-primary mb-4">试卷管理</h2>

      <div className="flex gap-4 min-h-[calc(100vh-180px)]">
        {/* 左侧分类树 */}
        <div className="w-56 shrink-0 pr-5">
          <CourseTree
            tree={tree}
            flatCategories={flatCategories}
            selectedId={selectedId}
            onSelect={setSelectedId}
            rootLabel="全部试卷"
            placeholder="搜索分类..."
            loading={loading}
            emptyText="暂无分类"
            treeContainerClass="max-h-[calc(100vh-200px)]"
          />
        </div>

        {/* 右侧试卷列表 */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm text-text-secondary">
              {selectedId ? getCategoryPath(selectedId, flatCategories) : "全部试卷"}
            </span>
            <button
              onClick={openCreate}
              className="k-btn k-btn-primary"
            >
              <Plus size={14} className="inline mr-1" />新增试卷
            </button>
          </div>

          {filteredPapers.length === 0 ? (
            <div className="k-card k-empty">
              暂无试卷
            </div>
          ) : (
            <div className="k-table-wrap overflow-hidden">
              <table className="k-table table-fixed">
                <thead>
                  <tr>
                    {/* table-fixed 下全列给百分比：名称列不再吞掉剩余宽度，各列均匀铺满 */}
                    <th className="text-center w-[24%]">试卷名称</th>
                    <th className="text-center w-[9%]">类型</th>
                    <th className="text-center w-[19%]">类别</th>
                    <th className="text-center w-[10%]">题目数</th>
                    <th className="text-center w-[10%]">总分</th>
                    <th className="text-center w-[12%]">状态</th>
                    <th className="text-center w-[16%]">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPapers.map(p => (
                    <tr key={p.id}>
                      <td className="k-strong truncate text-center">{p.title}</td>
                      <td className="text-center whitespace-nowrap k-muted">
                        {p.paper_type === "fixed" ? "固定" : "随机"}
                      </td>
                      <td className="text-center whitespace-nowrap truncate k-muted">
                        {getCategoryPath(p.category_id, flatCategories)}
                      </td>
                      <td className="text-center whitespace-nowrap k-muted">{getQuestionCount(p)}</td>
                      <td className="text-center whitespace-nowrap k-muted">{p.total_score}</td>
                      <td className="text-center whitespace-nowrap">
                        <span className={p.status === "published" ? "k-tag k-tag-success" : "k-tag"}>
                          {p.status === "published" ? "已发布" : "草稿"}
                        </span>
                      </td>
                      <td className="text-center whitespace-nowrap">
                        <Link to={`/admin/papers/${p.id}`} className="k-link mr-3">编辑</Link>
                        <button onClick={() => handleDeletePaper(p.id)} className="k-link k-link-danger">删除</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {showCreate && (
        <PaperCreate
          defaultCategoryId={selectedId}
          onDone={handleCreateDone}
          onClose={() => setShowCreate(false)}
        />
      )}
    </div>
  );
}