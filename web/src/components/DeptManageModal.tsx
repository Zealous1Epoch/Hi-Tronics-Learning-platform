import { useState } from "react";
import DepartmentTree from "./DepartmentTree";

interface DeptManageModalProps {
  open: boolean;
  onClose: () => void;
}

/**
 * 平台部门管理弹窗：现有 DepartmentTree（editable）的薄包装，
 * 增/改名/删能力零改动迁移。管理的是平台 departments 表
 * （账号归属 + 课程可见性体系），与全员名册镜像无关。
 */
export default function DeptManageModal({ open, onClose }: DeptManageModalProps) {
  const [selId, setSelId] = useState<string | null>(null);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div className="bg-bg-base rounded-lg shadow-xl w-full max-w-md mx-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h3 className="font-bold text-sm">平台部门管理</h3>
          <button onClick={onClose} className="text-text-secondary hover:text-text-base">
            <span className="text-lg">&times;</span>
          </button>
        </div>
        <div className="p-5 max-h-[70vh] overflow-y-auto">
          <p className="text-xs text-text-secondary mb-3">
            管理部门树用于账号归属与课程可见性范围，与全员名册（组织架构镜像）相互独立。
          </p>
          <DepartmentTree
            selectedId={selId}
            onSelect={setSelId}
            editable
            allLabel="（点选部门后可改名/添加子部门/删除）"
          />
        </div>
        <div className="flex justify-end px-5 py-4 border-t border-border">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-md text-sm border border-border text-text-secondary hover:text-text-base"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
