import { useState, useEffect, useRef } from "react";
import { useParams, Link } from "react-router-dom";
import { api } from "../../lib/api";
import VideoPlayer from "../../components/VideoPlayer";

interface VideoItem {
  id: string; course_id: string; title: string; obs_key: string;
  duration: number | null; sort_order: number;
}
interface CourseDetail {
  id: string; title: string; description: string | null;
  videos: VideoItem[]; exam_id: string | null;
}
interface ExamInfo {
  status: string;
}

// 进度上报失败时的本地缓存 key
const PROGRESS_BACKLOG_KEY = "progress_backlog";

interface BacklogItem {
  video_id: string;
  course_id: string;
  watched_seconds: number;
  total_seconds: number;
}

function getBacklog(): BacklogItem[] {
  try {
    return JSON.parse(localStorage.getItem(PROGRESS_BACKLOG_KEY) || "[]");
  } catch {
    return [];
  }
}

function addToBacklog(item: BacklogItem) {
  const backlog = getBacklog();
  // 去重：同一视频只保留最新的
  const filtered = backlog.filter((b) => b.video_id !== item.video_id);
  filtered.push(item);
  localStorage.setItem(PROGRESS_BACKLOG_KEY, JSON.stringify(filtered));
}

function clearBacklog() {
  localStorage.removeItem(PROGRESS_BACKLOG_KEY);
}

async function flushBacklog() {
  const backlog = getBacklog();
  if (backlog.length === 0) return;
  for (const item of backlog) {
    try {
      await api("/student/progress", {
        method: "POST",
        body: JSON.stringify(item),
      });
    } catch {
      return; // 网络不通就停止，保留剩余数据
    }
  }
  clearBacklog();
}

export default function CourseDetail() {
  const { id } = useParams();
  const [course, setCourse] = useState<CourseDetail | null>(null);
  const [activeVideoIdx, setActiveVideoIdx] = useState(0);
  const [loading, setLoading] = useState(true);
  const [examStatus, setExamStatus] = useState<string | null>(null);
  const [playUrl, setPlayUrl] = useState<string>("");
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    // 尝试刷新之前失败的进度上报
    flushBacklog();

    api<CourseDetail>(`/courses/${id}`).then(async (data) => {
      if (!mountedRef.current) return;
      setCourse(data);
      // 检查考试状态
      if (data.exam_id) {
        try {
          const exam = await api<ExamInfo>(`/student/exams/${data.exam_id}/status`);
          if (mountedRef.current) setExamStatus(exam.status);
        } catch {
          if (mountedRef.current) setExamStatus(null);
        }
      }
      setLoading(false);
    });

    return () => { mountedRef.current = false; };
  }, [id]);

  // 切换视频时获取短期播放 token
  useEffect(() => {
    if (!course || course.videos.length === 0) return;
    const activeVideo = course.videos[activeVideoIdx];
    if (!activeVideo) return;

    let cancelled = false;
    api<{ url: string }>(`/videos/play-url/${activeVideo.obs_key}`)
      .then((res) => {
        if (!cancelled) setPlayUrl(res.url);
      })
      .catch(() => {
        if (!cancelled) setPlayUrl("");
      });

    return () => { cancelled = true; };
  }, [course, activeVideoIdx]);

  if (loading) return <p className="text-text-secondary">加载中...</p>;
  if (!course) return <p className="text-text-secondary">课程不存在</p>;

  const activeVideo = course.videos[activeVideoIdx];

  const handleProgress = async (seconds: number) => {
    if (!activeVideo) return;
    const duration = activeVideo.duration || 0;
    const payload = {
      video_id: activeVideo.id,
      course_id: course.id,
      watched_seconds: seconds,
      total_seconds: duration,
    };
    try {
      await api("/student/progress", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      // 上报成功后尝试刷新积压数据
      flushBacklog();
    } catch {
      // 上报失败时缓存到本地，下次恢复
      addToBacklog(payload);
    }
  };

  return (
    <div>
      <h2 className="text-xl font-bold text-primary mb-4">{course.title}</h2>
      <div className="flex gap-4">
        {/* 播放器 */}
        <div className="flex-1 min-w-0">
          {activeVideo ? (
            <div className="bg-black rounded-lg overflow-hidden">
              <VideoPlayer
                key={activeVideo.id}
                src={playUrl}
                onProgress={handleProgress}
              />
            </div>
          ) : (
            <div className="bg-bg-base rounded-lg p-12 text-center text-text-secondary border border-border">
              暂无视频章节
            </div>
          )}
          {course.description && (
            <p className="mt-4 text-sm text-text-secondary">{course.description}</p>
          )}
          {course.exam_id && examStatus === "published" && (
            <div className="mt-4">
              <Link
                to={`/student/exams/${course.exam_id}`}
                className="inline-block px-6 py-2 bg-primary text-white rounded-md text-sm hover:bg-primary-light"
              >
                开始考试
              </Link>
            </div>
          )}
          {course.exam_id && examStatus === "ended" && (
            <div className="mt-4">
              <span className="inline-block px-6 py-2 bg-bg-layout text-text-secondary rounded-md text-sm border border-border">
                考试已结束
              </span>
            </div>
          )}
        </div>

        {/* 章节列表 */}
        <div className="w-64 flex-shrink-0">
          <div className="bg-bg-base rounded-lg border border-border">
            <div className="px-4 py-3 border-b border-border font-bold text-sm">章节列表</div>
            {course.videos.map((v, i) => (
              <button
                key={v.id}
                onClick={() => setActiveVideoIdx(i)}
                className={`w-full text-left px-4 py-2.5 text-sm border-b border-border last:border-0 hover:bg-bg-layout transition-colors ${
                  i === activeVideoIdx ? "bg-primary/5 text-primary font-medium" : "text-text-secondary"
                }`}
              >
                <span className="mr-2">{i + 1}.</span>
                {v.title}
                {v.duration && (
                  <span className="text-text-secondary ml-2">
                    ({Math.floor(v.duration / 60)}:{String(v.duration % 60).padStart(2, "0")})
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}