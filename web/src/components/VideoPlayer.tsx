import { useEffect, useRef } from "react";
import videojs from "video.js";

interface VideoPlayerProps {
  src: string;
  onProgress?: (seconds: number) => void;
  startTime?: number;
}

export default function VideoPlayer({ src, onProgress, startTime = 0 }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<ReturnType<typeof videojs> | null>(null);
  const onProgressRef = useRef(onProgress);
  const startTimeRef = useRef(startTime);

  // 保持 ref 最新，避免 effect 依赖变化导致播放器重建
  onProgressRef.current = onProgress;
  startTimeRef.current = startTime;

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
      }
    });

    const progressInterval = setInterval(() => {
      onProgressRef.current?.(Math.floor(player.currentTime() || 0));
    }, 30000);

    return () => {
      clearInterval(progressInterval);
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