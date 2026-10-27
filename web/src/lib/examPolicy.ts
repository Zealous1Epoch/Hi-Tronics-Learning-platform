/** 错题回顾时机：与后端 app/schemas/exam.py 的 ReviewPolicy 一一对应 */
export type ReviewPolicy = "always" | "after_exhausted" | "after_window";

export const REVIEW_POLICIES: { value: ReviewPolicy; label: string; hint: string }[] = [
  { value: "always", label: "交卷即可看", hint: "适合培训学习型：错了先看解析再重考" },
  { value: "after_exhausted", label: "重考用完或及格后", hint: "还有重考机会时不展示答案，防止看过答案重考送分" },
  { value: "after_window", label: "考试截止后", hint: "开放窗口结束前所有人看不到答案，适合认证考核" },
];

export const REVIEW_POLICY_LABEL: Record<string, string> = Object.fromEntries(
  REVIEW_POLICIES.map((p) => [p.value, p.label]),
);
