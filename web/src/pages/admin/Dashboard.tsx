export default function AdminDashboard() {
  return (
    <div>
      <h2 className="text-xl font-bold text-primary mb-4">管理后台首页</h2>
      <div className="grid grid-cols-4 gap-4 mb-6">
        {["总学员", "总课程", "进行中", "已完成"].map((label) => (
          <div key={label} className="bg-bg-base rounded-lg p-4 border border-border text-center">
            <div className="text-2xl font-bold text-primary">0</div>
            <div className="text-sm text-text-secondary">{label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}