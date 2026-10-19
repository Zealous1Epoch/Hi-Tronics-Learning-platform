import { useState, useEffect, useRef, useMemo } from "react";
import { useParams, Link } from "react-router-dom";
import { ChevronRight, ChevronDown, FileText } from "lucide-react";
import { api } from "../../lib/api";
import { videoStreamUrl } from "../../lib/courseApi";
import VideoPlayer from "../../components/VideoPlayer";
import StudentCheckInCard, { type MyAttendance } from "../../components/attendance/StudentCheckInCard";
import MaterialViewer, { type MaterialFile } from "../../components/course/MaterialViewer";

interface VideoItem {
  id: string; course_id: string; chapter_id: string | null;
  title: string; obs_key: string;
  duration: number | null; sort_order: number;
}
interface ChapterItem {
  id: string; course_id: string; title: string; sort_order: number;
  videos: VideoItem[];
}
/** 课程课件（PDF/PPT/HTML——与视频同级的课程内容，无视频课程也成立） */
type MaterialItem = MaterialFile;
interface CourseDetail {
  id: string; title: string; description: string | null;
  // 历史字段保留（响应兼容）
  course_type: string;
  /** 历史字段保留（响应兼容）；签到卡片按 attendance.required_count 渲染 */
  require_attendance: boolean;
  chapters: ChapterItem[];
  videos: VideoItem[];
  materials?: MaterialItem[];
  exam_id: string | null;
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
  const [attendance, setAttendance] = useState<MyAttendance | null>(null);
  const [playUrl, setPlayUrl] = useState<string | null>(null);
  /** 当前打开的课件 id（null=看视频；无视频课程自动落到第一个课件） */
  const [activeMaterialId, setActiveMaterialId] = useState<string | null>(null);
  const [currentVideoWatched, setCurrentVideoWatched] = useState(false);
  const [currentWatchSec, setCurrentWatchSec] = useState(0);
  const [currentTotalSec, setCurrentTotalSec] = useState(0);
  const [expandedChapters, setExpandedChapters] = useState<Set<string>>(new Set());
  const mountedRef = useRef(true);
  const genRef = useRef(0);
  const chapterListRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    mountedRef.current = true;
    const gen = ++genRef.current;

