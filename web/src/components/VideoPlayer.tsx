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
      if (startTime > 0) {
        player.currentTime(startTime);
      }
    });

    if (onProgress) {
      const interval = setInterval(() => {
        onProgress(Math.floor(player.currentTime() || 0));
      }, 10000);
      return () => {
        clearInterval(interval);
        player.dispose();
      };
    }

    return () => {
      player.dispose();
    };
  }, [src]);

  return (
    <div data-vjs-player>
      <video ref={videoRef} className="video-js vjs-big-play-centered" />
    </div>
  );
}