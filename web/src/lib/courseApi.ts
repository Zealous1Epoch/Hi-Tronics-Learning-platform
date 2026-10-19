/** 课程域 API 薄包装 —— 类型定义 + 端点函数
 *
 * 拆分自 CourseManage.tsx（课程管理重构 S3）：列表页 / 编辑页 / 各子组件
 * 统一从这里取数，不再散落裸 api() 调用。
 * 底层复用 lib/api.ts（Bearer 注入、401 跳登录、detail 报错），本文件不改其行为。
 */
import { api, uploadToOSS, uploadFileWithProgress, BASE } from "./api";
import type { TreeNode, FlatCategory } from "../components/CourseTree";

export type { TreeNode, FlatCategory };

// ───────────────────────── 类型（对齐后端 schemas/course.py） ─────────────────────────

/** CourseOut：列表接口同样返回全量装配（chapters/videos 已内嵌） */
export interface Course {
  id: string;
  title: string;
  /** 历史字段保留（后端不再按它分支，统一看 require_attendance） */
  course_type: string;
  /** 是否启用现场签到 */
  require_attendance: boolean;
  description: string | null;
  cover_image: string | null;
  category_id: string | null;
  exam_id: string | null;
  start_date: string | null;
  end_date: string | null;
  status: string; // draft / published
  created_by: string | null;
  created_at: string;
  updated_at: string;
  chapters: Chapter[];
  videos: Video[];
  video_count: number;
  /** 课程课件（PDF / PPT / HTML 等学习文件，本地存储） */
  materials: CourseMaterial[];
  /** 签到场次数（require_attendance=False 时恒 0） */
  session_count: number;
}

/** CourseMaterialOut：课程课件（响应不携带存储文件名 obs_key） */
export interface CourseMaterial {
  id: string;
  course_id: string;
  original_name: string;
  file_size: number | null;
  file_type: string;
  sort_order: number;
  created_at: string;
}

export interface Chapter {
  id: string;
  title: string;
  sort_order: number;
  category_id: string | null;
  /** 多对多：章节所属课程 ID 列表 */
  course_ids: string[];
  videos: Video[];
}

export interface Video {
  id: string;
  course_id: string;
  chapter_id: string | null;
  title: string;
  obs_key: string;
  file_size: number | null;
  duration: number | null;
  sort_order: number;
}

/** CourseCreate / CourseUpdate 的并集（chapter_ids 为覆盖式语义） */
export interface CoursePayload {
  title?: string;
  require_attendance?: boolean;
  description?: string | null;
  cover_image?: string | null;
  category_id?: string | null;
  exam_id?: string | null;
  status?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  chapter_ids?: string[];
}

export interface UserRow {
  id: string;
  name: string;
  department: string | null;
}

export interface DeptNode {
  id: string;
  name: string;
  parent_id: string | null;
  children?: DeptNode[];
}

/** GET /courses/{id}/assignments 响应 */
export interface AssignmentsResp {
  users: UserRow[];
  departments: DeptNode[];
}

export interface AssignPayload {
  user_ids: string[];
  department_ids: string[];
}

/** SessionOut（含派生统计字段） */
export interface AttendanceSession {
  id: string;
  course_id: string;
  title: string;
  start_time: string;
  end_time: string;
  late_after_minutes: number | null;
  location_name: string | null;
  latitude: number | null;
  longitude: number | null;
  radius_m: number;
  ip_allowlist: string[] | null;
  require_network: boolean;
  require_geofence: boolean;
  dedupe_device: boolean;
  code_rotate_seconds: number;
  remark: string | null;
  created_at: string;
  state: string; // upcoming / open / closed
  checked_in_count: number;
  expected_count: number;
  risk_count: number;
}

/** 场次创建/更新请求体（SessionCreate/SessionUpdate 并集） */
export interface SessionPayload {
  title?: string;
  start_time?: string;
  end_time?: string;
  late_after_minutes?: number | null;
  location_name?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  radius_m?: number;
  ip_allowlist?: string[] | null;
  require_network?: boolean;
  require_geofence?: boolean;
  dedupe_device?: boolean;
  code_rotate_seconds?: number;
  remark?: string | null;
}

/** GET /question-categories/{id}/impact 响应（删除影响弹窗） */
export interface CategoryImpact {
  name: string;
  child_count: number;
  courses: number;
  papers: number;
  questions: number;
  details: {
    name: string;
    depth: number;
    courses: number;
    papers: number;
    questions: number;
  }[];
}

// ───────────────────────── 课程 CRUD ─────────────────────────

