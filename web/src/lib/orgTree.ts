// 全员名册部门树派生纯函数（数据源：org_members 镜像的 dept_path，'>' 分隔）
// 思路移植自招聘系统 orgLayout.ts / orgBands.ts，右侧改为平铺列表后仅保留
// 建树、子树过滤、直属过滤、祖先链四个能力。

import type { OrgMemberRow } from "./api";

export const COMPANY_KEY = "__company__";
export const UNASSIGNED_KEY = "__unassigned__";

export interface OrgTreeNode {
  key: string; // 部门路径前缀（如 生产部>闽侯厂区），或特殊节点常量
  label: string;
  kind: "company" | "dept" | "unassigned";
  total: number; // 子树累计人数（含下级部门）
  direct: number; // 本部门直属人数
  children: OrgTreeNode[];
}

/** 一级部门排序（与招聘系统组织架构页保持一致的管理口径） */
export const TOP_DEPT_ORDER = [
  "总裁办公室",
  "董事会办公室",
  "研发部",
  "PLM办公室",
  "财务部",
  "工程研发部",
  "行政人事部",
  "IT部",
  "采购部",
  "计划物流部",
  "品保部",
  "内审部",
  "生产部",
  "市场销售部",
  "经营效率办公室",
  "NPI",
];

/** 归一化部门路径：各分段去首尾空白、丢弃空段后用 '>' 重拼（建树与过滤共用同一口径） */
const norm = (m: OrgMemberRow): string =>
  (m.dept_path || "")
    .split(">")
    .map(s => s.trim())
    .filter(Boolean)
    .join(">");

/** 从全员平铺列表派生「全公司」根节点（含完整子树、人数徽标） */
export function buildCompanyTree(members: OrgMemberRow[]): OrgTreeNode {
  const root: OrgTreeNode = {
    key: COMPANY_KEY,
    label: "全公司",
    kind: "company",
    total: members.length,
    direct: 0,
    children: [],
  };
  const deptIndex = new Map<string, OrgTreeNode>([["", root]]);
  const prefixCount = new Map<string, number>();

  for (const m of members) {
    const path = norm(m);
    if (!path) {
      // 无部门 → 挂「未分配部门」虚拟节点
      let un = deptIndex.get(UNASSIGNED_KEY);
      if (!un) {
        un = { key: UNASSIGNED_KEY, label: "未分配部门", kind: "unassigned", total: 0, direct: 0, children: [] };
        deptIndex.set(UNASSIGNED_KEY, un);
        root.children.push(un);
      }
      un.total += 1;
      un.direct += 1;
      continue;
    }
    // 逐级 find-or-create，累计各前缀的子树人数
    const parts = path.split(">").map(s => s.trim()).filter(Boolean);
    let parent = root;
    let acc = "";
    for (const seg of parts) {
      acc = acc ? `${acc}>${seg}` : seg;
      let node = deptIndex.get(acc);
      if (!node) {
        node = { key: acc, label: seg, kind: "dept", total: 0, direct: 0, children: [] };
        deptIndex.set(acc, node);
        parent.children.push(node);
      }
      node.total += 1;
      parent = node;
    }
    prefixCount.set(acc, (prefixCount.get(acc) || 0) + 1);
  }

  // 直属人数 = 精确等于该路径的人数
  for (const [pathKey, count] of prefixCount) {
    const node = deptIndex.get(pathKey);
    if (node) node.direct = count;
  }

  const rank = new Map(TOP_DEPT_ORDER.map((d, i) => [d, i]));
  const sortChildren = (node: OrgTreeNode): void => {
    node.children.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "unassigned" ? 1 : b.kind === "unassigned" ? -1 : 0;
      if (node.kind === "company" && a.kind === "dept") {
        const ra = rank.has(a.label) ? rank.get(a.label)! : TOP_DEPT_ORDER.length;
        const rb = rank.has(b.label) ? rank.get(b.label)! : TOP_DEPT_ORDER.length;
        if (ra !== rb) return ra - rb;
      }
      return b.total - a.total || a.label.localeCompare(b.label, "zh-Hans-CN");
    });
    node.children.forEach(sortChildren);
  };
  sortChildren(root);
  return root;
}

/** key 属于该节点的子树（含自身直属）：前缀匹配 */
export function inSubtree(m: OrgMemberRow, key: string): boolean {
  if (key === COMPANY_KEY) return true;
  if (key === UNASSIGNED_KEY) return !norm(m);
  const path = norm(m);
  return path === key || path.startsWith(key + ">");
}

/** key 为该节点的直属成员（不含下级部门） */
export function isDirectOf(m: OrgMemberRow, key: string): boolean {
  if (key === COMPANY_KEY) return true;
  if (key === UNASSIGNED_KEY) return !norm(m);
  return norm(m) === key;
}

/** 求 key 的祖先链（含自身），用于面包屑与选中时自动展开 */
export function findKeyPath(tree: OrgTreeNode, key: string): OrgTreeNode[] {
  if (key === COMPANY_KEY) return [tree];
  const dfs = (node: OrgTreeNode, acc: OrgTreeNode[]): OrgTreeNode[] | null => {
    const next = [...acc, node];
    if (node.key === key) return next;
    for (const child of node.children) {
      const hit = dfs(child, next);
      if (hit) return hit;
    }
    return null;
  };
  return dfs(tree, []) ?? [tree];
}
