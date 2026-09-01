import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";

interface CourseItem {
  id: string;
  title: string;
  category_id: string | null;
  status: string;
  video_count: number;
  created_at: string;
}

export default function CourseManage() {
  const [courses, setCourses] = useState<CourseItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const fetchCourses = async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (statusFilter) params.set("status", statusFilter);
    const data = await api<CourseItem[]>(`/courses?${params}`);
    setCourses(data);
    setLoading(false);
  };

  useEffect(() => { fetchCourses(); }, []);

  const handleDelete = async (id: string) => {
    if (!confirm("确定删除？")) return;
    await api(`/courses/${id}`, { method: "DELETE" });
    fetchCourses();
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold text-primary">课程管理</h2>
        <Link
          to="/admin/courses/new/edit"
          className="bg-primary text-white px-4 py-2 rounded-md text-sm"
        >
          新增课程
        </Link>
      </div>
      <div className="bg-bg-base rounded-lg border border-border">
        <div className="p-4 border-b border-border flex gap-3">
          <input
            type="text" placeholder="搜索课程..."
            value={search} onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && fetchCourses()}
            className="border border-border rounded-md px-3 py-1.5 text-sm w-64"
          />
          <select
            value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
            className="border border-border rounded-md px-3 py-1.5 text-sm"
          >
            <option value="">全部状态</option>
            <option value="draft">草稿</option>
            <option value="published">已发布</option>
          </select>
          <button onClick={fetchCourses} className="bg-primary text-white px-4 py-1.5 rounded-md text-sm">搜索</button>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-bg-layout border-b border-border">
            <tr>
              <th className="text-left px-4 py-3 text-text-secondary font-normal">课程名称</th>
              <th className="text-left px-4 py-3 text-text-secondary font-normal">视频数</th>
              <th className="text-left px-4 py-3 text-text-secondary font-normal">状态</th>
              <th className="text-left px-4 py-3 text-text-secondary font-normal">创建时间</th>
              <th className="text-left px-4 py-3 text-text-secondary font-normal">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="text-center py-8 text-text-secondary">加载中...</td></tr>
            ) : courses.length === 0 ? (
              <tr><td colSpan={5} className="text-center py-8 text-text-secondary">暂无课程</td></tr>
            ) : (
              courses.map((c) => (
                <tr key={c.id} className="border-b border-border hover:bg-bg-layout">
                  <td className="px-4 py-3 font-medium">{c.title}</td>
                  <td className="px-4 py-3 text-text-secondary">{c.video_count}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs ${
                      c.status === "published" ? "bg-green-50 text-green-700" : "bg-border text-text-secondary"
                    }`}>
                      {c.status === "published" ? "已发布" : "草稿"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-text-secondary">
                    {new Date(c.created_at).toLocaleDateString("zh-CN")}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <Link to={`/admin/courses/${c.id}/edit`} className="text-xs text-primary hover:underline">编辑</Link>
                      <Link to={`/admin/courses/${c.id}/assign`} className="text-xs text-primary hover:underline">分配</Link>
                      <button onClick={() => handleDelete(c.id)} className="text-xs text-red-500 hover:underline">删除</button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}