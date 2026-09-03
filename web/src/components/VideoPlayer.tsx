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
    }, 10000);

    return () => {
      clearInterval(progressInterval);
      player.dispose();
    };
  }, [src]);

  return (
    <div data-vjs-player>
      <video ref={videoRef} className="video-js vjs-big-play-centered" />
    </div>
  );
}