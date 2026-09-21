import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, loadEnv } from "vite";

// 后端地址可通过环境变量覆盖，避免多个项目抢占同一端口时前后端错配
// （历史上 8002 被另一个项目占用，导致前端所有 API 请求打到错误的系统）。
// 用法：VITE_PROXY_TARGET=http://localhost:8100 npm run dev
const DEFAULT_BACKEND = "http://localhost:8100";

/**
 * 修正 favicon 路径。
 *
 * 由于配置了非根 base（/learning-platform/），Vite 开发服务器会对 index.html 中
 * 已经带 base 前缀的绝对资源路径再拼一次 base，产出
 * `/learning-platform/learning-platform/favicon.svg`（404）。
 * `%BASE_URL%` 占位符在开发模式下同样会被二次拼接，因此改在最后的 HTML 处理阶段
 * 统一归一化为「恰好一个 base 前缀」，开发与生产行为一致。
 */
const normalizeFaviconHref = {
  name: "normalize-favicon-href",
  transformIndexHtml: {
    order: "post" as const,
    handler(html: string) {
      return html.replace(
        /(<link[^>]+rel="icon"[^>]+href=")[^"]*?\/?favicon\.svg"/,
        '$1/learning-platform/favicon.svg"',
      );
    },
  },
};

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const target = env.VITE_PROXY_TARGET || DEFAULT_BACKEND;

  return {
    base: "/learning-platform/",
    plugins: [react(), tailwindcss(), normalizeFaviconHref],
    server: {
      port: 5178,
      proxy: {
        "/api/learning-platform": {
          target,
          changeOrigin: true,
          rewrite: (path: string) => path.replace(/^\/api\/learning-platform/, "/api"),
        },
        "/api": { target, changeOrigin: true },
        "/sso": { target, changeOrigin: true },
      },
    },
    // 首屏体积优化说明：
    // 依靠「路由级 React.lazy」让打包器自动按引用关系分块即可达到目的
    // （登录页只需入口 + vendor-react，播放器/知识地图/课件预览等重型依赖
    //  各自落在访问对应页面时才加载的动态 chunk 中）。
    // 特意不配置手动 manualChunks：手动分组会把本应按需加载的库提升为入口 chunk
    // 的静态依赖（实测 @tiptap 会被入口预加载 411KB），反而破坏按需加载。
  };
});
