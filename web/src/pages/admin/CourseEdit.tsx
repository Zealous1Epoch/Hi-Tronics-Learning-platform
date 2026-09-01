import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api, uploadFile } from "../../lib/api";

interface CategoryItem {
  id: string; name: string; children: CategoryItem[];
}
interface VideoItem {
  id: string; course_id: string; title: string; obs_key: string;
  file_size: number | null; duration: number | null; sort_order: number;
}
interface CourseDetail {
  id: string; title: string; description: string | null;
  cover_image: string | null; category_id: string | null;
  exam_id: string | null; status: string;
  videos: VideoItem[]; video_count: number;
}

function flattenCategories(cats: CategoryItem[], depth = 0): { id: string; name: string }[] {
  return cats.flatMap((c) => [
    { id: c.id, name: "  ".repeat(depth) + c.name },
    ...flattenCategories(c.children, depth + 1),
  ]);
}

export default function CourseEdit() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isNew = id === "new";

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api<CategoryItem[]>("/categories").then((data) => setCategories(flattenCategories(data)));
    if (!isNew) {
      api<CourseDetail>(`/courses/${id}`).then((data) => {
        setTitle(data.title);
        setDescription(data.description || "");
        setCategoryId(data.category_id || "");
        setVideos(data.videos);
        setLoading(false);
      });
    }
  }, [id]);

  const handleSave = async (status: string) => {
    if (!title.trim()) return;
    setSaving(true);
    const body = { title, description, category_id: categoryId || null, status };
    if (isNew) {
      const course = await api<CourseDetail>("/courses", { method: "POST", body: JSON.stringify(body) });
      navigate(`/admin/courses/${course.id}/edit`, { replace: true });
    } else {
      await api(`/courses/${id}`, { method: "PUT", body: JSON.stringify(body) });
    }
    setSaving(false);
  };

  const handleAddVideo = async () => {
    const title = prompt("视频章节标题：");
    if (!title) return;
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "video/mp4,video/mov,video/avi,video/mkv,video/webm";
    fileInput.onchange = async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      const { filename, file_size } = await uploadFile<{ filename: string; file_size: number }>(
        "/videos/upload", file
      );
      await api(`/courses/${id}/videos`, {
        method: "POST",
        body: JSON.stringify({ title, obs_key: filename, file_size }),
      });
      const data = await api<CourseDetail>(`/courses/${id}`);
      setVideos(data.videos);
    };
    fileInput.click();
  };

  const handleDeleteVideo = async (videoId: string) => {
    if (!confirm("删除此视频？")) return;
    await api(`/videos/${videoId}`, { method: "DELETE" });
    const data = await api<CourseDetail>(`/courses/${id}`);
    setVideos(data.videos);
  };

  if (loading) return <p className="text-text-secondary">加载中...</p>;

  return (
    <div>
      <h2 className="text-xl font-bold text-primary mb-4">
        {isNew ? "新增课程" : `编辑课程: ${title}`}
      </h2>
      <div className="space-y-6 max-w-2xl">
        {/* 基本信息 */}
        <div className="bg-bg-base rounded-lg border border-border p-4">
          <h3 className="font-bold text-sm mb-3">基本信息</h3>
          <div className="space-y-3">
            <div>
              <label className="block text-sm text-text-secondary mb-1">课程标题</label>
              <input
                type="text" value={title} onChange={(e) => setTitle(e.target.value)}
                className="w-full border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
            <div>
              <label className="block text-sm text-text-secondary mb-1">课程分类</label>
              <select
                value={categoryId} onChange={(e) => setCategoryId(e.target.value)}
                className="w-full border border-border rounded-md px-3 py-2 text-sm"
              >
                <option value="">无分类</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm text-text-secondary mb-1">课程简介</label>
              <textarea
                value={description} onChange={(e) => setDescription(e.target.value)}
                rows={3}
                className="w-full border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
          </div>
        </div>

        {/* 视频章节 */}
        {!isNew && (
          <div className="bg-bg-base rounded-lg border border-border p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-sm">视频章节 ({videos.length})</h3>
              <button onClick={handleAddVideo} className="text-sm text-primary hover:underline">添加章节</button>
            </div>
            {videos.length === 0 ? (
              <p className="text-sm text-text-secondary">暂无视频章节</p>
            ) : (
              <div className="space-y-2">
                {videos.map((v, i) => (
                  <div key={v.id} className="flex items-center justify-between py-2 px-3 bg-bg-layout rounded-md">
                    <span className="text-sm">
                      <span className="text-text-secondary mr-2">{i + 1}.</span>
                      {v.title}
                      {v.duration && <span className="text-text-secondary ml-2">({Math.floor(v.duration / 60)}:{String(v.duration % 60).padStart(2, "0")})</span>}
                    </span>
                    <button onClick={() => handleDeleteVideo(v.id)} className="text-xs text-red-500 hover:underline">删除</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 操作按钮 */}
        <div className="flex gap-3">
          <button onClick={() => handleSave("draft")} disabled={saving}
            className="px-4 py-2 rounded-md text-sm border border-border hover:bg-bg-layout">
            保存草稿
          </button>
          <button onClick={() => handleSave("published")} disabled={saving}
            className="px-4 py-2 rounded-md text-sm bg-primary text-white hover:bg-primary-light">
            发布
          </button>
          <button onClick={() => navigate("/admin/courses")}
            className="px-4 py-2 rounded-md text-sm text-text-secondary hover:text-text-base">
            取消
          </button>
        </div>
      </div>
    </div>
  );
}