export function listCourses(params?: {
  category_id?: string | null;
  status?: string | null;
  search?: string | null;
}): Promise<Course[]> {
  const qs = new URLSearchParams();
  if (params?.category_id) qs.set("category_id", params.category_id);
  if (params?.status) qs.set("status", params.status);
  if (params?.search) qs.set("search", params.search);
  const q = qs.toString();
  return api<Course[]>(`/courses${q ? `?${q}` : ""}`);
}

export function getCourse(id: string): Promise<Course> {
  return api<Course>(`/courses/${id}`);
}

export function createCourse(payload: CoursePayload): Promise<Course> {
  return api<Course>("/courses", { method: "POST", body: JSON.stringify(payload) });
}

export function updateCourse(id: string, payload: CoursePayload): Promise<Course> {
  return api<Course>(`/courses/${id}`, { method: "PUT", body: JSON.stringify(payload) });
}

/** 发布/下架：无独立端点，走 PUT {status}（学员端按 status 过滤） */
export function updateCourseStatus(id: string, status: string): Promise<Course> {
  return api<Course>(`/courses/${id}`, { method: "PUT", body: JSON.stringify({ status }) });
}

/** 删除课程。有学习记录时后端 409，需再传 force=true 二次确认 */
export async function deleteCourse(id: string, force = false): Promise<void> {
  await api(`/courses/${id}?confirm=true${force ? "&force=true" : ""}`, { method: "DELETE" });
}

// ───────────────────────── 章节 ─────────────────────────

export function listChapters(): Promise<Chapter[]> {
  return api<Chapter[]>("/chapters");
}

export function createChapter(title: string, categoryId: string | null): Promise<Chapter> {
  return api<Chapter>("/chapters", {
    method: "POST",
    body: JSON.stringify({ title, category_id: categoryId }),
  });
}

export async function deleteChapter(id: string): Promise<void> {
  await api(`/chapters/${id}?confirm=true`, { method: "DELETE" });
}

// ───────────────────────── 学员 / 部门（分配选择器数据源） ─────────────────────────

/** /users 单页上限 200（后端 le=200）。循环翻页拿全量，账号量级下最多几十页兜底 100 页 */
export async function listAllUsers(): Promise<UserRow[]> {
  const pageSize = 200;
  const all: UserRow[] = [];
  for (let page = 1; page <= 100; page++) {
    const batch = await api<UserRow[]>(`/users?page=${page}&page_size=${pageSize}`);
    all.push(...batch);
    if (batch.length < pageSize) break;
  }
  return all;
}

/** GET /departments 返回部门树（children 递归） */
export function listDepartments(): Promise<DeptNode[]> {
  return api<DeptNode[]>("/departments");
}

// ───────────────────────── 课程分配 ─────────────────────────

export function getAssignments(courseId: string): Promise<AssignmentsResp> {
  return api<AssignmentsResp>(`/courses/${courseId}/assignments`);
}

/** POST 为增量幂等（已存在的不重复插入） */
export async function postAssignments(courseId: string, payload: AssignPayload): Promise<void> {
  await api(`/courses/${courseId}/assignments`, { method: "POST", body: JSON.stringify(payload) });
}

/** DELETE 同 body；移除部门时后端按部门名连带移除成员 */
export async function removeAssignments(courseId: string, payload: AssignPayload): Promise<void> {
  await api(`/courses/${courseId}/assignments`, { method: "DELETE", body: JSON.stringify(payload) });
}

// ───────────────────────── 签到场次 ─────────────────────────

export function listSessions(courseId: string): Promise<AttendanceSession[]> {
  return api<AttendanceSession[]>(`/attendance/sessions?course_id=${courseId}`);
}

