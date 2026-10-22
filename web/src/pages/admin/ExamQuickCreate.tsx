/**
 * 一键建考向导（三步）
 *
 * ① 基本信息：名称 + 开放时间（时长/重考等全部给默认值）
 * ② 选择内容：从题库固定选题 / 随机规则 / 复用已发布试卷（三选一）
 * ③ 确认发布：关联课程 + 顺手分配学员 + 及格分（自动 60%）+ 可选存为试卷模板 → 创建并发布
 *
 * 后端 POST /api/exams/quick-create 一个事务完成「建考试 + 组卷 + 绑课程 + 发布」，
 * 管理员不再需要先去试卷管理建卷、发布，再回考试管理挑选。
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, type OrgMemberRow, type OrgMembersResponse } from "../../lib/api";
import { notify } from "../../components/ui/Toast";
import QuestionPickerPanel, { type PickedQuestion } from "../../components/exam/QuestionPickerPanel";
import RandomRulesPanel, { type RandomRule } from "../../components/exam/RandomRulesPanel";
import AIGenerateModal from "../../components/question/AIGenerateModal";
import ImportQuestionsModal from "../../components/question/ImportQuestionsModal";
import DeptUserPicker from "../../components/course/DeptUserPicker";
import { buildDescendantMap, type FlatCategory } from "../../components/CourseTree";

interface CourseItem { id: string; title: string; category_id: string | null }
interface ExamLite { id: string; course_id: string; title: string; status: string }
interface PaperItem { id: string; title: string; paper_type: string; total_score: number; status: string }

interface Props {
  onClose: () => void;
  onDone: () => void;
}

const STEPS = ["基本信息", "选择内容", "确认发布"];
const TABS = [
  { key: "bank_fixed", label: "从题库选题" },
  { key: "bank_random", label: "随机抽题规则" },
  { key: "paper", label: "复用已有试卷" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

export default function ExamQuickCreate({ onClose, onDone }: Props) {
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);

  // ① 基本信息
  const [title, setTitle] = useState("");
  const [duration, setDuration] = useState(60);
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");

  // ② 内容
  const [tab, setTab] = useState<TabKey>("bank_fixed");
  const [pickerCat, setPickerCat] = useState<string | null>(null);
  const [picked, setPicked] = useState<PickedQuestion[]>([]);
  const [splitTarget, setSplitTarget] = useState(100);
  const [randBanks, setRandBanks] = useState<string[]>([]);
  const [randRules, setRandRules] = useState<RandomRule[]>([]);
  const [papers, setPapers] = useState<PaperItem[]>([]);
  const [paperSearch, setPaperSearch] = useState("");
  const [selectedPaperId, setSelectedPaperId] = useState("");

  // ② 就地补题弹窗（AI 生成 / Excel 导入入库后 refreshKey 触发选题面板重拉）
  const [showAI, setShowAI] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [pickerRefreshKey, setPickerRefreshKey] = useState(0);

  // ③ 确认
  const [courses, setCourses] = useState<CourseItem[]>([]);
  const [exams, setExams] = useState<ExamLite[]>([]);
  const [flatCategories, setFlatCategories] = useState<FlatCategory[]>([]);
  const [courseId, setCourseId] = useState("");
  const [passInput, setPassInput] = useState("");
  const [maxAttempts, setMaxAttempts] = useState("");
  const [saveTemplate, setSaveTemplate] = useState(false);
  const [templateName, setTemplateName] = useState("");

  // ③ 建考直接选人：选中人员随建考同时分配到课程
  const [members, setMembers] = useState<OrgMemberRow[]>([]);
  const [assignedUsers, setAssignedUsers] = useState<{ id: string; name: string }[]>([]);
  const [pickUsers, setPickUsers] = useState<Set<string>>(new Set());

  useEffect(() => {
    Promise.all([
      api<CourseItem[]>("/courses"),
      api<ExamLite[]>("/exams"),
      api<PaperItem[]>("/papers/published"),
      api<FlatCategory[]>("/question-categories/flat"),
    ]).then(([c, e, p, f]) => {
      setCourses(c); setExams(e); setPapers(p); setFlatCategories(f);
    }).catch(() => { /* 加载失败时各区块自行降级为空态 */ });
  }, []);

  // 探测 AI 出题可用性（与试题管理页同一门控口径）
  useEffect(() => {
    api<{ enabled: boolean }>("/ai/status")
      .then(s => setAiEnabled(s.enabled))
      .catch(() => setAiEnabled(false));
  }, []);

  // 组织名册（选人数据源；单独降级，失败不影响其他区块）
  useEffect(() => {
    api<OrgMembersResponse>("/org/members")
      .then(org => setMembers([...org.members, ...org.unlinked_accounts]))
      .catch(() => setMembers([]));
  }, []);

  // 选中课程的存量分配（只读展示）
  useEffect(() => {
    if (!courseId) { setAssignedUsers([]); return; }
    api<{ users: { id: string; name: string }[] }>(`/courses/${courseId}/assignments`)
      .then(d => setAssignedUsers(d.users))
      .catch(() => setAssignedUsers([]));
  }, [courseId]);

  // ── 派生：总分 / 及格分 ──
  const allScoresSet = picked.length > 0 && picked.every((q) => q.score > 0);
  const fixedSum = picked.reduce((s, q) => s + q.score, 0);
  const randomSum = randRules.reduce((s, r) => s + r.count * (r.score || 0), 0);
  const selectedPaper = papers.find((p) => p.id === selectedPaperId) || null;

  const total =
    tab === "bank_fixed" ? (allScoresSet ? fixedSum : splitTarget) :
    tab === "bank_random" ? randomSum :
    selectedPaper?.total_score ?? 0;

  const passDefault = Math.max(1, Math.round(total * 0.6));
  const passScore = passInput.trim() === "" ? passDefault : (parseInt(passInput) || 0);

  // 选中的课程当前绑定的未结束考试（换绑提示）
  const boundExam = useMemo(
    () => exams.find((e) => e.course_id === courseId && e.status !== "ended") || null,
    [exams, courseId],
  );
  const selectedCourse = useMemo(
    () => courses.find((c) => c.id === courseId) || null,
    [courses, courseId],
  );

  const categoryDescendants = useMemo(() => buildDescendantMap(flatCategories), [flatCategories]);

  // 离开「选择内容」时按已选分类推荐课程
  const suggestCourse = () => {
    if (courseId) return;
    const anchorCat =
      tab === "bank_fixed" ? pickerCat :
      tab === "bank_random" ? (randBanks[0] ?? null) :
      null;
    if (!anchorCat) return;
    const desc = categoryDescendants.get(anchorCat);
    if (!desc) return;
    const match = courses.find((c) => c.category_id && desc.has(c.category_id));
    if (match) setCourseId(match.id);
  };

  const contentReady =
    tab === "bank_fixed" ? picked.length > 0 :
    tab === "bank_random" ? randRules.length > 0 && randRules.every((r) => r.score > 0) :
    !!selectedPaperId;

  const canNext = step === 0 ? title.trim() !== "" : step === 1 ? contentReady : !!courseId;

  const filteredPapers = useMemo(() => {
    const lower = paperSearch.trim().toLowerCase();
    return lower ? papers.filter((p) => p.title.toLowerCase().includes(lower)) : papers;
  }, [papers, paperSearch]);

  const handleCreate = async (publish: boolean) => {
    if (!title.trim()) { notify.error("请填写考试名称"); setStep(0); return; }
    if (!courseId) { notify.error("请选择关联课程"); setStep(2); return; }

    const content: Record<string, unknown> = tab === "paper"
      ? { source: "paper", paper_id: selectedPaperId }
      : tab === "bank_fixed"
        ? {
            source: "bank", paper_type: "fixed",
            questions: picked.map((q) => ({ question_id: q.question_id, score: allScoresSet ? q.score : 0 })),
            category_id: pickerCat,
          }
        : {
            source: "bank", paper_type: "random",
            random_rules: randRules,
            source_banks: randBanks.length ? randBanks : null,
          };

    const body: Record<string, unknown> = {
      title: title.trim(),
      course_id: courseId,
      content,
      duration,
      publish,
    };
    // 仅在需要时显式传分值：未逐题设分值 → 传平摊目标；及格分被手改过 → 传值
    if (tab === "bank_fixed" && !allScoresSet) body.total_score = splitTarget;
    if (passInput.trim() !== "") body.pass_score = passScore;
    if (maxAttempts.trim()) body.max_attempts = parseInt(maxAttempts);
    if (startTime) body.start_time = startTime;
    if (endTime) body.end_time = endTime;
    if (saveTemplate) body.save_paper_as = templateName.trim() || title.trim();
    if (pickUsers.size) body.assign_user_ids = [...pickUsers];

    setSaving(true);
    try {
      const res = await api<{ replaced_exam_title: string | null; saved_paper_id: string | null; assigned_new: number }>(
        "/exams/quick-create", { method: "POST", body: JSON.stringify(body) },
      );
      notify.success(publish ? `考试「${title.trim()}」已创建并发布` : "已保存为草稿");
      if (res.replaced_exam_title) {
        notify.info(`原绑定考试「${res.replaced_exam_title}」已自动置为已结束`);
      }
      if (res.assigned_new > 0) {
        notify.success(`已同步分配 ${res.assigned_new} 名学员到课程《${selectedCourse?.title || ""}》`);
      }
      onDone();
    } catch (e: unknown) {
      notify.error(e instanceof Error ? e.message : "创建失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/30 flex items-start justify-center pt-12 z-50" onClick={onClose}>
      <div className="bg-bg-base rounded-lg shadow-xl w-full max-w-5xl min-h-[62vh] max-h-[92vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        {/* 头部 + 步骤条 */}
        <div className="px-6 pt-4 pb-3 border-b border-border">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold text-lg">一键创建考试</h3>
            <button onClick={onClose} className="text-text-secondary hover:text-text-base text-xl leading-none">&times;</button>
          </div>
          <div className="flex items-center">
            {STEPS.map((label, i) => (
              <div key={label} className="flex items-center">
                {i > 0 && <div className={`w-10 h-px mx-2 ${i <= step ? "bg-primary" : "bg-border"}`} />}
                <div className={`flex items-center gap-1.5 text-sm ${i === step ? "text-primary font-bold" : i < step ? "text-primary" : "text-text-secondary"}`}>
                  <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs ${
                    i <= step ? "bg-primary text-white" : "bg-border text-text-secondary"
                  }`}>{i < step ? "✓" : i + 1}</span>
                  <span>{label}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 内容区 */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {/* ① 基本信息 */}
          {step === 0 && (
            <div className="max-w-lg space-y-4">
              <div>
                <label className="block text-sm text-text-secondary mb-1">考试名称 <span className="text-red-500">*</span></label>
                <input type="text" value={title} onChange={(e) => setTitle(e.target.value)}
                  placeholder="如：10月安全生产考试" autoFocus
                  className="w-full border border-border rounded-md px-3 py-2 text-sm" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-text-secondary mb-1">考试时长（分钟）</label>
                  <input type="number" min={1} value={duration || ""} onChange={(e) => setDuration(parseInt(e.target.value) || 0)}
                    className="w-full border border-border rounded-md px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-sm text-text-secondary mb-1">最大考试次数</label>
                  <input type="number" min={1} value={maxAttempts} onChange={(e) => setMaxAttempts(e.target.value)}
                    placeholder="不限" className="w-full border border-border rounded-md px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-sm text-text-secondary mb-1">开放时间（留空=立即开放）</label>
                  <input type="datetime-local" value={startTime} onChange={(e) => setStartTime(e.target.value)}
                    className="w-full border border-border rounded-md px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-sm text-text-secondary mb-1">截止时间（留空=不限）</label>
                  <input type="datetime-local" value={endTime} onChange={(e) => setEndTime(e.target.value)}
                    className="w-full border border-border rounded-md px-3 py-2 text-sm" />
                </div>
              </div>
              <p className="text-xs text-text-secondary">
                及格分默认按总分 60% 自动计算，下一步选完题后可在确认页调整。
              </p>
            </div>
          )}

          {/* ② 选择内容 */}
          {step === 1 && (
            <div>
              <div className="flex items-center gap-1 mb-4 border-b border-border">
                {TABS.map((t) => (
                  <button key={t.key} onClick={() => setTab(t.key)}
                    className={`px-4 py-2 text-sm border-b-2 -mb-px transition-colors ${
                      tab === t.key ? "border-primary text-primary font-medium" : "border-transparent text-text-secondary hover:text-text-base"
                    }`}>{t.label}</button>
                ))}
                <div className="ml-auto mb-1 flex items-center gap-2">
                  <button
                    onClick={() => aiEnabled && setShowAI(true)}
                    disabled={!aiEnabled}
                    title={aiEnabled ? "按主题关键词 AI 生成题目草稿，人工审核后入库" : "AI 功能未启用：服务端未配置 LLM_API_KEY"}
                    className={`px-2.5 py-1 text-xs border border-border rounded-md ${aiEnabled ? "hover:bg-bg-layout" : "opacity-50 cursor-not-allowed"}`}
                  >
                    AI 出题
                  </button>
                  <button onClick={() => setShowImport(true)}
                    className="px-2.5 py-1 text-xs border border-border rounded-md hover:bg-bg-layout">
                    Excel 导入
                  </button>
                  <Link to="/admin/question-bank" className="text-xs text-text-secondary hover:text-primary">
                    单题新增 →
                  </Link>
                </div>
              </div>

              {tab === "bank_fixed" && (
                <QuestionPickerPanel
                  refreshKey={pickerRefreshKey}
                  onChange={(cat, items) => { setPickerCat(cat); setPicked(items); }}
                />
              )}
              {tab === "bank_random" && (
                <RandomRulesPanel onChange={(banks, rules) => { setRandBanks(banks); setRandRules(rules); }} />
              )}
              {tab === "paper" && (
                <div>
                  <input type="text" placeholder="搜索试卷..." value={paperSearch} onChange={(e) => setPaperSearch(e.target.value)}
                    className="w-64 border border-border rounded-md px-3 py-1.5 text-sm mb-3" />
                  {filteredPapers.length === 0 ? (
                    <p className="text-sm text-text-secondary py-8 text-center">
                      {papers.length === 0 ? "暂无已发布试卷，可先用左侧前两个方式从题库组卷" : "无匹配试卷"}
                    </p>
                  ) : (
                    <div className="space-y-1 max-h-[44vh] overflow-y-auto">
                      {filteredPapers.map((p) => (
                        <label key={p.id}
                          className={`flex items-center gap-3 px-3 py-2.5 rounded-md cursor-pointer border transition-colors ${
                            selectedPaperId === p.id ? "border-primary bg-primary/5" : "border-transparent hover:bg-bg-layout"
                          }`}>
                          <input type="radio" name="quick_paper" checked={selectedPaperId === p.id}
                            onChange={() => setSelectedPaperId(p.id)} className="shrink-0" />
                          <span className="flex-1 min-w-0 text-sm font-medium truncate">{p.title}</span>
                          <span className="text-xs text-text-secondary shrink-0">{p.paper_type === "fixed" ? "固定" : "随机"}</span>
                          <span className="text-xs text-text-secondary shrink-0 w-14 text-right">{p.total_score}分</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* 未逐题设分值时的平摊目标 */}
              {tab === "bank_fixed" && picked.length > 0 && !allScoresSet && (
                <div className="mt-3 flex items-center gap-2 text-xs text-text-secondary">
                  <span>{picked.filter((q) => q.score <= 0).length} 题未设分值，将按目标总分自动平摊：</span>
                  <input type="number" min={picked.length} value={splitTarget || ""}
                    onChange={(e) => setSplitTarget(parseInt(e.target.value) || 0)}
                    className="w-16 border border-border rounded-md px-2 py-1 text-center" />
                  <span>分（不少于题数 {picked.length}）</span>
                </div>
              )}
            </div>
          )}

          {/* ③ 确认发布 */}
          {step === 2 && (
            <div className="max-w-2xl space-y-4">
              <div className="max-w-lg space-y-4">
                <div>
                  <label className="block text-sm text-text-secondary mb-1">关联课程 <span className="text-red-500">*</span></label>
                  {courses.length === 0 ? (
                    <p className="text-sm text-red-500">
                      还没有课程。请先在 <Link to="/admin/courses" className="underline">课程管理</Link> 创建课程。
                    </p>
                  ) : (
                    <>
                      <select value={courseId} onChange={(e) => setCourseId(e.target.value)}
                        className="w-full border border-border rounded-md px-3 py-2 text-sm">
                        <option value="">选择课程</option>
                        {courses.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
                      </select>
                      <p className="text-xs text-text-secondary mt-1">
                        考生 = 被分配到该课程的学员。可在下方直接选人，或{' '}
                        <Link to="/admin/courses" className="text-primary hover:underline">课程管理 → 分配</Link>。
                      </p>
                    </>
                  )}
                  {boundExam && (
                    <p className="text-xs text-amber-600 mt-1.5">
                      ⚠ 该课程当前绑定考试《{boundExam.title}》，创建新考试后它将自动置为「已结束」。
                    </p>
                  )}
                </div>

                <div className="grid grid-cols-3 gap-3 text-sm">
                  <div className="border border-border rounded-md px-3 py-2 bg-bg-layout/50">
                    <p className="text-xs text-text-secondary">总分</p>
                    <p className="font-bold">{total} 分</p>
                  </div>
                  <div>
                    <label className="block text-xs text-text-secondary mb-1">及格分</label>
                    <input type="number" min={1} max={total || undefined} value={passInput}
                      onChange={(e) => setPassInput(e.target.value)}
                      placeholder={`默认 ${passDefault}`}
                      className="w-full border border-border rounded-md px-2 py-1.5 text-sm" />
                  </div>
                  <div className="border border-border rounded-md px-3 py-2 bg-bg-layout/50">
                    <p className="text-xs text-text-secondary">内容来源</p>
                    <p className="font-bold truncate">
                      {tab === "bank_fixed" ? `题库选题 · ${picked.length} 题` :
                       tab === "bank_random" ? `随机 · ${randRules.length} 条规则` :
                       selectedPaper?.title || "-"}
                    </p>
                  </div>
                </div>

                <label className="flex items-start gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={saveTemplate} onChange={(e) => setSaveTemplate(e.target.checked)} className="mt-0.5" />
                  <span>
                    <span className="font-medium">同时保存为可复用试卷</span>
                    <span className="block text-xs text-text-secondary">存进试卷管理，下次可直接走「复用已有试卷」</span>
                  </span>
                </label>
                {saveTemplate && (
                  <input type="text" value={templateName} onChange={(e) => setTemplateName(e.target.value)}
                    placeholder={`试卷名（默认用考试名）`} className="w-full border border-border rounded-md px-3 py-2 text-sm" />
                )}
              </div>

              {/* 建考直接选人：选中人员随建考同时分配到课程（可见课程课件） */}
              {courseId && (
                <div className="border border-border rounded-md p-3">
                  <p className="text-sm font-medium mb-1">顺手分配学员（可选）</p>
                  <p className="text-xs text-text-secondary mb-2">
                    选中人员将同时被分配到课程《{selectedCourse?.title}》，可学习该课程课件
                  </p>
                  {assignedUsers.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5 mb-2">
                      <span className="text-xs text-text-secondary shrink-0 py-0.5">已分配 {assignedUsers.length} 人：</span>
                      {assignedUsers.slice(0, 8).map((u) => (
                        <span key={u.id} className="px-2 py-0.5 bg-bg-layout rounded text-xs">{u.name}</span>
                      ))}
                      {assignedUsers.length > 8 && (
                        <span className="text-xs text-text-secondary/70 py-0.5">…等 {assignedUsers.length} 人</span>
                      )}
                    </div>
                  )}
                  <DeptUserPicker
                    members={members}
                    selectedUsers={pickUsers}
                    onChange={setPickUsers}
                    listClass="max-h-40"
                  />
                </div>
              )}
            </div>
          )}
        </div>

        {/* 底部按钮（子弹窗打开期间禁用，防止穿透点步） */}
        <div className="px-6 py-3.5 border-t border-border flex items-center justify-between">
          <div>
            {step > 0 && (
              <button onClick={() => setStep(step - 1)} disabled={saving || showAI || showImport}
                className="px-4 py-2 rounded-md text-sm border border-border hover:bg-bg-layout disabled:opacity-50">
                上一步
              </button>
            )}
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-text-secondary mr-1">
              {step === 1 && total > 0 && <>当前合计 <b className="text-primary">{total}</b> 分</>}
            </span>
            {step < 2 ? (
              <button onClick={() => { if (step === 1) suggestCourse(); setStep(step + 1); }} disabled={!canNext || showAI || showImport}
                className="px-4 py-2 rounded-md text-sm bg-primary text-white hover:bg-primary-light disabled:opacity-50">
                下一步
              </button>
            ) : (
              <>
                <button onClick={() => handleCreate(false)} disabled={saving || !canNext || showAI || showImport}
                  className="px-4 py-2 rounded-md text-sm border border-border hover:bg-bg-layout disabled:opacity-50">
                  {saving ? "提交中..." : "存草稿"}
                </button>
                <button onClick={() => handleCreate(true)} disabled={saving || !canNext || showAI || showImport}
                  className="px-4 py-2 rounded-md text-sm bg-primary text-white hover:bg-primary-light disabled:opacity-50">
                  {saving ? "提交中..." : "创建并发布"}
                </button>
              </>
            )}
          </div>
        </div>

        {/* 就地补题弹窗：挂在面板内（面板已 stopPropagation），点击子弹窗遮罩只关子弹窗、不误关向导 */}
        {showAI && (
          <AIGenerateModal
            onClose={() => setShowAI(false)}
            onDone={() => setPickerRefreshKey((k) => k + 1)}
            defaultCategoryId={pickerCat}
            categories={flatCategories}
          />
        )}
        {showImport && (
          <ImportQuestionsModal
            categoryId={pickerCat}
            onClose={() => setShowImport(false)}
            onDone={() => setPickerRefreshKey((k) => k + 1)}
          />
        )}
      </div>
    </div>
  );
}