    api<CourseDetail>(`/courses/${id}`).then(async (data) => {
      if (!mountedRef.current || gen !== genRef.current) return;
      setCourse(data);
      setActiveMaterialId(null);
      // 默认展开所有有视频的章节
      setExpandedChapters(new Set((data.chapters || []).map(ch => ch.id)));
      // 进度统一按视频统计（所有课程）
      api<CourseProgress>(`/student/progress/${id}`).then((p) => {
        if (mountedRef.current && gen === genRef.current) setProgress(p);
      }).catch(() => {});
      // 签到状态恒拉取：任何课程都可能配了签到场次，渲染以 required_count>0 为准
      api<MyAttendance>(`/student/courses/${id}/attendance`).then((a) => {
        if (mountedRef.current && gen === genRef.current) setAttendance(a);
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

  // 组装扁平视频列表（章节视频 + 无归属视频）
  const allVideos = useMemo(() => {
    if (!course) return [];
    const flat: VideoItem[] = [];
    for (const ch of (course.chapters || [])) {
      for (const v of (ch.videos || [])) flat.push(v);
    }
    for (const v of (course.videos || [])) flat.push(v);
    return flat;
  }, [course]);

  // 视频 ID → 扁平索引 映射
  const videoIdxMap = useMemo(() => {
    const map = new Map<string, number>();
    allVideos.forEach((v, i) => map.set(v.id, i));
    return map;
  }, [allVideos]);

  // 切换视频时重置当前视频观看状态，并获取播放 token
  useEffect(() => {
    setCurrentVideoWatched(false);
    if (allVideos.length === 0) return;
    const activeVideo = allVideos[activeVideoIdx];
    if (!activeVideo) return;

    let cancelled = false;
    // url=null 表示视频存于服务器本地（中转回退），走本站 stream 端点播放
    api<{ url: string | null }>(`/videos/play-url/${activeVideo.obs_key}`)
      .then((res) => {
        if (!cancelled) setPlayUrl(res.url ?? videoStreamUrl(activeVideo.obs_key));
      })
      .catch(() => {
        if (!cancelled) setPlayUrl(null);
      });

    return () => { cancelled = true; };
  }, [allVideos, activeVideoIdx]);

  // 切视频时自动滚动到当前项
  useEffect(() => {
    if (chapterListRef.current) {
      const el = chapterListRef.current.querySelector(`[data-video-idx="${activeVideoIdx}"]`);
      el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [activeVideoIdx]);

  // 找到上次观看但未完成的视频（非当前视频），用于续播
  const lastWatched = useMemo(() => {
    if (!progress || allVideos.length === 0) return null;
    let bestIdx = -1;
    let bestSec = 0;
    let bestTotal = 0;
    allVideos.forEach((v, i) => {
      if (i === activeVideoIdx) return;
      const vp = progress.video_progress[v.id];
      if (vp && vp.watched_seconds > bestSec && !vp.completed) {
        bestSec = vp.watched_seconds;
        bestTotal = vp.total_seconds || v.duration || 0;
        bestIdx = i;
      }
    });
    if (bestIdx === -1) return null;
    return { index: bestIdx, watchedSeconds: bestSec, totalSeconds: bestTotal };
  }, [progress, allVideos, activeVideoIdx]);

  if (loading) return <p className="text-text-secondary">加载中...</p>;
  if (!course) return <p className="text-text-secondary">课程不存在</p>;

  const materials = course.materials || [];
  // 未手动点开课件时：无视频课程默认打开第一个课件（课件即课程内容）
  const activeMaterial: MaterialItem | null = activeMaterialId
    ? materials.find(m => m.id === activeMaterialId) || null
    : (allVideos.length === 0 && materials.length > 0 ? materials[0] : null);
  const activeVideo = activeMaterial ? undefined : allVideos[activeVideoIdx];

  // 签到状态刷新（签到/撤销后由 StudentCheckInCard 触发）
  const refreshAttendance = () => {
    api<MyAttendance>(`/student/courses/${id}/attendance`)
      .then((a) => setAttendance(a))
      .catch(() => {});
  };

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
    const total = duration > 0 ? duration : (activeVideo.duration || 0);
    api("/student/progress", {
      method: "POST",
      body: JSON.stringify({
        video_id: activeVideo.id,
        course_id: course.id,
        watched_seconds: seconds,
        total_seconds: total,
      }),
    }).catch(() => {});
  };

  // 视频播放结束
  const handleVideoEnded = () => {
    setCurrentVideoWatched(true);
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

  // 课程整体进度（80%视频 + 20%考试）
  const totalVideos = allVideos.length;
  const hasExam = progress?.has_exam ?? (course.exam_id != null);
  const videoWeight = hasExam ? 80 : 100;
  const perVideoWeight = totalVideos > 0 ? videoWeight / totalVideos : 0;
  const isActiveDone = isCurrentVideoCompleted || currentVideoWatched;

  let videoProgress: number;
  if (totalVideos === 0) {
    videoProgress = 0;
  } else if (isActiveDone) {
    videoProgress = (progress?.completed_count || 0) * perVideoWeight;
  } else {
    const ratio = currentTotalSec > 0 ? Math.min(currentWatchSec / currentTotalSec, 1) : 0;
    videoProgress = ((progress?.completed_count || 0) + ratio) * perVideoWeight;
  }
  const examProgress = hasExam && progress?.exam_passed ? 20 : 0;
  const totalProgress = Math.round(videoProgress + examProgress);

  // 渲染视频行的通用组件
  const renderVideoRow = (v: VideoItem) => {
    const idx = videoIdxMap.get(v.id);
    if (idx === undefined) return null;
    const isActive = idx === activeVideoIdx;
    const vp = progress?.video_progress[v.id];
    const isCompleted = vp?.completed;
    return (
      <button
        key={v.id}
        data-video-idx={idx}
        onClick={() => { setActiveMaterialId(null); setActiveVideoIdx(idx); }}
        className={`w-full text-left pl-9 pr-3 py-2 text-sm rounded ml-1 mr-2 mb-0.5 transition-colors border-l-2 ${
          isActive
            ? "bg-primary/5 text-primary font-medium border-l-primary"
            : isCompleted
            ? "text-text-secondary/80 border-l-transparent hover:bg-bg-layout"
            : "text-text-secondary/50 border-l-transparent hover:bg-bg-layout hover:text-text-secondary"
        }`}
      >
        <div className="flex items-center gap-2">
          <span className="shrink-0 w-4 flex items-center justify-center">
            {isActive ? (
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            ) : isCompleted ? (
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="text-green-600">
                <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.5" />
                <path d="M4.5 7L6 8.5L9.5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : (
              <span className="text-text-secondary/50 text-xs">{idx + 1}</span>
            )}
          </span>
          <span className="truncate flex-1">{v.title}</span>
          {v.duration && (
            <span className="text-text-secondary/70 text-xs shrink-0">
              {Math.floor(v.duration / 60)}:{String(v.duration % 60).padStart(2, "0")}
            </span>
          )}
        </div>
      </button>
    );
  };

  return (
    <div>
      {/* 课程头部卡片 */}
      <div className="bg-bg-base rounded-lg border border-border p-4 mb-4">
        <div className="flex items-start justify-between mb-3">
          <h2 className="text-lg font-bold text-primary">{course.title}</h2>
          <span className="text-xs text-text-secondary shrink-0 ml-4 mt-0.5">
            {totalVideos > 0 || materials.length === 0
              ? `${progress?.completed_count || 0} / ${progress?.total_count || totalVideos} 节`
              : `课件 ${materials.length} 份`}
            {attendance && attendance.required_count > 0 && (
              <span className="ml-2 text-violet-600">
                · 已签到 {attendance.attended_count}/{attendance.required_count} 场
              </span>
            )}
          </span>
        </div>
        <div className="flex items-center gap-2.5">
          <div className="flex-1">
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
          <span className="text-xs font-medium text-primary shrink-0">{totalProgress || 0}%</span>
        </div>
      </div>

      <div className="flex gap-4">
        {/* 播放器（统一线上课程始终渲染） */}
        <div className="flex-1 min-w-0">
          {/* 课件模式：卡片撑到视口底部，阅读器吃满高度（视频模式保持自适应） */}
          <div className={`bg-bg-base rounded-xl border border-border shadow-sm overflow-hidden ${activeMaterial ? "h-[calc(100vh-210px)]" : ""}`}>
            {activeMaterial ? (
              <MaterialViewer material={activeMaterial} />
            ) : activeVideo && playUrl ? (
              <div className="bg-black">
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
              <div className="bg-black flex items-center justify-center h-48 text-text-secondary">
                加载视频中...
              </div>
            ) : (
              <div className="p-12 text-center text-text-secondary">
                课程内容准备中，请稍后再来
              </div>
            )}
            {activeVideo && !activeMaterial && (
              <div className="px-4 py-2.5 border-t border-border flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />
                <span className="text-sm font-medium truncate flex-1">{activeVideo.title}</span>
                {activeVideo.duration && (
                  <span className="text-xs text-text-secondary shrink-0">
                    {Math.floor(activeVideo.duration / 60)}:{String(activeVideo.duration % 60).padStart(2, "0")}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* 签到卡片（课程配置了签到场次时显示） */}
          {attendance && attendance.required_count > 0 && (
            <StudentCheckInCard attendance={attendance} onChanged={refreshAttendance} />
          )}
          {course.description && (
            <p className="mt-4 text-sm text-text-secondary">{course.description}</p>
          )}
          {course.exam_id && examStatus === "published" && (
            <div className="mt-4">
              {allVideos.length > 0 && !examEnabled ? (
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
          <div className="bg-bg-base rounded-lg border border-border" ref={chapterListRef}>
            <div className="px-4 py-3 text-sm font-bold text-primary/80">课程内容</div>
            {/* 续播提示 */}
            {lastWatched && (
              <button
                onClick={() => setActiveVideoIdx(lastWatched.index)}
                className="w-full text-left px-3 py-3 mb-1.5 rounded-lg mx-2 bg-primary/5 hover:bg-primary/10 transition-colors group"
              >
                <div className="text-xs text-primary/50 mb-0.5">上次看到</div>
                <div className="text-sm font-medium text-primary truncate">
                  第 {lastWatched.index + 1} 节 · {allVideos[lastWatched.index].title}
                </div>
                <div className="text-xs text-text-secondary mt-0.5">
                  已看 {Math.floor(lastWatched.watchedSeconds / 60)}:{String(Math.floor(lastWatched.watchedSeconds % 60)).padStart(2, "0")}
                  {lastWatched.totalSeconds > 0 && (
                    <> / {Math.floor(lastWatched.totalSeconds / 60)}:{String(Math.floor(lastWatched.totalSeconds % 60)).padStart(2, "0")}</>
                  )}
                </div>
              </button>
            )}
            <div className="overflow-y-auto max-h-[calc(100vh-360px)]">
              {(course.chapters || []).length === 0 && (course.videos || []).length === 0 && materials.length === 0 ? (
                <p className="text-sm text-text-secondary py-4 text-center">暂无内容</p>
              ) : (
                <>
                  {/* 章节 + 视频树 */}
                  {(course.chapters || []).map((ch) => {
                    const isExpanded = expandedChapters.has(ch.id);
                    return (
                      <div key={ch.id}>
                        <button
                          onClick={() => {
                            setExpandedChapters(prev => {
                              const next = new Set(prev);
                              isExpanded ? next.delete(ch.id) : next.add(ch.id);
                              return next;
                            });
                          }}
                          className="w-full flex items-center gap-1 px-3 py-2 text-sm font-medium rounded hover:bg-bg-layout transition-colors text-text-base"
                        >
                          {isExpanded ? <ChevronDown size={14} className="text-text-secondary shrink-0" /> : <ChevronRight size={14} className="text-text-secondary shrink-0" />}
                          <span className="truncate">{ch.title}</span>
                        </button>
                        {isExpanded && (
                          ch.videos.length === 0 ? (
                            <p className="text-xs text-text-secondary py-2 pl-10">暂无视频</p>
                          ) : (
                            ch.videos.map(v => renderVideoRow(v))
                          )
                        )}
                      </div>
                    );
                  })}
                  {/* 无归属章节的视频 */}
                  {(course.videos || []).length > 0 && (course.videos || []).map(v => renderVideoRow(v))}
                </>
              )}
              {/* 课件：与视频同为课程内容，点开即在主区阅读 */}
              {materials.length > 0 && (
                <div className="border-t border-border mt-1.5 pt-1.5 pb-2">
                  {materials.map(m => {
                    const isActive = activeMaterial?.id === m.id;
                    return (
                      <button
                        key={m.id}
                        onClick={() => setActiveMaterialId(m.id)}
                        title={m.original_name}
                        className={`w-full flex items-center gap-2 pl-4 pr-3 py-2 text-sm rounded ml-1 mr-2 mb-0.5 transition-colors border-l-2 ${
                          isActive
                            ? "bg-primary/5 text-primary font-medium border-l-primary"
                            : "text-text-secondary/70 border-l-transparent hover:bg-bg-layout hover:text-text-secondary"
                        }`}
                      >
                        <FileText size={14} className={isActive ? "text-primary shrink-0" : "text-text-secondary/60 shrink-0"} />
                        <span className="truncate flex-1 text-left">{m.original_name}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}