export function createSession(courseId: string, payload: SessionPayload): Promise<AttendanceSession> {
  return api<AttendanceSession>(`/attendance/sessions?course_id=${courseId}`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateSession(sessionId: string, payload: SessionPayload): Promise<AttendanceSession> {
  return api<AttendanceSession>(`/attendance/sessions/${sessionId}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

/** 已有签到记录时后端 409，需再传 force=true 二次确认 */
export async function deleteSession(sessionId: string, force = false): Promise<void> {
  await api(`/attendance/sessions/${sessionId}?confirm=true${force ? "&force=true" : ""}`, {
    method: "DELETE",
  });
}

// ───────────────────────── 视频（OSS 直传三步流） ─────────────────────────

export function getUploadToken(ext: string, contentType: string): Promise<{
  filename: string;
  upload_url: string;
}> {
  return api(`/videos/upload-token?ext=${encodeURIComponent(ext)}&content_type=${encodeURIComponent(contentType)}`);
}

/** 浏览器直传 OSS（复用 lib/api 的 XHR 实现，带进度） */
export function uploadVideoToOSS(
  uploadUrl: string,
  file: File,
  contentType: string,
  onProgress?: (pct: number) => void,
): Promise<void> {
  return uploadToOSS(uploadUrl, file, contentType, onProgress);
}

/** 服务器中转上传（直传失败的回退通道）：后端 OSS 优先、不可用落本地磁盘 */
export function uploadVideoRelay(
  file: File,
  onProgress?: (pct: number) => void,
): Promise<{ filename: string; stored: "oss" | "local"; file_size: number }> {
  return uploadFileWithProgress("/videos/upload-relay", file, onProgress);
}

export function addVideo(
  courseId: string,
  payload: {
    title: string;
    obs_key: string;
    file_size?: number | null;
    duration?: number | null;
    chapter_id?: string | null;
  },
): Promise<Video> {
  return api<Video>(`/courses/${courseId}/videos`, { method: "POST", body: JSON.stringify(payload) });
}

/** 改视频标题（后端 VideoCreate 全量体，只传 title 即可，其余字段留空不触发覆盖） */
export function renameVideo(videoId: string, title: string): Promise<Video> {
  return api<Video>(`/videos/${videoId}`, { method: "PUT", body: JSON.stringify({ title }) });
}

export async function deleteVideo(videoId: string): Promise<void> {
  await api(`/videos/${videoId}?confirm=true`, { method: "DELETE" });
}

// ───────────────────────── 课程课件（本地存储，非视频学习资料） ─────────────────────────

/** 上传课件（multipart）。后端白名单 pdf/ppt/pptx/html/htm/png/jpg/jpeg/gif/webp，≤50MB，PPT 自动转 PDF 预览 */
export function uploadMaterial(
  courseId: string,
  file: File,
  onProgress?: (pct: number) => void,
): Promise<CourseMaterial> {
  return uploadFileWithProgress<CourseMaterial>(`/courses/${courseId}/materials`, file, onProgress);
}

export async function deleteMaterial(materialId: string): Promise<void> {
  await api(`/course-materials/${materialId}?confirm=true`, { method: "DELETE" });
}

/** 预览端点（PPT/PPTX 后端自动返回转好的 PDF；管理端与学员端同一路径，鉴权走课程分配） */
export function materialPreviewPath(materialId: string): string {
  return `/course-materials/${materialId}/preview`;
}

/** 下载端点（原始文件） */
export function materialDownloadPath(materialId: string): string {
  return `/course-materials/${materialId}/download`;
}

/** 视频流地址（token 走 query，后端 <img>/<video> 场景无法带 Header）。
 *  修复旧页面硬编码 "/api/learning-platform" 的问题，统一用 BASE。 */
export function videoStreamUrl(obsKey: string): string {
  const token = localStorage.getItem("lp_token") || "";
  return `${BASE}/videos/stream/${obsKey}?token=${token}`;
}

/** 文件名 → 合法扩展名（后端白名单：mp4/mov/avi/mkv/webm） */
export function videoExtOf(name: string): string {
  const ext = name.toLowerCase().split(".").pop() || "mp4";
  return ["mp4", "mov", "avi", "mkv", "webm"].includes(ext) ? ext : "mp4";
}

/** 读取视频时长（秒），失败返回 null（上传前探测用，课程表单抽屉使用） */
export function probeVideoDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const el = document.createElement("video");
    el.preload = "metadata";
    el.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(el.duration) ? Math.round(el.duration) : null);
    };
    el.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    el.src = url;
  });
}

// ───────────────────────── 分类树（题库分类共用） ─────────────────────────

export function getCategoryTree(): Promise<TreeNode[]> {
  return api<TreeNode[]>("/question-categories/tree");
}

export function getCategoryFlat(): Promise<FlatCategory[]> {
  return api<FlatCategory[]>("/question-categories/flat");
}

export interface NewCategory {
  id: string;
  name: string;
  parent_id: string | null;
  sort_order: number;
}

export function createCategory(name: string, parentId?: string | null): Promise<NewCategory> {
  return api<NewCategory>("/question-categories", {
    method: "POST",
    body: JSON.stringify(parentId ? { name, parent_id: parentId } : { name }),
  });
}

export function renameCategory(id: string, name: string): Promise<unknown> {
  return api(`/question-categories/${id}`, { method: "PUT", body: JSON.stringify({ name }) });
}

export function getCategoryImpact(id: string): Promise<CategoryImpact> {
  return api<CategoryImpact>(`/question-categories/${id}/impact`);
}

export function deleteCategory(id: string): Promise<{
  ok: boolean;
  affected: { courses: number; papers: number; questions: number };
}> {
  return api(`/question-categories/${id}`, { method: "DELETE" });
}

/** 同级拖拽重排 */
export function reorderCategoriesBatch(parentId: string | null, orderedIds: string[]): Promise<unknown> {
  return api("/question-categories/reorder-batch", {
    method: "PUT",
    body: JSON.stringify({ parent_id: parentId, ordered_ids: orderedIds }),
  });
}
