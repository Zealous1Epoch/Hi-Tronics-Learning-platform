import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";

// 说明（重要，请勿"顺手"改回 StrictMode）：
//
// 本项目在处理视频播放时使用命令式库 video.js，它的 dispose() 会把承载播放器的
// <video> 元素从 DOM 中移除，而 React 不会补回该节点。React 18/19 的 StrictMode
// 在开发模式下会执行「挂载 → 模拟卸载 → 再次挂载」，导致第二次初始化拿到已脱离
// 文档的元素而渲染空白（video.js 报 "The element supplied is not included in the DOM"）。
//
// 已实测两种规避方案均不可靠（详见 components/VideoPlayer.tsx 顶部说明）：
//   1) 在 effect 内自行 createElement 并挂到 React 容器 → 容器会被模拟卸载摘离文档；
//   2) 用 state 作 <video> 的 key 强制重建 → 清理函数递增 key 与 effect 重复调用
//      互相触发，可能形成重建循环。
// 因此继续不启用 StrictMode。开发期副作用检查的缺失由以下措施部分补偿：
//   - ErrorBoundary 的 componentDidCatch + 全局 unhandledrejection / error 监听
//   - `tsc -b` 与 `vite build` 作为 CI 门禁
//
// 注意：video.js 的样式表已改为在 VideoPlayer 组件内引入。
// 原先在此处全局引入会让整个 video.js 变成入口 chunk 的静态依赖，
// 使登录页也要下载 640KB 的播放器代码，破坏代码分割。
createRoot(document.getElementById("root")!).render(<App />);
