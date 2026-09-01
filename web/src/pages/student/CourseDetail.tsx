import { useState, useEffect } from "react";
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

export default function CourseDetail() {
  const { id } = useParams();
  const [course, setCourse] = useState<CourseDetail | null>(null);
  const [activeVideoIdx, setActiveVideoIdx] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<CourseDetail>(`/courses/${id}`).then((data) => {
      setCourse(data);
      setLoading(false);
    });
  }, [id]);

  if (loading) return <p className="text-text-secondary">加载中...</p>;
  if (!course) return <p className="text-text-secondary">课程不存在</p>;

  const activeVideo = course.videos[activeVideoIdx];

  const handleProgress = (seconds: number) => {
    if (!activeVideo) return;
    const duration = activeVideo.duration || 0;
    api("/student/progress", {
      method: "POST",
      body: JSON.stringify({
        video_id: activeVideo.id,
        course_id: course.id,
        watched_seconds: seconds,
        total_seconds: duration,
      }),
    }).catch(() => {}); // 静默失败，不影响播放体验
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
                src={`/api/videos/stream/${activeVideo.obs_key}?token=${localStorage.getItem("token") || ""}`}
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
          {course.exam_id && (
            <div className="mt-4">
              <Link
                to={`/student/exams/${course.exam_id}`}
                className="inline-block px-6 py-2 bg-primary text-white rounded-md text-sm hover:bg-primary-light"
              >
                开始考试
              </Link>
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