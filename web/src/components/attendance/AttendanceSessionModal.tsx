import { useCallback, useEffect, useMemo, useState } from "react";
import { ExternalLink, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { api } from "../../lib/api";

/* ── 类型 ── */
interface SessionItem {
  id: string;
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
  state: "upcoming" | "open" | "closed";
  checked_in_count: number;
  expected_count: number;
  risk_count: number;
}

interface RecordItem {
  id: string;
  user_id: string;
  status: string;
  source: string;
  checked_in_at: string;
  client_ip: string | null;
  device_id: string | null;
  distance_m: number | null;
  risk_flags: string[];
  remark: string | null;
}

interface RosterEntry {
  user_id: string;
  user_name: string;
  username: string;
  employee_id: string | null;
  department: string | null;
  record: RecordItem | null;
  status: string;
}

interface Roster {
  session: SessionItem;
  entries: RosterEntry[];
  present_count: number;
  absent_count: number;
  risk_count: number;
}

const STATE_LABEL: Record<string, string> = {
  upcoming: "未开始",
  open: "签到中",
  closed: "已结束",
};
const STATE_CLASS: Record<string, string> = {
  upcoming: "bg-bg-layout text-text-secondary",
  open: "bg-emerald-50 text-emerald-600",
  closed: "bg-amber-50 text-amber-600",
};
const STATUS_LABEL: Record<string, string> = {
  present: "已签到",
  late: "迟到",
  manual: "管理员补签",
  revoked: "已撤销",
  absent: "未签到",
};
const STATUS_CLASS: Record<string, string> = {
  present: "text-emerald-600",
  late: "text-amber-600",
  manual: "text-primary",
  revoked: "text-text-secondary/60 line-through",
  absent: "text-red-500",
};
const FLAG_LABEL: Record<string, string> = {
  ip_mismatch: "IP 不符",
  no_geolocation: "无定位",
  geo_soft_pass: "定位偏远",
  device_reuse: "设备重复",
  late: "迟到",
  manual: "人工补签",
};

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * 把 datetime-local 输入值转成「无时区标记」的本地时间串（如 2026-09-20T14:00:00）。
 *
 * 不能用 toISOString()：它会把北京时间转成 UTC（14:00 → 06:00Z），而后端
 * 按北京时间 datetime.now() 做签到时间窗判断、返回值又不含时区，会造成
 * 整整 8 小时的偏移。前后端统一存「naive 本地时间」口径才一致。
 */
export function toNaiveLocal(value: string): string {
  if (!value) return "";
  const d = new Date(value);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
}

function fmt(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}-${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

const EMPTY_FORM = {
  title: "",
  start_time: "",
  end_time: "",
  location_name: "",
  late_after_minutes: "",
  code_rotate_seconds: 30,
  latitude: "",
  longitude: "",
  radius_m: 200,
  ip_allowlist: "",
  require_network: false,
  require_geofence: false,
  dedupe_device: false,
};

/**
 * 签到场次管理弹窗。
 *
 * 左侧：场次列表 + 新建/编辑表单；右侧：选中场次的应到名单（含异常标记、补签、撤销）。
 * 投屏签到码通过新标签页打开 `/admin/attendance/:id/board`，便于用投影仪展示。
 */
export default function AttendanceSessionModal({
  courseId,
  courseTitle,
  onClose,
}: {
  courseId: string;
  courseTitle: string;
  onClose: () => void;
}) {
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [roster, setRoster] = useState<Roster | null>(null);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [checkedAbsent, setCheckedAbsent] = useState<Set<string>>(new Set());

  const loadSessions = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<SessionItem[]>(`/attendance/sessions?course_id=${courseId}`);
      setSessions(data);
      // 保持当前选中项（若它仍存在），否则回落到第一个场次
      setSelectedId((prev) => (prev && data.some((s) => s.id === prev) ? prev : data[0]?.id ?? null));
    } finally {
      setLoading(false);
    }
  }, [courseId]);

  /** 导出签到表：必须带 token，普通 <a>/window.open 不会携带 Authorization 头 */
  const handleExport = async (sessionId: string) => {
    try {
      const token = localStorage.getItem("lp_token");
      const res = await fetch(`/api/learning-platform/attendance/sessions/${sessionId}/export`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error("导出失败");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `attendance_${sessionId.slice(0, 8)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert(e instanceof Error ? e.message : "导出失败");
    }
  };

  useEffect(() => {
    loadSessions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId]);

  const loadRoster = useCallback(async (sessionId: string) => {
    setRosterLoading(true);
    setCheckedAbsent(new Set());
    try {
      setRoster(await api<Roster>(`/attendance/sessions/${sessionId}/roster`));
    } finally {
      setRosterLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedId) loadRoster(selectedId);
    else setRoster(null);
  }, [selectedId, loadRoster]);

  const resetForm = () => {
    setEditingId(null);
    setForm({ ...EMPTY_FORM });
  };

  const startEdit = (s: SessionItem) => {
    setEditingId(s.id);
    setForm({
      title: s.title,
      start_time: toLocalInput(s.start_time),
      end_time: toLocalInput(s.end_time),
      location_name: s.location_name || "",
      late_after_minutes: s.late_after_minutes == null ? "" : String(s.late_after_minutes),
      code_rotate_seconds: s.code_rotate_seconds,
      latitude: s.latitude == null ? "" : String(s.latitude),
      longitude: s.longitude == null ? "" : String(s.longitude),
      radius_m: s.radius_m,
      ip_allowlist: (s.ip_allowlist || []).join(", "),
      require_network: s.require_network,
      require_geofence: s.require_geofence,
      dedupe_device: s.dedupe_device,
    });
  };

  const handleSave = async () => {
    if (!form.title.trim()) return alert("请填写场次名称");
    if (!form.start_time || !form.end_time) return alert("请填写签到开始与结束时间");
    setSaving(true);
    try {
      const body = {
        title: form.title.trim(),
        start_time: toNaiveLocal(form.start_time),
        end_time: toNaiveLocal(form.end_time),
        location_name: form.location_name.trim() || null,
        late_after_minutes: form.late_after_minutes === "" ? null : Number(form.late_after_minutes),
        code_rotate_seconds: Number(form.code_rotate_seconds) || 30,
        latitude: form.latitude === "" ? null : Number(form.latitude),
        longitude: form.longitude === "" ? null : Number(form.longitude),
        radius_m: Number(form.radius_m) || 200,
        ip_allowlist: form.ip_allowlist
          .split(/[,，\s]+/)
          .map((x) => x.trim())
          .filter(Boolean),
        require_network: form.require_network,
        require_geofence: form.require_geofence,
        dedupe_device: form.dedupe_device,
      };
      if (editingId) {
        await api(`/attendance/sessions/${editingId}`, {
          method: "PUT",
          body: JSON.stringify(body),
        });
      } else {
        await api(`/attendance/sessions?course_id=${courseId}`, {
          method: "POST",
          body: JSON.stringify(body),
        });
      }
      resetForm();
      await loadSessions();
    } catch (e) {
      alert(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (s: SessionItem) => {
    if (!confirm(`确定删除场次「${s.title}」？`)) return;
    try {
      await api(`/attendance/sessions/${s.id}?confirm=true`, { method: "DELETE" });
      if (selectedId === s.id) setSelectedId(null);
      await loadSessions();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "删除失败";
      if (msg.includes("签到记录")) {
        if (!confirm(`${msg}\n\n确定要连签到记录一起删除吗？此操作不可恢复。`)) return;
        try {
          await api(`/attendance/sessions/${s.id}?confirm=true&force=true`, { method: "DELETE" });
          if (selectedId === s.id) setSelectedId(null);
          await loadSessions();
        } catch (e2) {
          alert(e2 instanceof Error ? e2.message : "删除失败");
        }
        return;
      }
      alert(msg);
    }
  };

  const handleManualCheckIn = async () => {
    if (!selectedId || checkedAbsent.size === 0) return;
    try {
      const res = await api<{ created: number }>(`/attendance/sessions/${selectedId}/records`, {
        method: "POST",
        body: JSON.stringify({
          user_ids: Array.from(checkedAbsent),
          status: "manual",
          remark: "管理员补签",
        }),
      });
      alert(`已补签 ${res.created} 人`);
      await loadRoster(selectedId);
      await loadSessions();
    } catch (e) {
      alert(e instanceof Error ? e.message : "补签失败");
    }
  };

  const handleRevoke = async (recordId: string, name: string) => {
    if (!confirm(`撤销「${name}」的签到？该记录会保留但不再计入出勤。`)) return;
    try {
      await api(`/attendance/records/${recordId}`, { method: "DELETE" });
      if (selectedId) await loadRoster(selectedId);
      await loadSessions();
    } catch (e) {
      alert(e instanceof Error ? e.message : "撤销失败");
    }
  };

  const absentEntries = useMemo(
    () => (roster?.entries || []).filter((e) => !e.record || e.record.status === "revoked"),
    [roster],
  );

  const inputCls = "w-full border border-border rounded-md px-2.5 py-1.5 text-sm";
  const labelCls = "block text-xs text-text-secondary mb-1";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div
        className="bg-bg-base rounded-lg shadow-xl w-full max-w-6xl max-h-[92vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div>
            <h3 className="font-bold text-sm">线下签到管理</h3>
            <p className="text-xs text-text-secondary mt-0.5">{courseTitle}</p>
          </div>
          <button onClick={onClose} className="text-text-secondary hover:text-text-base">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-hidden flex">
          {/* ── 左：场次列表 + 表单 ── */}
          <div className="w-[420px] shrink-0 border-r border-border flex flex-col overflow-hidden">
            <div className="p-4 space-y-2 overflow-y-auto flex-1">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-text-secondary">共 {sessions.length} 个场次</span>
                <button
                  onClick={() => loadSessions()}
                  className="text-xs text-primary hover:underline flex items-center gap-1"
                >
                  <RefreshCw size={12} /> 刷新
                </button>
              </div>

              {loading && <p className="text-xs text-text-secondary">加载中...</p>}
              {!loading && sessions.length === 0 && (
                <p className="text-xs text-text-secondary py-3">
                  尚未配置签到场次。线下课程必须至少配置一个场次，否则学员无法参加考试。
                </p>
              )}

              {sessions.map((s) => (
                <div
                  key={s.id}
                  onClick={() => setSelectedId(s.id)}
                  className={`rounded-lg border p-3 cursor-pointer transition-colors ${
                    selectedId === s.id ? "border-primary/50 bg-primary/5" : "border-border hover:border-primary/30"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium truncate">{s.title}</span>
                    <span className={`text-[11px] px-1.5 py-0.5 rounded shrink-0 ${STATE_CLASS[s.state]}`}>
                      {STATE_LABEL[s.state]}
                    </span>
                  </div>
                  <div className="text-xs text-text-secondary mt-1 space-y-0.5">
                    <p>
                      {fmt(s.start_time)} ~ {fmt(s.end_time)}
                      {s.location_name ? ` · ${s.location_name}` : ""}
                    </p>
                    <p>
                      已签到 <span className="text-primary font-medium">{s.checked_in_count}</span> / {s.expected_count} 人
                      {s.risk_count > 0 && <span className="text-amber-600 ml-2">异常 {s.risk_count}</span>}
                      {s.dedupe_device && <span className="ml-2 text-text-secondary/60">设备去重</span>}
                      {s.require_network && <span className="ml-2 text-text-secondary/60">限网络</span>}
                      {s.require_geofence && <span className="ml-2 text-text-secondary/60">限定位</span>}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 mt-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        window.open(`/learning-platform/admin/attendance/${s.id}/board`, "_blank");
                      }}
                      className="flex-1 text-xs text-primary hover:bg-primary/5 rounded py-1 border border-primary/20 flex items-center justify-center gap-1"
                    >
                      <ExternalLink size={11} /> 投屏签到码
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleExport(s.id);
                      }}
                      className="text-xs text-text-secondary hover:text-primary px-2 py-1"
                    >
                      导出
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        startEdit(s);
                      }}
                      className="text-xs text-text-secondary hover:text-primary px-2 py-1"
                    >
                      编辑
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(s);
                      }}
                      className="text-xs text-text-secondary hover:text-red-500 px-1.5 py-1"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* 表单 */}
            <div className="border-t border-border p-4 space-y-2.5 shrink-0 max-h-[46%] overflow-y-auto">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-primary">
                  {editingId ? "编辑场次" : "新增场次"}
                </span>
                {editingId && (
                  <button onClick={resetForm} className="text-xs text-text-secondary hover:text-primary">
                    取消编辑
                  </button>
                )}
              </div>
              <div>
                <label className={labelCls}>场次名称</label>
                <input
                  className={inputCls}
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="如：第一天 上午"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={labelCls}>签到开始</label>
                  <input
                    type="datetime-local"
                    className={inputCls}
                    value={form.start_time}
                    onChange={(e) => setForm({ ...form, start_time: e.target.value })}
                  />
                </div>
                <div>
                  <label className={labelCls}>签到结束</label>
                  <input
                    type="datetime-local"
                    className={inputCls}
                    value={form.end_time}
                    onChange={(e) => setForm({ ...form, end_time: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={labelCls}>地点（选填）</label>
                  <input
                    className={inputCls}
                    value={form.location_name}
                    onChange={(e) => setForm({ ...form, location_name: e.target.value })}
                    placeholder="如：三楼培训室"
                  />
                </div>
                <div>
                  <label className={labelCls}>迟到阈值（分钟）</label>
                  <input
                    type="number"
                    className={inputCls}
                    value={form.late_after_minutes}
                    onChange={(e) => setForm({ ...form, late_after_minutes: e.target.value })}
                    placeholder="留空=不区分迟到"
                  />
                </div>
              </div>
              <div>
                <label className={labelCls}>签到码轮换周期（秒）</label>
                <input
                  type="number"
                  className={inputCls}
                  value={form.code_rotate_seconds}
                  onChange={(e) => setForm({ ...form, code_rotate_seconds: Number(e.target.value) })}
                />
                <p className="text-[11px] text-text-secondary/70 mt-1">
                  越短越安全（截图/转发很快就会失效），但学员输码时间也更紧。建议 30 秒。
                </p>
              </div>

              <button
                onClick={handleSave}
                disabled={saving}
                className="w-full bg-primary text-white rounded-md py-2 text-sm disabled:opacity-50 flex items-center justify-center gap-1"
              >
                <Plus size={14} /> {editingId ? "保存修改" : "新增场次"}
              </button>
            </div>
          </div>

          {/* ── 右：名单 ── */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {!selectedId && (
              <div className="flex-1 flex items-center justify-center text-sm text-text-secondary">
                请选择左侧场次查看签到名单
              </div>
            )}
            {selectedId && (
              <>
                <div className="px-4 py-3 border-b border-border flex items-center justify-between shrink-0">
                  <div className="text-xs text-text-secondary">
                    应到 {roster?.session.expected_count ?? 0} 人 · 已签到{" "}
                    <span className="text-primary font-medium">{roster?.present_count ?? 0}</span> · 未签到{" "}
                    <span className="text-red-500">{absentEntries.length}</span>
                    {(roster?.risk_count ?? 0) > 0 && (
                      <span className="text-amber-600 ml-2">异常 {roster?.risk_count}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => selectedId && loadRoster(selectedId)}
                      className="text-xs text-primary hover:underline flex items-center gap-1"
                    >
                      <RefreshCw size={12} /> 刷新
                    </button>
                    <button
                      onClick={handleManualCheckIn}
                      disabled={checkedAbsent.size === 0}
                      className="text-xs bg-primary text-white rounded px-2.5 py-1 disabled:opacity-40"
                    >
                      补签选中 {checkedAbsent.size > 0 ? `(${checkedAbsent.size})` : ""}
                    </button>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto">
                  {rosterLoading && <p className="p-4 text-xs text-text-secondary">加载中...</p>}
                  {!rosterLoading && roster && (
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-bg-layout text-text-secondary">
                        <tr>
                          <th className="w-8 py-2"></th>
                          <th className="text-left py-2 px-2 font-medium">姓名</th>
                          <th className="text-left py-2 px-2 font-medium">工号</th>
                          <th className="text-left py-2 px-2 font-medium">部门</th>
                          <th className="text-left py-2 px-2 font-medium">状态</th>
                          <th className="text-left py-2 px-2 font-medium">签到时间</th>
                          <th className="text-left py-2 px-2 font-medium">来源 IP</th>
                          <th className="text-left py-2 px-2 font-medium">异常</th>
                          <th className="w-14 py-2"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {roster.entries.map((e) => {
                          const rec = e.record;
                          const isAbsent = !rec || rec.status === "revoked";
                          return (
                            <tr key={e.user_id} className="border-b border-border/40 hover:bg-bg-layout/40">
                              <td className="py-1.5 px-2">
                                {isAbsent && (
                                  <input
                                    type="checkbox"
                                    checked={checkedAbsent.has(e.user_id)}
                                    onChange={(ev) => {
                                      const next = new Set(checkedAbsent);
                                      if (ev.target.checked) next.add(e.user_id);
                                      else next.delete(e.user_id);
                                      setCheckedAbsent(next);
                                    }}
                                  />
                                )}
                              </td>
                              <td className="py-1.5 px-2">{e.user_name}</td>
                              <td className="py-1.5 px-2 text-text-secondary">{e.employee_id || "-"}</td>
                              <td className="py-1.5 px-2 text-text-secondary truncate max-w-[140px]">
                                {e.department || "-"}
                              </td>
                              <td className={`py-1.5 px-2 font-medium ${STATUS_CLASS[e.status] || ""}`}>
                                {STATUS_LABEL[e.status] || e.status}
                              </td>
                              <td className="py-1.5 px-2 text-text-secondary">
                                {rec ? fmt(rec.checked_in_at) : "-"}
                              </td>
                              <td className="py-1.5 px-2 text-text-secondary/70">{rec?.client_ip || "-"}</td>
                              <td className="py-1.5 px-2">
                                {rec?.risk_flags?.length ? (
                                  <span className="text-amber-600">
                                    {rec.risk_flags.map((f) => FLAG_LABEL[f] || f).join("、")}
                                  </span>
                                ) : (
                                  <span className="text-text-secondary/40">-</span>
                                )}
                              </td>
                              <td className="py-1.5 px-2">
                                {rec && rec.status !== "revoked" && (
                                  <button
                                    onClick={() => handleRevoke(rec.id, e.user_name)}
                                    className="text-text-secondary hover:text-red-500"
                                    title="撤销签到"
                                  >
                                    撤销
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
