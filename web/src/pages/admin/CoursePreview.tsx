import { useState, useEffect, useRef, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ChevronRight, ChevronDown, ArrowLeft, FileText } from "lucide-react";
import { api } from "../../lib/api";
import VideoPlayer from "../../components/VideoPlayer";
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
interface CourseDetail {
  id: string; title: string; description: string | null;
  chapters: ChapterItem[];
  videos: VideoItem[];
  materials?: MaterialFile[];
  exam_id: string | null;
}

export default function CoursePreview() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [course, setCourse] = useState<CourseDetail | null>(null);
  const [activeVideoIdx, setActiveVideoIdx] = useState(0);
  const [activeMaterialId, setActiveMaterialId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [playUrl, setPlayUrl] = useState<string | null>(null);
  const [expandedChapters, setExpandedChapters] = useState<Set<string>>(new Set());
  const mountedRef = useRef(true);
  const chapterListRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    mountedRef.current = true;
    api<CourseDetail>(`/courses/${id}`).then((data) => {
      if (!mountedRef.current) return;
      setCourse(data);
      // 默认展开所有有视频的章节
      setExpandedChapters(new Set((data.chapters || []).map(ch => ch.id)));
      setLoading(false);
    });
    return () => { mountedRef.current = false; };
  }, [id]);

  // 扁平视频列表
  const allVideos = useMemo(() => {
    if (!course) return [];
    const flat: VideoItem[] = [];
    for (const ch of (course.chapters || [])) {
      for (const v of (ch.videos || [])) flat.push(v);
    }
    for (const v of (course.videos || [])) flat.push(v);
    return flat;
  }, [course]);

  // 视频 ID → 索引
  const videoIdxMap = useMemo(() => {
    const map = new Map<string, number>();
    allVideos.forEach((v, i) => map.set(v.id, i));
    return map;
  }, [allVideos]);

  // 切视频时获取播放地址
  useEffect(() => {
    if (allVideos.length === 0) return;
    const activeVideo = allVideos[activeVideoIdx];
    if (!activeVideo) return;
    let cancelled = false;
    api<{ url: string }>(`/videos/play-url/${activeVideo.obs_key}`)
      .then((res) => { if (!cancelled) setPlayUrl(res.url); })
      .catch(() => { if (!cancelled) setPlayUrl(null); });
    return () => { cancelled = true; };
  }, [allVideos, activeVideoIdx]);

  // 自动滚动到当前项
  useEffect(() => {
    if (chapterListRef.current) {
      const el = chapterListRef.current.querySelector(`[data-video-idx="${activeVideoIdx}"]`);
      el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [activeVideoIdx]);

  if (loading) return <p className="text-text-secondary">加载中...</p>;
  if (!course) return <p className="text-text-secondary">课程不存在</p>;

  const materials = course.materials || [];
  // 课件与视频同为课程内容：未手动点开课件时，无视频课程默认打开第一个课件
  const activeMaterial: MaterialFile | null = activeMaterialId
    ? materials.find(m => m.id === activeMaterialId) || null
    : (allVideos.length === 0 && materials.length > 0 ? materials[0] : null);
  const activeVideo = activeMaterial ? undefined : allVideos[activeVideoIdx];

  const renderVideoRow = (v: VideoItem) => {
    const idx = videoIdxMap.get(v.id);
    if (idx === undefined) return null;
    const isActive = !activeMaterial && idx === activeVideoIdx;
    return (
      <button
        key={v.id}
        data-video-idx={idx}
        onClick={() => { setActiveMaterialId(null); setActiveVideoIdx(idx); }}
        className={`w-full text-left pl-9 pr-3 py-2 text-sm rounded ml-1 mr-2 mb-0.5 transition-colors border-l-2 ${
          isActive
            ? "bg-primary/5 text-primary font-medium border-l-primary"
            : "text-text-secondary/80 border-l-transparent hover:bg-bg-layout"
        }`}
      >
        <div className="flex items-center gap-2">
          <span className="shrink-0 w-4 flex items-center justify-center">
            {isActive ? (
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
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
      {/* 顶部返回栏 */}
      <div className="flex items-center gap-3 mb-4">
        <button
          onClick={() => navigate("/admin/courses")}
          className="flex items-center gap-1 text-sm text-text-secondary hover:text-primary transition-colors"
        >
          <ArrowLeft size={16} /> 返回课程管理
        </button>
        <h2 className="text-xl font-bold text-primary">{course.title}</h2>
      </div>

      <div className="flex gap-4">
        {/* 播放器 */}
        <div className="flex-1 min-w-0">
          {/* 课件模式：卡片撑到视口底部，阅读器吃满高度（视频模式保持自适应） */}
          <div className={`bg-bg-base rounded-xl border border-border shadow-sm overflow-hidden ${activeMaterial ? "h-[calc(100vh-160px)]" : ""}`}>
            {activeMaterial ? (
              <MaterialViewer key={activeMaterial.id} material={activeMaterial} />
            ) : activeVideo && playUrl ? (
              <div className="bg-black">
                <VideoPlayer
                  key={activeVideo.id}
                  src={playUrl}
                />
              </div>
            ) : activeVideo ? (
              <div className="bg-black flex items-center justify-center h-48 text-text-secondary">
                加载视频中...
              </div>
            ) : (
              <div className="p-12 text-center text-text-secondary">
                {allVideos.length === 0 && materials.length === 0 ? "暂无内容" : "暂无视频"}
              </div>
            )}
            {activeVideo && (
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
          {course.description && (
            <p className="mt-4 text-sm text-text-secondary">{course.description}</p>
          )}
          {course.exam_id && (
            <div className="mt-4">
              <a
                href={`/learning-platform/admin/exams/${course.exam_id}/paper`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block px-6 py-2 bg-primary text-white rounded-md text-sm hover:bg-primary-light"
              >
                查看试卷
              </a>
            </div>
          )}
        </div>

        {/* 章节列表 */}
        <div className="w-64 flex-shrink-0">
          <div className="bg-bg-base rounded-lg border border-border" ref={chapterListRef}>
            <div className="px-4 py-3 text-sm font-bold text-primary/80">章节列表</div>
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
                  {/* 无归属的视频 */}
                  {(course.videos || []).length > 0 && (course.videos || []).map(v => renderVideoRow(v))}
                </>
              )}
              {/* 课件：与视频同为课程内容，点开即在主区预览 */}
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