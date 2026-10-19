/** 部门树纯工具（从 DeptUserPicker 拆出，保持组件文件仅导出组件以兼容 Fast Refresh）
 *  行为与 CourseManage 旧实现逐一对应。
 */
import type { DeptNode } from "../../lib/courseApi";

export function findDeptNode(nodes: DeptNode[], id: string): DeptNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    if (node.children) {
      const found = findDeptNode(node.children, id);
      if (found) return found;
    }
  }
  return null;
}

export function collectDescendantNames(node: DeptNode): string[] {
  const names = [node.name];
  for (const child of node.children || []) {
    names.push(...collectDescendantNames(child));
  }
  return names;
}

/** 按名称找部门节点；用户 department 是 "A-B-C" 路径串时按段回退匹配 */
export function findDeptByName(nodes: DeptNode[], name: string | null): DeptNode | null {
  if (!name) return null;
  for (const node of nodes) {
    if (node.name === name) return node;
    if (node.children) {
      const found = findDeptByName(node.children, name);
      if (found) return found;
    }
  }
  const parts = name.split("-");
  for (const part of parts) {
    for (const node of nodes) {
      if (node.name === part) return node;
      if (node.children) {
        const found = findDeptByName(node.children, part);
        if (found) return found;
      }
    }
  }
  return null;
}

/** 用户部门串（可能是 "A-B" 路径）是否命中部门名 */
export function matchDept(userDept: string | null, deptName: string): boolean {
  return userDept === deptName || (userDept || "").split("-").includes(deptName);
}

export function filterDeptTree(nodes: DeptNode[], term: string): DeptNode[] {
  if (!term) return nodes;
  const lower = term.toLowerCase();
  const result: DeptNode[] = [];
  for (const node of nodes) {
    const filteredChildren = node.children ? filterDeptTree(node.children, term) : [];
    if (node.name.toLowerCase().includes(lower) || filteredChildren.length > 0) {
      result.push({ ...node, children: filteredChildren });
    }
  }
  return result;
}
