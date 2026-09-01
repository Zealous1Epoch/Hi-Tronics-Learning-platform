import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "../../lib/api";

interface UserItem {
  id: string; name: string; department: string | null;
}
interface DeptItem {
  id: string; name: string;
}
interface CourseInfo {
  id: string; title: string;
}

export default function CourseAssign() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [course, setCourse] = useState<CourseInfo | null>(null);
  const [allUsers, setAllUsers] = useState<UserItem[]>([]);
  const [allDepts, setAllDepts] = useState<DeptItem[]>([]);
  const [assignedUsers, setAssignedUsers] = useState<UserItem[]>([]);
  const [assignedDepts, setAssignedDepts] = useState<DeptItem[]>([]);
  const [selectedUsers, setSelectedUsers] = useState<Set<string>>(new Set());
  const [selectedDepts, setSelectedDepts] = useState<Set<string>>(new Set());
  const [userSearch, setUserSearch] = useState("");
  const [deptSearch, setDeptSearch] = useState("");
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    const [courseData, users, depts, assignments] = await Promise.all([
      api<CourseInfo>(`/courses/${id}`),
      api<UserItem[]>("/users"),
      api<DeptItem[]>("/departments?flat=true"),
      api<{ users: UserItem[]; departments: DeptItem[] }>(`/courses/${id}/assignments`),
    ]);
    setCourse(courseData);
    setAllUsers(users);
    setAllDepts(flattenDepts(depts));
    setAssignedUsers(assignments.users);
    setAssignedDepts(assignments.departments);
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, [id]);

  const flattenDepts = (depts: any[]): DeptItem[] => {
    return depts.flatMap((d: any) => [
      { id: d.id, name: d.name },
      ...flattenDepts(d.children || []),
    ]);
  };

  const toggleUser = (uid: string) => {
    const next = new Set(selectedUsers);
    next.has(uid) ? next.delete(uid) : next.add(uid);
    setSelectedUsers(next);
  };

  const toggleDept = (did: string) => {
    const next = new Set(selectedDepts);
    next.has(did) ? next.delete(did) : next.add(did);
    setSelectedDepts(next);
  };

  const handleAssign = async () => {
    await api(`/courses/${id}/assignments`, {
      method: "POST",
      body: JSON.stringify({
        user_ids: [...selectedUsers],
        department_ids: [...selectedDepts],
      }),
    });
    setSelectedUsers(new Set());
    setSelectedDepts(new Set());
    fetchData();
  };

  const handleRemove = async (type: "user" | "dept", targetId: string) => {
    await api(`/courses/${id}/assignments`, {
      method: "DELETE",
      body: JSON.stringify(
        type === "user" ? { user_ids: [targetId], department_ids: [] }
                        : { user_ids: [], department_ids: [targetId] },
      ),
    });
    fetchData();
  };

  const filteredUsers = allUsers.filter((u) =>
    u.name.includes(userSearch) || (u.department && u.department.includes(userSearch))
  );
  const filteredDepts = allDepts.filter((d) => d.name.includes(deptSearch));

  if (loading) return <p className="text-text-secondary">加载中...</p>;

  return (
    <div>
      <h2 className="text-xl font-bold text-primary mb-4">
        分配课程: {course?.title}
      </h2>
      <div className="grid grid-cols-2 gap-6">
        {/* 人员选择 */}
        <div className="bg-bg-base rounded-lg border border-border p-4">
          <h3 className="font-bold text-sm mb-3">选择学员</h3>
          <input
            type="text" placeholder="搜索姓名/部门..."
            value={userSearch} onChange={(e) => setUserSearch(e.target.value)}
            className="w-full border border-border rounded-md px-3 py-1.5 text-sm mb-3"
          />
          <div className="max-h-64 overflow-y-auto space-y-1 mb-3">
            {filteredUsers.map((u) => (
              <label key={u.id} className="flex items-center gap-2 py-1 px-2 hover:bg-bg-layout rounded text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={selectedUsers.has(u.id)}
                  onChange={() => toggleUser(u.id)}
                />
                <span>{u.name}</span>
                {u.department && <span className="text-text-secondary text-xs">({u.department})</span>}
              </label>
            ))}
          </div>
          <button
            onClick={handleAssign}
            disabled={selectedUsers.size === 0 && selectedDepts.size === 0}
            className="bg-primary text-white px-4 py-2 rounded-md text-sm disabled:opacity-50"
          >
            分配选中 ({selectedUsers.size + selectedDepts.size})
          </button>
        </div>

        {/* 部门选择 */}
        <div className="bg-bg-base rounded-lg border border-border p-4">
          <h3 className="font-bold text-sm mb-3">选择部门</h3>
          <input
            type="text" placeholder="搜索部门..."
            value={deptSearch} onChange={(e) => setDeptSearch(e.target.value)}
            className="w-full border border-border rounded-md px-3 py-1.5 text-sm mb-3"
          />
          <div className="max-h-64 overflow-y-auto space-y-1 mb-3">
            {filteredDepts.map((d) => (
              <label key={d.id} className="flex items-center gap-2 py-1 px-2 hover:bg-bg-layout rounded text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={selectedDepts.has(d.id)}
                  onChange={() => toggleDept(d.id)}
                />
                <span>{d.name}</span>
              </label>
            ))}
          </div>
        </div>
      </div>

      {/* 已分配 */}
      <div className="mt-6 bg-bg-base rounded-lg border border-border p-4">
        <h3 className="font-bold text-sm mb-3">已分配</h3>
        {assignedUsers.length === 0 && assignedDepts.length === 0 ? (
          <p className="text-sm text-text-secondary">暂无分配</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {assignedUsers.map((u) => (
              <span key={u.id} className="inline-flex items-center gap-1 px-2 py-1 bg-bg-layout rounded text-sm">
                {u.name}
                <button onClick={() => handleRemove("user", u.id)} className="text-red-400 hover:text-red-600">x</button>
              </span>
            ))}
            {assignedDepts.map((d) => (
              <span key={d.id} className="inline-flex items-center gap-1 px-2 py-1 bg-primary/10 text-primary rounded text-sm">
                {d.name}（部门）
                <button onClick={() => handleRemove("dept", d.id)} className="text-red-400 hover:text-red-600">x</button>
              </span>
            ))}
          </div>
        )}
      </div>

      <button onClick={() => navigate("/admin/courses")} className="mt-4 text-sm text-text-secondary hover:text-text-base">
        返回课程列表
      </button>
    </div>
  );
}