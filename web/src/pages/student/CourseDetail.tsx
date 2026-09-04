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
interface CourseProgress {
  video_progress: Record<string, { watched_seconds: number; total_seconds: number; completed: boolean }>;
  completed_count: number;
  total_count: number;
}

export default function CourseDetail() {
  const { id } = useParams();
  const [course, setCourse] = useState<CourseDetail | null>(null);
  const [activeVideoIdx, setActiveVideoIdx] = useState(0);
  const [loading, setLoading] = useState(true);
  const [examStatus, setExamStatus] = useState<string | null>(null);
  const [progress, setProgress] = useState<CourseProgress | null>(null);
  const [playUrl, setPlayUrl] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    api<CourseDetail>(`/courses/${id}`).then(async (data) => {
      if (!mountedRef.current) return;
      setCourse(data);
      // 获取视频进度（用于考试解锁判断）
      api<CourseProgress>(`/student/progress/${id}`).then((p) => {
        if (mountedRef.current) setProgress(p);
      }).catch(() => {});
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
        if (!cancelled) setPlayUrl(null);
      });

    return () => { cancelled = true; };
  }, [course, activeVideoIdx]);

  if (loading) return <p className="text-text-secondary">加载中...</p>;
  if (!course) return <p className="text-text-secondary">课程不存在</p>;

  const activeVideo = course.videos[activeVideoIdx];

  // 从进度数据中获取当前视频的已看位置，用于恢复播放
  const activeVideoProgress = activeVideo && progress
    ? progress.video_progress[activeVideo.id]
    : null;
  const resumeTime = activeVideoProgress?.watched_seconds || 0;

  const handleProgress = (seconds: number, duration: number) => {
    if (!activeVideo) return;
    // 优先用播放器实测时长，videos 表的 duration 可能为空
    const total = duration > 0 ? duration : (activeVideo.duration || 0);
    api("/student/progress", {
      method: "POST",
      body: JSON.stringify({
        video_id: activeVideo.id,
        course_id: course.id,
        watched_seconds: seconds,
        total_seconds: total,
      }),
    })
      .catch(() => {}); // 静默失败，不影响播放体验
  };

  // 视频播放结束，直接刷新进度解锁考试入口
  const handleVideoEnded = () => {
    api<CourseProgress>(`/student/progress/${course.id}`)
      .then((p) => setProgress(p))
      .catch(() => {});
  };

  return (
    <div>
      <h2 className="text-xl font-bold text-primary mb-4">{course.title}</h2>
      <div className="flex gap-4">
        {/* 播放器 */}
        <div className="flex-1 min-w-0">
          {activeVideo && playUrl ? (
            <div className="bg-black rounded-lg overflow-hidden">
              <VideoPlayer
                key={`${activeVideo.id}-${resumeTime}`}
                src={playUrl}
                startTime={resumeTime}
                onProgress={handleProgress}
                onVideoEnded={handleVideoEnded}
                disableSeek
              />
            </div>
          ) : activeVideo ? (
            <div className="bg-black rounded-lg overflow-hidden flex items-center justify-center h-48 text-text-secondary">
              加载视频中...
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
              {/* 课程无视频时直接解锁考试；有视频则需全部看完 */}
              {course.videos.length > 0 && progress && progress.completed_count < progress.total_count ? (
                <div>
                  <span className="inline-block px-6 py-2 bg-bg-layout text-text-secondary rounded-md text-sm border border-border cursor-not-allowed">
                    完成所有章节视频后可开始考试
                  </span>
                  <p className="mt-1 text-xs text-text-secondary">
                    观看进度：{progress.completed_count}/{progress.total_count}
                  </p>
                </div>
              ) : (
                <Link
                  to={`/student/exams/${course.exam_id}?courseId=${course.id}`}
                  className="inline-block px-6 py-2 bg-primary text-white rounded-md text-sm hover:bg-primary-light"
                >
                  开始考试
                </Link>
              )}
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