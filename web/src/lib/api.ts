/** API 客户端，自动附加 Authorization header
 *
 * 安全说明：JWT 存储在 localStorage 中，存在 XSS 攻击风险。
 * 如果攻击者能注入脚本，即可读取 token 并冒充用户。
 *
 * 当前缓解措施：
 * - React 的 JSX 自动转义防止大多数反射型 XSS
 * - 后端对所有用户输入进行校验和转义
 * - JWT 有效期 24 小时，过期自动失效
 *
 * 后续改进方向：
 * - 将 token 存储改为 httpOnly Secure SameSite Cookie
 * - 添加 CSP (Content-Security-Policy) 响应头
 * - 实现 refresh token 机制，缩短 access token 有效期
 */

const BASE = import.meta.env.VITE_API_BASE || "/api/learning-platform";
const BASE_URL = import.meta.env.BASE_URL || "/";

export { BASE, BASE_URL };

function getToken(): string | null {
  return localStorage.getItem("lp_token");
}

export async function api<T extends object = Record<string, unknown>>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${BASE}${path}`, { ...options, headers });

  if (res.status === 401) {
    localStorage.removeItem("lp_token");
    localStorage.removeItem("lp_user");
    const redirect = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.href = `${BASE_URL}login?redirect=${redirect}`;
    throw new Error("认证已过期");
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `请求失败: ${res.status}`);
  }

  // 204 No Content 无响应体，直接返回空对象
  if (res.status === 204) {
    return {} as T;
  }

  return res.json();
}

export interface UserInfo {
  id: string;
  username: string;
  name: string;
  role: string;
  status: string;
  department: string | null;
  employee_id: string | null;
  avatar: string | null;
}

// ── 组织架构（全员名册镜像）──
export interface OrgAccountInfo {
  user_id: string;
  username: string;
  name: string;
  employee_id: string | null;
  department: string | null;
  role: string;
  status: string;
}

export interface OrgMemberRow {
  emp_id: string | null;
  name: string;
  position: string | null;
  dept_path: string | null;
  top_dept: string | null;
  account: OrgAccountInfo | null;
  account_count: number;
  // 仅「不在名册的账号」行携带：
  user_id?: string;
  username?: string;
  employee_id?: string | null;
  department?: string | null;
  unlinked?: boolean;
}

export interface OrgSyncMetaInfo {
  synced_at: string;
  row_count: number;
  source_imported_at: string | null;
  unlinked_account_count: number;
}

export interface OrgMembersResponse {
  meta: OrgSyncMetaInfo | null;
  members: OrgMemberRow[];
  unlinked_accounts: OrgMemberRow[];
}

export interface OrgSyncResult {
  imported: number;
  previous: number;
  synced_at: string;
  source_imported_at: string | null;
}

export interface LoginResponse {
  access_token: string;
  token_type: string;
  user: UserInfo;
}

export async function login(username: string, password: string): Promise<LoginResponse> {
  return api<LoginResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}

export async function uploadFile<T extends object = Record<string, unknown>>(path: string, file: File): Promise<T> {
  const token = getToken();
  const formData = new FormData();
  formData.append("file", file);

  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: formData,
  });

  if (res.status === 401) {
    localStorage.removeItem("lp_token");
    localStorage.removeItem("lp_user");
    const redirect = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.href = `${BASE_URL}login?redirect=${redirect}`;
    throw new Error("认证已过期");
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `请求失败: ${res.status}`);
  }

  return res.json();
}

export async function getMe(): Promise<UserInfo> {
  return api<UserInfo>("/auth/me");
}

export async function uploadFileWithProgress<T extends object = Record<string, unknown>>(
  path: string,
  file: File,
  onProgress?: (progress: number) => void,
): Promise<T> {
  const token = getToken();
  const formData = new FormData();
  formData.append("file", file);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${BASE}${path}`);
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };

    xhr.onload = () => {
      if (xhr.status === 401) {
        localStorage.removeItem("lp_token");
        localStorage.removeItem("lp_user");
        window.location.href = `${BASE_URL}login`;
        reject(new Error("认证已过期"));
        return;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(JSON.parse(xhr.responseText));
      } else {
        const body = JSON.parse(xhr.responseText || "{}");
        reject(new Error(body.detail || `请求失败: ${xhr.status}`));
      }
    };

    xhr.onerror = () => reject(new Error("网络错误"));
    xhr.send(formData);
  });
}

/** 浏览器直传文件到 OSS 预签名 URL，带进度回调 */
export async function uploadToOSS(
  uploadUrl: string,
  file: File,
  content_type: string,
  onProgress?: (progress: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadUrl);

    // Content-Type 必须和预签名 URL 里签的一致
    xhr.setRequestHeader("Content-Type", content_type);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error(`OSS 上传失败 (${xhr.status})`));
      }
    };

    xhr.onerror = () => reject(new Error("网络错误"));
    xhr.send(file);
  });
}