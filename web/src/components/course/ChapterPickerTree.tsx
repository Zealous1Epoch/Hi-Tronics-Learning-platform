/** 章节多选树（课程管理重构 S4，迁自 CourseManage 编辑弹窗 :1384-1488 + handleCreateChapter :647-683）
 *
 * 分类树 + 节点下挂章节勾选 + 行内新建章节。
 * 选择集合受控（selectedIds/onChange）；新建章节直接 POST /chapters 落库，
 * 成功后自动选中并回调 onCreated（父组件把它并入 allChapters）。
 */
import { useMemo, useState } from "react";
import CourseTree, { getCategoryPath, type TreeNode, type FlatCategory } from "../CourseTree";
import { createChapter, type Chapter } from "../../lib/courseApi";
import { useToast } from "../ui/Toast";

interface ChapterPickerTreeProps {
  tree: TreeNode[];
  flatCategories: FlatCategory[];
  /** 全量章节（父组件持有，新建后需并入） */
  allChapters: Chapter[];
  selectedIds: Set<string>;
  onChange: (next: Set<string>) => void;
  onCreated?: (chapter: Chapter) => void;
  /** 初始聚焦的分类节点（一般是左树当前选中分类） */
  initialCategoryId?: string | null;
  /** 挂载时是否展开全部分类节点（编辑态回显时 true 更友好） */
  expandAllOnMount?: boolean;
}

export default function ChapterPickerTree({
  tree,
  flatCategories,
  allChapters,
  selectedIds,
  onChange,
  onCreated,
  initialCategoryId,
  expandAllOnMount = false,
}: ChapterPickerTreeProps) {
  const toast = useToast();
  const [newName, setNewName] = useState("");
  const [newCategoryId, setNewCategoryId] = useState<string>(initialCategoryId || "");
  const [creating, setCreating] = useState(false);
  const [activeCatId, setActiveCatId] = useState<string | null>(initialCategoryId ?? null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => {
    if (!expandAllOnMount) return new Set<string>();
    const collect = (n: TreeNode): string[] => [n.id, ...n.children.flatMap(collect)];
    return new Set(tree.flatMap(collect));
  });

  const chaptersByCategoryId = useMemo(() => {
    const map: Record<string, Chapter[]> = {};
    for (const ch of allChapters) {
      if (!ch.category_id) continue;
      (map[ch.category_id] ||= []).push(ch);
    }
    for (const id in map) map[id].sort((a, b) => a.sort_order - b.sort_order);
    return map;
  }, [allChapters]);

  const toggle = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    onChange(next);
  };

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name || creating) return;
    setCreating(true);
    try {
      const created = await createChapter(name, newCategoryId || null);
      onCreated?.(created);
      // 自动选中
      onChange(new Set([...selectedIds, created.id]));
      setNewName("");
      // 新章节挂载的分类节点及祖先链全部展开，确保立即可见
      if (created.category_id) {
        const catId = created.category_id;
        setExpandedIds(prev => {
          const next = new Set(prev);
          let cur: string | null | undefined = catId;
          while (cur) {
            next.add(cur);
            cur = flatCategories.find(c => c.id === cur)?.parent_id;
          }
          return next;
        });
        setActiveCatId(catId);
        setNewCategoryId(catId);
      }
    } catch (e: any) {
      toast.error(`创建章节失败：${e.message || e}`);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div>
      {/* 新建章节：名称 + 所属分类 */}
      <div className="flex gap-2 mb-2">
        <input
          type="text"
          placeholder="输入新章节名称…"
          value={newName}
          onChange={e => setNewName(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") handleCreate(); }}
          className="flex-1 border border-border rounded-md px-3 py-1.5 text-sm"
        />
        <select
          value={newCategoryId}
          onChange={e => setNewCategoryId(e.target.value)}
          className="border border-border rounded-md px-2 py-1.5 text-sm bg-white shrink-0"
        >
          <option value="">未分类</option>
          {flatCategories.map(c => (
            <option key={c.id} value={c.id}>{getCategoryPath(c.id, flatCategories)}</option>
          ))}
        </select>
        <button
          onClick={handleCreate}
          disabled={!newName.trim() || creating}
          className="k-btn k-btn-primary k-btn-sm shrink-0"
        >
          {creating ? "创建中…" : "新建章节"}
        </button>
      </div>
      {/* 分类树（章节嵌到对应分类节点下勾选） */}
      <div className="border border-border rounded-md p-2 flex flex-col">
        <div className="text-xs text-text-secondary mb-1.5">
          课程分类（点击节点下的章节可勾选分配到本课程）
        </div>
        <CourseTree
          tree={tree}
          flatCategories={flatCategories}
          selectedId={activeCatId}
          onSelect={setActiveCatId}
          rootLabel="全部分类"
          treeContainerClass="max-h-56 border-0 p-0"
          expandedIds={expandedIds}
          onToggleExpanded={setExpandedIds}
          renderNodeFooter={(node) => {
            const list = chaptersByCategoryId[node.id] || [];
            if (list.length === 0) return null;
            return (
              <div className="ml-7 mb-1 space-y-0.5">
                {list.map(ch => (
                  <label
                    key={ch.id}
                    className="flex items-center gap-1.5 py-0.5 px-1 hover:bg-bg-layout rounded text-xs cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={selectedIds.has(ch.id)}
                      onChange={() => toggle(ch.id)}
                      className="shrink-0"
                      onClick={(e) => e.stopPropagation()}
                    />
                    <span className="truncate flex-1 text-text-base">{ch.title}</span>
                    {ch.course_ids.length > 0 && (
                      <span className="text-text-secondary shrink-0">({ch.course_ids.length} 课)</span>
                    )}
                  </label>
                ))}
              </div>
            );
          }}
        />
      </div>
      {/* 已选汇总 */}
      {selectedIds.size > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {[...selectedIds].map(cid => {
            const ch = allChapters.find(c => c.id === cid);
            if (!ch) return null;
            return (
              <span key={cid} className="inline-flex items-center gap-1 px-2 py-0.5 bg-violet-50 text-violet-600 rounded text-xs">
                {ch.category_id ? getCategoryPath(ch.category_id, flatCategories) + " / " : ""}{ch.title}
                <button
                  onClick={() => {
                    const next = new Set(selectedIds);
                    next.delete(cid);
                    onChange(next);
                  }}
                  className="hover:text-red-500 ml-0.5"
                >×</button>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
