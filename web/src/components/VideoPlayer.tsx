import { useEffect, useRef } from "react";
import videojs from "video.js";

interface VideoPlayerProps {
  src: string;
  onProgress?: (seconds: number, duration: number) => void;
  startTime?: number;
  // 禁止拖动到未看过的位置（学员端防跳看，后台预览不传即不限制）
  disableSeek?: boolean;
  // 视频播放结束回调（独立于 onProgress，不依赖上报请求的返回）
  onVideoEnded?: () => void;
}

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
    if (!videoRef.current) return;

    const player = videojs(videoRef.current, {
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
        const pc = player.controlBar.progressControl;
        if (pc && pc.el()) {
          pc.el().style.pointerEvents = "none";
        }
      }
    });

    // 防拖动：跳到未看过的位置时回弹到最远已看位置
    const onSeeking = () => {
      if (!disableSeekRef.current) return;
      const target = player.currentTime();
      if (target > maxWatchedRef.current + 1) {
        player.currentTime(maxWatchedRef.current);
      }
    };
    player.on("seeking", onSeeking);

    // 播放过程中持续更新最远已看位置
    const onTimeUpdate = () => {
      const t = player.currentTime();
      if (t > maxWatchedRef.current) {
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
      player.dispose();
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
