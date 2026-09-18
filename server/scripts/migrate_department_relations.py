"""历史数据迁移：将 User 表中已有的 department 文本同步到 Department 树

用法：
    cd server && source .venv/bin/activate && python3 scripts/migrate_department_relations.py

功能：
    1. 遍历所有 User，找出 department 有值但 department_id 为空的记录
    2. 将 department 文本解析为路径，同步到 Department 树
    3. 更新 User.department_id 指向叶子节点
"""

import sys
import os

# 将项目根目录加入 sys.path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.database import SessionLocal, engine
from app.models.user import User
from app.models.department import Department
from app.services.department_sync import ensure_department_path
from sqlalchemy import text


def has_column(table: str, column: str) -> bool:
    """检查列是否存在（兼容 MySQL / SQLite）"""
    try:
        with engine.connect() as conn:
            result = conn.execute(
                text(f"SELECT {column} FROM {table} LIMIT 0")
            )
            return True
    except Exception:
        return False


def main():
    print("=" * 60)
    print("历史用户部门关系迁移")
    print("=" * 60)

    if not has_column("users", "department_id"):
        print("[错误] users.department_id 列不存在，请先运行 alembic upgrade head")
        sys.exit(1)

    db = SessionLocal()
    try:
        users = db.query(User).filter(
            User.department.isnot(None),
            User.department != "",
            User.department_id.is_(None),
        ).all()

        if not users:
            print("没有需要迁移的用户（所有用户已有 department_id 或无 department 字段）")
            return

        print(f"待迁移用户数: {len(users)}")
        updated_count = 0
        skipped_count = 0

        for user in users:
            dept_text = user.department.strip() if user.department else ""
            if not dept_text:
                skipped_count += 1
                continue

            # 跳过纯数字（可能是未解析的 OA 部门 ID）
            if dept_text.isdigit():
                print(f"  [跳过] {user.name}: department=\"{dept_text}\" 是原始 OA ID，跳过")
                skipped_count += 1
                continue

            leaf = ensure_department_path(db, dept_text)
            if leaf:
                user.department_id = leaf.id
                db.flush()
                updated_count += 1

                # 构建路径用于显示
                parts = []
                cur = leaf
                while cur:
                    parts.insert(0, cur.name)
                    cur = db.query(Department).filter(
                        Department.id == cur.parent_id
                    ).first() if cur.parent_id else None
                full_path = "-".join(parts)
                print(f"  [OK] {user.name}: \"{dept_text}\" → {full_path} (id={leaf.id[:8]}...)")
            else:
                print(f"  [跳过] {user.name}: \"{dept_text}\" 解析失败")
                skipped_count += 1

        db.commit()
        print()
        print(f"迁移完成：成功 {updated_count}，跳过 {skipped_count}")
        print("=" * 60)

    except Exception as e:
        db.rollback()
        print(f"[错误] 迁移失败: {e}")
        sys.exit(1)
    finally:
        db.close()


if __name__ == "__main__":
    main()