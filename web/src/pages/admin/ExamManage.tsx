import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";

interface ExamItem {
  id: string; course_id: string; title: string; paper_type: string;
  duration: number; total_score: number; pass_score: number;
  max_attempts: number | null; start_time: string | null; end_time: string | null;
  status: string; created_at: string;
}
interface CourseItem {
  id: string; title: string;
}
interface ExamFormData {
  title: string; course_id: string; paper_type: string;
  duration: number; total_score: number; pass_score: number;
  max_attempts: number | null;
  start_time: string | null; end_time: string | null;
}

const STATUS_LABELS: Record<string, string> = { draft: "草稿", not_started: "未开始", in_progress: "进行中", ended: "已结束" };
const STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-100 text-gray-600", not_started: "bg-blue-100 text-blue-700",
  in_progress: "bg-green-100 text-green-700", ended: "bg-red-100 text-red-700",
};

export default function ExamManage() {
  const [exams, setExams] = useState<ExamItem[]>([]);
  const [courses, setCourses] = useState<CourseItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [title, setTitle] = useState("");
  const [courseId, setCourseId] = useState("");
  const [paperType, setPaperType] = useState("fixed");
  const [duration, setDuration] = useState(60);
  const [totalScore, setTotalScore] = useState(100);
  const [passScore, setPassScore] = useState(60);
  const [maxAttempts, setMaxAttempts] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");

  const fetchData = async () => {
    const [examsData, coursesData] = await Promise.all([
      api<ExamItem[]>("/exams"),
      api<CourseItem[]>("/courses"),
    ]);
    setExams(examsData);
    setCourses(coursesData);
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  const resetForm = () => {
    setTitle(""); setCourseId(""); setPaperType("fixed");
    setDuration(60); setTotalScore(100); setPassScore(60);
    setMaxAttempts(""); setStartTime(""); setEndTime("");
  };

  const openCreate = () => {
    setEditingId(null);
    resetForm();
    setShowModal(true);
  };

  const openEdit = (e: ExamItem) => {
    setEditingId(e.id);
    setTitle(e.title); setCourseId(e.course_id); setPaperType(e.paper_type);
    setDuration(e.duration); setTotalScore(e.total_score); setPassScore(e.pass_score);
    setMaxAttempts(e.max_attempts?.toString() || "");
    setStartTime(e.start_time ? e.start_time.slice(0, 16) : "");
    setEndTime(e.end_time ? e.end_time.slice(0, 16) : "");
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!title.trim() || !courseId) return;
    setSaving(true);
    const body: ExamFormData = {
      title, course_id: courseId, paper_type: paperType,
      duration, total_score: totalScore, pass_score: passScore,
      max_attempts: maxAttempts ? parseInt(maxAttempts) : null,
      start_time: startTime ? new Date(startTime).toISOString() : null,
      end_time: endTime ? new Date(endTime).toISOString() : null,
    };
    if (editingId) {
      await api(`/exams/${editingId}`, { method: "PUT", body: JSON.stringify(body) });
    } else {
      await api("/exams", { method: "POST", body: JSON.stringify(body) });
    }
    setSaving(false);
    setShowModal(false);
    fetchData();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("确定删除此考试？")) return;
    await api(`/exams/${id}`, { method: "DELETE" });
    fetchData();
  };

  const formatTime = (t: string | null) => {
    if (!t) return "-";
    return new Date(t).toLocaleString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  };

  if (loading) return <p className="text-text-secondary">加载中...</p>;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold text-primary">考试管理</h2>
        <button onClick={openCreate} className="px-4 py-2 bg-primary text-white rounded-md text-sm hover:bg-primary-light">
          新增考试
        </button>
      </div>

      {exams.length === 0 ? (
        <div className="bg-bg-base rounded-lg p-12 border border-border text-center text-text-secondary">
          暂无考试
        </div>
      ) : (
        <div className="bg-bg-base rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-bg-layout border-b border-border">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-text-secondary">考试名称</th>
                <th className="text-left px-4 py-3 font-medium text-text-secondary w-20">组卷方式</th>
                <th className="text-left px-4 py-3 font-medium text-text-secondary w-24">时长/分数</th>
                <th className="text-left px-4 py-3 font-medium text-text-secondary w-28">时间范围</th>
                <th className="text-left px-4 py-3 font-medium text-text-secondary w-16">状态</th>
                <th className="text-right px-4 py-3 font-medium text-text-secondary w-32">操作</th>
              </tr>
            </thead>
            <tbody>
              {exams.map((e) => (
                <tr key={e.id} className="border-b border-border last:border-0 hover:bg-bg-layout/50">
                  <td className="px-4 py-3 font-medium">{e.title}</td>
                  <td className="px-4 py-3 text-text-secondary">{e.paper_type === "fixed" ? "固定" : "随机"}</td>
                  <td className="px-4 py-3 text-text-secondary">{e.duration}分钟 / {e.total_score}分</td>
                  <td className="px-4 py-3 text-xs text-text-secondary">
                    {formatTime(e.start_time)}<br/>~ {formatTime(e.end_time)}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded ${STATUS_COLORS[e.status]}`}>{STATUS_LABELS[e.status]}</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link to={`/admin/exams/${e.id}/paper`} className="text-xs text-primary hover:underline mr-2">组卷</Link>
                    <button onClick={() => openEdit(e)} className="text-xs text-primary hover:underline mr-2">编辑</button>
                    <button onClick={() => handleDelete(e.id)} className="text-xs text-red-500 hover:underline">删除</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black/30 flex items-start justify-center pt-20 z-50" onClick={() => setShowModal(false)}>
          <div className="bg-bg-base rounded-lg shadow-xl p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-lg mb-4">{editingId ? "编辑考试" : "新增考试"}</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-sm text-text-secondary mb-1">考试名称</label>
                <input type="text" value={title} onChange={(e) => setTitle(e.target.value)}
                  className="w-full border border-border rounded-md px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-sm text-text-secondary mb-1">关联课程</label>
                <select value={courseId} onChange={(e) => setCourseId(e.target.value)}
                  className="w-full border border-border rounded-md px-3 py-2 text-sm">
                  <option value="">选择课程</option>
                  {courses.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm text-text-secondary mb-1">组卷方式</label>
                <select value={paperType} onChange={(e) => setPaperType(e.target.value)}
                  className="w-full border border-border rounded-md px-3 py-2 text-sm">
                  <option value="fixed">固定组卷</option>
                  <option value="random">随机组卷</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-text-secondary mb-1">时长(分钟)</label>
                  <input type="number" value={duration} onChange={(e) => setDuration(parseInt(e.target.value) || 0)}
                    className="w-full border border-border rounded-md px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-sm text-text-secondary mb-1">总分</label>
                  <input type="number" value={totalScore} onChange={(e) => setTotalScore(parseInt(e.target.value) || 0)}
                    className="w-full border border-border rounded-md px-3 py-2 text-sm" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-text-secondary mb-1">及格分</label>
                  <input type="number" value={passScore} onChange={(e) => setPassScore(parseInt(e.target.value) || 0)}
                    className="w-full border border-border rounded-md px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-sm text-text-secondary mb-1">最大重考次数</label>
                  <input type="number" value={maxAttempts} onChange={(e) => setMaxAttempts(e.target.value)}
                    placeholder="不限" className="w-full border border-border rounded-md px-3 py-2 text-sm" />
                </div>
              </div>
              <div>
                <label className="block text-sm text-text-secondary mb-1">开放时间</label>
                <input type="datetime-local" value={startTime} onChange={(e) => setStartTime(e.target.value)}
                  className="w-full border border-border rounded-md px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-sm text-text-secondary mb-1">截止时间</label>
                <input type="datetime-local" value={endTime} onChange={(e) => setEndTime(e.target.value)}
                  className="w-full border border-border rounded-md px-3 py-2 text-sm" />
              </div>
            </div>
            <div className="flex gap-3 justify-end mt-6">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 rounded-md text-sm border border-border hover:bg-bg-layout">取消</button>
              <button onClick={handleSave} disabled={saving}
                className="px-4 py-2 rounded-md text-sm bg-primary text-white hover:bg-primary-light disabled:opacity-50">
                {saving ? "保存中..." : "保存"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}