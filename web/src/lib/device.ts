/**
 * 设备指纹（仅用于签到场景的「同一设备代签多人」检测）。
 *
 * 说明与边界：
 * - 这是**弱指纹**，用于识别「一台手机给多个账号签到」这类最常见的代签行为，
 *   不作为身份认证依据，也不采集任何个人信息。
 * - 数据存放在 localStorage，用户清缓存后会重新生成，因此只用于「打标 + 复核」，
 *   不应据此直接拒绝（除非场次显式开启 dedupe_device）。
 */

const DEVICE_KEY = "lp_device_id";

function randomId(): string {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function getDeviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = randomId();
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    // 隐私模式等无法写入 localStorage 时降级为一次性 id
    return randomId();
  }
}

/** 可选：把设备信息压成短字符串，便于在名单里辨认（如 iPad / Android） */
export function getDeviceLabel(): string {
  const ua = navigator.userAgent || "";
  if (/iPad/i.test(ua)) return "iPad";
  if (/iPhone/i.test(ua)) return "iPhone";
  if (/Android/i.test(ua)) return "Android";
  if (/Windows/i.test(ua)) return "Windows";
  if (/Macintosh|Mac OS X/i.test(ua)) return "Mac";
  if (/Linux/i.test(ua)) return "Linux";
  return "未知设备";
}
