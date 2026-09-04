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

interface SiblingCourse {
  id: string;
  title: string;
  videos: { id: string; title: string; duration: number | null }[];
}

interface SiblingChapters {
  root_category_name: string | null;
  courses: SiblingCourse[];
}

export default function CourseDetail() {
  const { id } = useParams();
  const [course, setCourse] = useState<CourseDetail | null>(null);
  const [activeVideoIdx, setActiveVideoIdx] = useState(0);
  const [loading, setLoading] = useState(true);
  const [examStatus, setExamStatus] = useState<string | null>(null);
  const [progress, setProgress] = useState<CourseProgress | null>(null);
  const [playUrl, setPlayUrl] = useState<string | null>(null);
  const [siblingChapters, setSiblingChapters] = useState<SiblingChapters | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    api<CourseDetail>(`/courses/${id}`).then(async (data) => {
      if (!mountedRef.current) return;
      setCourse(data);
      // 获取视频进度
      api<CourseProgress>(`/student/progress/${id}`).then((p) => {
        if (mountedRef.current) setProgress(p);
      }).catch(() => {});
      // 查询同根分类章节
      api<SiblingChapters>(`/student/courses/${id}/sibling-chapters`).then((s) => {
        if (mountedRef.current) setSiblingChapters(s);
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

  const handleProgress = (seconds: number, duration: number) => {
    if (!activeVideo) return;
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
      .catch(() => {});
  };

  const handleVideoEnded = () => {
    api<CourseProgress>(`/student/progress/${course.id}`)
      .then((p) => setProgress(p))
      .catch(() => {});
  };

  const formatDuration = (d: number | null) => {
    if (!d) return "";
    return `${Math.floor(d / 60)}:${String(d % 60).padStart(2, "0")}`;
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
                key={activeVideo.id}
                src={playUrl}
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
                  to={`/student/exams/${course.exam_id}`}
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

        {/* 右侧：同根分类章节列表 */}
        <div className="w-64 flex-shrink-0">
          <div className="bg-bg-base rounded-lg border border-border">
            <div className="px-4 py-3 border-b border-border font-bold text-sm">
              {siblingChapters?.root_category_name
                ? `${siblingChapters.root_category_name} - 章节`
                : "章节列表"}
            </div>
            <div className="max-h-[calc(100vh-240px)] overflow-y-auto">
              {siblingChapters && siblingChapters.courses.length > 0 ? (
                siblingChapters.courses.map((sc) => {
                  const isCurrentCourse = sc.id === course.id;
                  return (
                    <div key={sc.id}>
                      {/* 课程标题 */}
                      <div className={`px-4 py-2 text-xs font-bold border-b border-border ${
                        isCurrentCourse ? "text-primary" : "text-text-secondary"
                      }`}>
                        {isCurrentCourse ? "▼ " : ""}{sc.title}
                      </div>
                      {/* 视频列表 */}
                      {sc.videos.map((v, vi) => {
                        const isActive = isCurrentCourse && course.videos[activeVideoIdx]?.id === v.id;
                        return isCurrentCourse ? (
                          <button
                            key={v.id}
                            onClick={() => {
                              const idx = course.videos.findIndex((cv) => cv.id === v.id);
                              if (idx >= 0) setActiveVideoIdx(idx);
                            }}
                            className={`w-full text-left px-4 py-2 text-sm border-b border-border last:border-0 hover:bg-bg-layout transition-colors ${
                              isActive ? "bg-primary/5 text-primary font-medium" : "text-text-secondary"
                            }`}
                          >
                            <span className="mr-2">{vi + 1}.</span>
                            {v.title}
                            {v.duration && (
                              <span className="text-text-secondary ml-2">({formatDuration(v.duration)})</span>
                            )}
                          </button>
                        ) : (
                          <Link
                            key={v.id}
                            to={`/student/courses/${sc.id}`}
                            className="block w-full text-left px-4 py-2 text-sm border-b border-border last:border-0 hover:bg-bg-layout transition-colors text-text-secondary"
                          >
                            <span className="mr-2">{vi + 1}.</span>
                            {v.title}
                            {v.duration && (
                              <span className="text-text-secondary ml-2">({formatDuration(v.duration)})</span>
                            )}
                          </Link>
                        );
                      })}
                    </div>
                  );
                })
              ) : (
                <>
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
                          ({formatDuration(v.duration)})
                        </span>
                      )}
                    </button>
                  ))}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}