import { useEffect, useRef } from "react";
import videojs from "video.js";
// 样式在组件内引入（而非全局入口），使 video.js 保持为按需加载的动态 chunk
import "video.js/dist/video-js.css";

interface VideoPlayerProps {
  src: string;
  onProgress?: (seconds: number, duration: number) => void;
  startTime?: number;
  // 禁止拖动到未看过的位置（学员端防跳看，后台预览不传即不限制）
  disableSeek?: boolean;
  // 视频播放结束回调（独立于 onProgress，不依赖上报请求的返回）
  onVideoEnded?: () => void;
}

/**
 * video.js 播放器封装。
 *
 * ⚠ 关于 `<StrictMode>`（见 main.tsx 的说明）：
 * video.js 是命令式库，`player.dispose()` 会把承载它的 <video> 元素从 DOM 中移除，
 * 而 React 不会把它补回来。React 18/19 的 StrictMode 在开发模式会执行
 * 「挂载 → 模拟卸载 → 再次挂载」，第二次初始化因此必然拿到已脱离文档的元素，
 * video.js 会报 "The element supplied is not included in the DOM" 并停止渲染。
 *
 * 已实测过的两种规避方案都不可靠：
 *  1) 在 effect 内用 document.createElement 创建 <video> 并挂到 React 容器上 ——
 *     StrictMode 的模拟卸载会把该容器一并摘离文档，第二次初始化同样失败；
 *  2) 用 state 作为 <video> 的 key 强制 React 重建节点 ——
 *     清理函数里递增 key 会与 StrictMode 的 effect 重复调用互相触发，可能形成重建循环。
 * 因此维持「不启用 StrictMode」的既有决策，并在此处做了防御性处理：
 * 初始化前检查元素是否仍在文档中，清理时吞掉 dispose 的异常。
 * 开发期副作用检查的缺失，由 ErrorBoundary 的全局错误监听部分补偿（见 main.tsx）。
 */
export default function VideoPlayer({ src, onProgress, startTime = 0, disableSeek = false, onVideoEnded }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<ReturnType<typeof videojs> | null>(null);
  const onProgressRef = useRef(onProgress);
  const startTimeRef = useRef(startTime);
  const disableSeekRef = useRef(disableSeek);
  const onVideoEndedRef = useRef(onVideoEnded);
  // 记录已看过的最远位置，seek 超过该位置则回弹
  const maxWatchedRef = useRef(0);

  // 保持 ref 最新，避免 effect 依赖变化导致播放器重建
  onProgressRef.current = onProgress;
  startTimeRef.current = startTime;
  onVideoEndedRef.current = onVideoEnded;

  // 只初始化播放器一次（组件挂载/卸载）
  useEffect(() => {
    const videoEl = videoRef.current;
    if (!videoEl) return;
    // 防御：若元素已脱离文档（例如被父级提前卸载），建播放器只会得到空白区域
    if (!videoEl.isConnected) return;
    // 防御：同一元素上若已存在播放器实例（热更新场景），先销毁避免叠加
    const existing = (videoEl as HTMLVideoElement & { player?: ReturnType<typeof videojs> }).player;
    if (existing && !existing.isDisposed()) {
      try {
        existing.dispose();
      } catch {
        /* ignore */
      }
    }

    const player = videojs(videoEl, {
      controls: true,
      fluid: true,
      playbackRates: [0.75, 1, 1.25, 1.5, 2],
      sources: [{ src, type: "video/mp4" }],
    });

    playerRef.current = player;

    player.ready(() => {
      if (startTimeRef.current > 0) {
        player.currentTime(startTimeRef.current);
        // 恢复到上次观看位置视为已看过
        maxWatchedRef.current = startTimeRef.current;
      }
      // 禁用进度条交互（点击和拖动），仅保留视觉进度展示
      if (disableSeekRef.current) {
        const pc = (player as unknown as { controlBar?: { progressControl?: { el: () => HTMLElement } } }).controlBar?.progressControl;
        if (pc && pc.el()) {
          pc.el().style.pointerEvents = "none";
        }
      }
    });

    // 防拖动：跳到未看过的位置时回弹到最远已看位置
    const onSeeking = () => {
      if (!disableSeekRef.current) return;
      const target = player.currentTime();
      if (target !== undefined && target !== null && target > maxWatchedRef.current + 1) {
        player.currentTime(maxWatchedRef.current);
      }
    };
    player.on("seeking", onSeeking);

    // 播放过程中持续更新最远已看位置
    const onTimeUpdate = () => {
      const t = player.currentTime();
      if (t !== undefined && t !== null && t > maxWatchedRef.current) {
        maxWatchedRef.current = t;
      }
    };
    player.on("timeupdate", onTimeUpdate);

    const report = () => {
      const duration = player.duration();
      if (duration !== undefined && Number.isFinite(duration) && duration > 0) {
        onProgressRef.current?.(Math.floor(player.currentTime() || 0), Math.round(duration));
      }
    };

    // 定时上报进度
    const progressInterval = setInterval(report, 10000);
    // 播放结束立即上报完整时长（确保 100% 进度，避免 floor 截断导致差 1 秒）
    const onEnded = () => {
      const duration = player.duration();
      if (duration !== undefined && Number.isFinite(duration) && duration > 0) {
        const d = Math.round(duration);
        onProgressRef.current?.(d, d);
      }
      // 独立回调刷新考试入口，不依赖 POST 返回
      onVideoEndedRef.current?.();
    };
    player.on("ended", onEnded);
    // 关闭页面前最后上报一次
    const beforeUnload = () => report();
    window.addEventListener("beforeunload", beforeUnload);

    return () => {
      clearInterval(progressInterval);
      player.off("ended", onEnded);
      player.off("seeking", onSeeking);
      player.off("timeupdate", onTimeUpdate);
      window.removeEventListener("beforeunload", beforeUnload);
      // 卸载前上报最后一次进度（组件切换视频时）
      report();
      try {
        player.dispose();
      } catch {
        /* 元素已被外部移除时 dispose 会抛错，忽略即可 */
      }
      playerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // src 变化时只更新源地址，不重建播放器
  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    player.src({ src, type: "video/mp4" });
  }, [src]);

  return (
    <div data-vjs-player>
      <video ref={videoRef} className="video-js vjs-big-play-centered" />
    </div>
  );
}
