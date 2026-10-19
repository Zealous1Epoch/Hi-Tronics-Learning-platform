import { Plus, Trash2 } from "lucide-react";

/**
 * 建课/改课弹窗内嵌的签到场次编辑器（简化版）。
 *
 * 只暴露最常用字段（名称 / 起止时间 / 地点 / 迟到阈值），防代签高级选项
 * （设备去重 / 定位 / 网络）使用默认值：动态码 30 秒轮换 + 设备去重开启；
 * 需要调整时通过课程卡片的「签到」按钮进入完整管理弹窗。
 *
 * 数据流：场次列表由父组件持有（新建课程时先攒在本地，课程保存成功后批量创建）。
 */
export interface InlineSession {
  /** 已存在于后端的场次 id；undefined 表示本次新增 */
  id?: string;
  title: string;
  start_time: string; // datetime-local 值，如 2026-09-20T14:00
  end_time: string;
  location_name: string;
  late_after_minutes: string; // 空串 = 不区分迟到
}

export const EMPTY_INLINE_SESSION: Omit<InlineSession, "id"> = {
  title: "",
  start_time: "",
  end_time: "",
  location_name: "",
  late_after_minutes: "",
};

const inputCls = "w-full border border-border rounded-md px-2.5 py-1.5 text-sm";

export function validateInlineSessions(sessions: InlineSession[]): string | null {
  for (let i = 0; i < sessions.length; i++) {
    const s = sessions[i];
    const label = s.title.trim() || `第 ${i + 1} 场`;
    if (!s.title.trim()) return `场次 ${i + 1}：请填写场次名称`;
    if (!s.start_time || !s.end_time) return `「${label}」：请选择签到开始与结束时间`;
    if (new Date(s.end_time) <= new Date(s.start_time)) return `「${label}」：结束时间必须晚于开始时间`;
  }
  return null;
}

export default function SessionInlineEditor({
  sessions,
  onChange,
}: {
  sessions: InlineSession[];
  onChange: (sessions: InlineSession[]) => void;
}) {
  const update = (idx: number, patch: Partial<InlineSession>) => {
    onChange(sessions.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  };

  return (
    <div className="space-y-2">
      {sessions.length === 0 && (
        <p className="text-xs text-text-secondary/70 py-1">
          线下课程必须至少配置 1 个签到场次，学员完成全部场次签到后才能参加考试。
        </p>
      )}

      {sessions.map((s, idx) => (
        <div key={idx} className="border border-border rounded-md p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-primary">场次 {idx + 1}</span>
            <button
              type="button"
              onClick={() => onChange(sessions.filter((_, i) => i !== idx))}
              className="text-text-secondary hover:text-red-500"
              title="删除该场次"
            >
              <Trash2 size={13} />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs text-text-secondary mb-1">场次名称</label>
              <input
                className={inputCls}
                value={s.title}
                onChange={(e) => update(idx, { title: e.target.value })}
                placeholder="如：第一天 上午"
              />
            </div>
            <div>
              <label className="block text-xs text-text-secondary mb-1">地点（选填）</label>
              <input
                className={inputCls}
                value={s.location_name}
                onChange={(e) => update(idx, { location_name: e.target.value })}
                placeholder="如：三楼培训室"
              />
            </div>
            <div>
              <label className="block text-xs text-text-secondary mb-1">签到开始</label>
              <div className="relative">
                <input
                  type="datetime-local"
                  className={`${inputCls}${s.start_time ? "" : " k-date-empty"}`}
                  value={s.start_time}
                  onChange={(e) => update(idx, { start_time: e.target.value })}
                />
                {!s.start_time && <TimeHint text="选择开始时间" />}
              </div>
            </div>
            <div>
              <label className="block text-xs text-text-secondary mb-1">签到结束</label>
              <div className="relative">
                <input
                  type="datetime-local"
                  className={`${inputCls}${s.end_time ? "" : " k-date-empty"}`}
                  value={s.end_time}
                  onChange={(e) => update(idx, { end_time: e.target.value })}
                />
                {!s.end_time && <TimeHint text="选择结束时间" />}
              </div>
            </div>
            <div>
              <label className="block text-xs text-text-secondary mb-1">迟到阈值（分钟，选填）</label>
              <input
                type="number"
                className={inputCls}
                value={s.late_after_minutes}
                onChange={(e) => update(idx, { late_after_minutes: e.target.value })}
                placeholder="留空=不区分迟到"
              />
            </div>
          </div>
        </div>
      ))}

      <button
        type="button"
        onClick={() => onChange([...sessions, { ...EMPTY_INLINE_SESSION }])}
        className="w-full border border-dashed border-primary/40 text-primary rounded-md py-2 text-sm hover:bg-primary/5 flex items-center justify-center gap-1"
      >
        <Plus size={14} /> 添加签到场次
      </button>
      <p className="text-[11px] text-text-secondary/70">
        签到码默认 30 秒自动轮换；培训现场打开场次列表里的「投屏签到码」大屏页展示即可。
      </p>
    </div>
  );
}

/** 空时间控件上的中文占位（配合 index.css k-date-empty 隐藏原生水印） */
function TimeHint({ text }: { text: string }) {
  return (
    <span className="absolute inset-y-0 left-0 flex items-center pl-2.5 text-sm text-text-muted pointer-events-none">
      {text}
    </span>
  );
}
