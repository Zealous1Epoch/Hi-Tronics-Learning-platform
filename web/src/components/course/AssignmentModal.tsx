/** 分配学员轻量弹窗（课程管理重构 S4，替代 CourseManage :1595-1767 的第二份选择器复制）
 *
 * 与编辑页 Tab3 的差别只在保存时机：本弹窗「即时保存」——
 * 点「分配选中」立即 POST（增量幂等），已分配 chips 点 × 立即 DELETE。
 * 移除部门时按部门名连带移除成员（与后端课程分配级联口径一致，沿用旧实现）。
 */
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import DeptUserPicker from "./DeptUserPicker";
import { findDeptNode } from "./deptTreeUtils";
import {
  getAssignments, listAllUsers, listDepartments, postAssignments, removeAssignments,
  type DeptNode, type UserRow,
} from "../../lib/courseApi";
import { useToast } from "../ui/Toast";

interface AssignmentModalProps {
  /** 非空即打开 */
  course: { id: string; title: string } | null;
  onClose: () => void;
  /** 分配关系有变化时回调（列表页据此刷新「已分配学员数」） */
  onChanged?: () => void;
}

export default function AssignmentModal({ course, onClose, onChanged }: AssignmentModalProps) {
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [allUsers, setAllUsers] = useState<UserRow[]>([]);
  const [allDepts, setAllDepts] = useState<DeptNode[]>([]);
  const [assignedUsers, setAssignedUsers] = useState<UserRow[]>([]);
  const [assignedDepts, setAssignedDepts] = useState<DeptNode[]>([]);
  const [selectedUsers, setSelectedUsers] = useState<Set<string>>(new Set());
  const [selectedDepts, setSelectedDepts] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!course) return;
    let cancelled = false;
    setLoading(true);
    setSelectedUsers(new Set());
    setSelectedDepts(new Set());
    Promise.all([listAllUsers(), listDepartments(), getAssignments(course.id)])
      .then(([users, depts, assignments]) => {
        if (cancelled) return;
        setAllUsers(users);
        setAllDepts(depts);
        setAssignedUsers(assignments.users);
        setAssignedDepts(assignments.departments);
      })
      .catch(e => { if (!cancelled) toast.error(`加载分配信息失败：${e.message || e}`); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [course?.id]);

  if (!course) return null;

  const reloadAssignments = async (courseId: string) => {
    const assignments = await getAssignments(courseId);
    setAssignedUsers(assignments.users);
    setAssignedDepts(assignments.departments);
    onChanged?.();
  };

  const handleAssign = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await postAssignments(course.id, {
        user_ids: [...selectedUsers],
        department_ids: [...selectedDepts],
      });
      setSelectedUsers(new Set());
      setSelectedDepts(new Set());
      await reloadAssignments(course.id);
      toast.success("分配成功");
    } catch (e: any) {
      toast.error(`分配失败：${e.message || e}`);
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (type: "user" | "dept", targetId: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const body: { user_ids: string[]; department_ids: string[] } = { user_ids: [], department_ids: [] };
      if (type === "user") {
        body.user_ids = [targetId];
      } else {
        body.department_ids = [targetId];
        const deptName = findDeptNode(allDepts, targetId)?.name;
        if (deptName) {
          body.user_ids = assignedUsers.filter(u => u.department === deptName).map(u => u.id);
        }
      }
      await removeAssignments(course.id, body);
      await reloadAssignments(course.id);
    } catch (e: any) {
      toast.error(`移除失败：${e.message || e}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="k-overlay" onClick={onClose}>
      <div className="k-modal w-full max-w-3xl max-h-[85vh] overflow-y-auto k-scroll" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="k-title" style={{ fontSize: 15 }}>分配课程 · {course.title}</h3>
          <button onClick={onClose} className="text-text-secondary hover:text-text-base"><X size={18} /></button>
        </div>
        {loading ? (
          <p className="text-sm text-text-secondary py-10 text-center">加载中…</p>
        ) : (
          <>
            <DeptUserPicker
              allUsers={allUsers}
              allDepts={allDepts}
              selectedUsers={selectedUsers}
              selectedDepts={selectedDepts}
              onChange={({ users, depts }) => { setSelectedUsers(users); setSelectedDepts(depts); }}
              listClass="max-h-52"
            />
            <button
              onClick={handleAssign}
              disabled={busy || (selectedUsers.size === 0 && selectedDepts.size === 0)}
              className="k-btn k-btn-primary mt-3"
            >
              分配选中（{selectedDepts.size + selectedUsers.size}）
            </button>

            <div className="mt-4">
              <h4 className="text-sm font-medium mb-2">已分配</h4>
              {assignedUsers.length === 0 && assignedDepts.length === 0 ? (
                <p className="text-sm text-text-secondary">暂无分配</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {assignedDepts.map(d => (
                    <span key={d.id} className="inline-flex items-center gap-1 px-2 py-1 bg-primary/10 text-primary rounded text-sm">
                      {d.name}（部门）
                      <button onClick={() => handleRemove("dept", d.id)} disabled={busy}
                        className="text-red-400 hover:text-red-600 border border-red-200 rounded px-1 hover:bg-red-50">×</button>
                    </span>
                  ))}
                  {assignedUsers.map(u => (
                    <span key={u.id} className="inline-flex items-center gap-1 px-2 py-1 bg-bg-layout rounded text-sm">
                      {u.name}
                      <button onClick={() => handleRemove("user", u.id)} disabled={busy}
                        className="text-red-400 hover:text-red-600 border border-red-200 rounded px-1 hover:bg-red-50">×</button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
