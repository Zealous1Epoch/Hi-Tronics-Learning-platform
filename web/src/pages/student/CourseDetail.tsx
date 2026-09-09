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
  exam_passed: boolean;
  has_exam: boolean;
}
interface ExamResultItem {
  id: string; score: number; passed: boolean;
  attempt_number: number; submitted_at: string | null;
}

export default function CourseDetail() {
  const { id } = useParams();
  const [course, setCourse] = useState<CourseDetail | null>(null);
  const [activeVideoIdx, setActiveVideoIdx] = useState(0);
  const [loading, setLoading] = useState(true);
  const [examStatus, setExamStatus] = useState<string | null>(null);
  const [examResults, setExamResults] = useState<ExamResultItem[]>([]);
  const [progress, setProgress] = useState<CourseProgress | null>(null);
  const [playUrl, setPlayUrl] = useState<string | null>(null);
  const [currentVideoWatched, setCurrentVideoWatched] = useState(false);
  const [currentWatchSec, setCurrentWatchSec] = useState(0);
  const [currentTotalSec, setCurrentTotalSec] = useState(0);
  const mountedRef = useRef(true);
  const genRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    const gen = ++genRef.current;

    api<CourseDetail>(`/courses/${id}`).then(async (data) => {
      if (!mountedRef.current || gen !== genRef.current) return;
      setCourse(data);
      // 获取视频进度（用于考试解锁判断）
      api<CourseProgress>(`/student/progress/${id}`).then((p) => {
        if (mountedRef.current && gen === genRef.current) setProgress(p);
      }).catch(() => {});
      // 检查考试状态
      if (data.exam_id) {
        try {
          const exam = await api<ExamInfo>(`/student/exams/${data.exam_id}/status`);
          if (mountedRef.current && gen === genRef.current) setExamStatus(exam.status);
        } catch {
          if (mountedRef.current && gen === genRef.current) setExamStatus(null);
        }
        // 获取考试记录
        api<ExamResultItem[]>(`/student/exams/${data.exam_id}/results`).then((r) => {
          if (mountedRef.current && gen === genRef.current) setExamResults(r);
        }).catch(() => {});
      }
      if (gen === genRef.current) setLoading(false);
    });

    return () => { mountedRef.current = false; };
  }, [id]);

  // 切换视频时重置当前视频观看状态，并获取播放 token
  useEffect(() => {
    setCurrentVideoWatched(false);
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
  const isCurrentVideoCompleted = activeVideoProgress?.completed || false;
  const examEnabled = currentVideoWatched || isCurrentVideoCompleted;

  const handleProgress = (seconds: number, duration: number) => {
    setCurrentWatchSec(seconds);
    setCurrentTotalSec(duration);
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

  // 视频播放结束，当前视频已看完，解锁考试按钮
  const handleVideoEnded = () => {
    setCurrentVideoWatched(true);
    // 强制发送完成状态到后端（播放器最后一次 onProgress 可能不到 100%）
    if (activeVideo) {
      const total = currentTotalSec > 0 ? currentTotalSec : (activeVideo.duration || 0);
      if (total > 0) {
        api("/student/progress", {
          method: "POST",
          body: JSON.stringify({
            video_id: activeVideo.id,
            course_id: course.id,
            watched_seconds: total,
            total_seconds: total,
          }),
        }).catch(() => {});
      }
    }
    api<CourseProgress>(`/student/progress/${course.id}`)
      .then((p) => setProgress(p))
      .catch(() => {});
  };

  // 计算课程整体进度（80%视频 + 20%考试）
  const totalVideos = course.videos.length;
  const hasExam = progress?.has_exam ?? (course.exam_id != null);
  const videoWeight = hasExam ? 80 : 100;
  const perVideoWeight = totalVideos > 0 ? videoWeight / totalVideos : 0;
  const isActiveDone = isCurrentVideoCompleted || currentVideoWatched;

  let videoProgress: number;
  if (totalVideos === 0) {
    videoProgress = 0;
  } else if (isActiveDone) {
    // 当前视频已看完，直接用服务器返回的完成数
    videoProgress = (progress?.completed_count || 0) * perVideoWeight;
  } else {
    // 当前视频正在观看，用服务器完成数 + 当前视频的局部进度
    const ratio = currentTotalSec > 0 ? Math.min(currentWatchSec / currentTotalSec, 1) : 0;
    videoProgress = ((progress?.completed_count || 0) + ratio) * perVideoWeight;
  }
  const examProgress = hasExam && progress?.exam_passed ? 20 : 0;
  const totalProgress = Math.round(videoProgress + examProgress);

  return (
    <div>
      <h2 className="text-xl font-bold text-primary mb-4">{course.title}</h2>

      {/* 课程整体进度条 */}
      <div className="mb-3 px-1">
        <div className="flex items-center justify-between text-xs text-text-secondary mb-1">
          <span>课程进度</span>
          <span className="text-primary font-medium">{totalProgress || 0}%</span>
        </div>
        {hasExam ? (
          <div className="flex w-full bg-bg-layout rounded-full h-1.5 overflow-hidden">
            <div className="bg-primary transition-all" style={{ width: `${videoProgress || 0}%` }} />
            {examProgress > 0 && <div className="bg-[#4CAF50] transition-all" style={{ width: `${examProgress}%` }} />}
          </div>
        ) : (
          <div className="w-full bg-bg-layout rounded-full h-1.5">
            <div className="h-1.5 rounded-full transition-all bg-primary" style={{ width: `${totalProgress || 0}%` }} />
          </div>
        )}
      </div>

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
              {course.videos.length > 0 && !examEnabled ? (
                <div>
                  <span className="inline-block px-6 py-2 bg-bg-layout text-text-secondary rounded-md text-sm border border-border cursor-not-allowed">
                    完成当前章节视频后可开始考试
                  </span>
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
          {/* 考试记录 */}
          {examResults.length > 0 && (
            <div className="mt-6">
              <h3 className="text-sm font-bold text-primary mb-3">考试记录</h3>
              <div className="space-y-2">
                {examResults.map((r) => (
                  <div key={r.id} className="bg-bg-base rounded-lg border border-border p-3 flex items-center justify-between">
                    <div>
                      <span className="text-sm font-medium">第 {r.attempt_number} 次</span>
                      <span className={`ml-3 text-sm font-medium ${r.passed ? "text-green-600" : "text-primary"}`}>
                        {r.score} 分 {r.passed ? "(通过)" : "(未通过)"}
                      </span>
                    </div>
                    <Link
                      to={`/student/exams/${course.exam_id}?courseId=${course.id}&review=${r.id}`}
                      className="text-sm text-primary hover:underline"
                    >
                      查看详情
                    </Link>
                  </div>
                ))}
              </div>
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