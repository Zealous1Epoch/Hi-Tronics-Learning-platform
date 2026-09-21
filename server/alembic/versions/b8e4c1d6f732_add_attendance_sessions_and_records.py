"""线下面授课程签到场次与签到记录

- courses 增加 course_type（online / offline），存量课程默认 online，行为不变
- 新建 attendance_sessions（签到场次）与 attendance_records（签到记录）

Revision ID: b8e4c1d6f732
Revises: a7d3f5b92c14
Create Date: 2026-09-20 15:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'b8e4c1d6f732'
down_revision: Union[str, None] = 'a7d3f5b92c14'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _table_exists(table: str) -> bool:
    conn = op.get_bind()
    return bool(conn.execute(
        sa.text(
            "SELECT COUNT(*) FROM information_schema.TABLES "
            "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t"
        ),
        {"t": table},
    ).scalar())


def _column_exists(table: str, column: str) -> bool:
    conn = op.get_bind()
    return bool(conn.execute(
        sa.text(
            "SELECT COUNT(*) FROM information_schema.COLUMNS "
            "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t AND COLUMN_NAME = :c"
        ),
        {"t": table, "c": column},
    ).scalar())


def _index_exists(table: str, index: str) -> bool:
    conn = op.get_bind()
    return bool(conn.execute(
        sa.text(
            "SELECT COUNT(*) FROM information_schema.STATISTICS "
            "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t AND INDEX_NAME = :i"
        ),
        {"t": table, "i": index},
    ).scalar())


def upgrade() -> None:
    # ── 1) courses.course_type ──
    if not _column_exists("courses", "course_type"):
        op.add_column(
            "courses",
            sa.Column(
                "course_type", sa.String(20), nullable=False,
                server_default="online", comment="online / offline",
            ),
        )
        # 存量课程全部标记为线上，保证原有「看视频→考试」流程不受影响
        op.execute("UPDATE courses SET course_type = 'online' WHERE course_type IS NULL")
    if not _index_exists("courses", "ix_courses_course_type"):
        op.create_index("ix_courses_course_type", "courses", ["course_type"])

    # ── 2) attendance_sessions ──
    if not _table_exists("attendance_sessions"):
        op.create_table(
            "attendance_sessions",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("course_id", sa.String(36), sa.ForeignKey("courses.id"), nullable=False),
            sa.Column("title", sa.String(200), nullable=False),
            sa.Column("start_time", sa.DateTime(), nullable=False),
            sa.Column("end_time", sa.DateTime(), nullable=False),
            sa.Column("late_after_minutes", sa.Integer(), nullable=True),
            sa.Column("location_name", sa.String(200), nullable=True),
            sa.Column("latitude", sa.Float(), nullable=True),
            sa.Column("longitude", sa.Float(), nullable=True),
            sa.Column("radius_m", sa.Integer(), nullable=False, server_default="200"),
            sa.Column("ip_allowlist", sa.JSON(), nullable=True),
            sa.Column("require_network", sa.Boolean(), nullable=False, server_default=sa.text("0")),
            sa.Column("require_geofence", sa.Boolean(), nullable=False, server_default=sa.text("0")),
            sa.Column("dedupe_device", sa.Boolean(), nullable=False, server_default=sa.text("0")),
            sa.Column("code_rotate_seconds", sa.Integer(), nullable=False, server_default="30"),
            sa.Column("remark", sa.Text(), nullable=True),
            sa.Column("created_by", sa.String(36), nullable=True),
            sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now()),
            comment="线下面授签到场次",
        )
        op.create_index("ix_attendance_sessions_course_id", "attendance_sessions", ["course_id"])
        op.create_index(
            "ix_attendance_sessions_course_start", "attendance_sessions", ["course_id", "start_time"]
        )

    # ── 3) attendance_records ──
    if not _table_exists("attendance_records"):
        op.create_table(
            "attendance_records",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column(
                "session_id", sa.String(36),
                sa.ForeignKey("attendance_sessions.id"), nullable=False,
            ),
            sa.Column("course_id", sa.String(36), sa.ForeignKey("courses.id"), nullable=False),
            sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
            sa.Column("status", sa.String(20), nullable=False, server_default="present"),
            sa.Column("source", sa.String(20), nullable=False, server_default="code"),
            sa.Column("checked_in_at", sa.DateTime(), nullable=False),
            sa.Column("client_ip", sa.String(64), nullable=True),
            sa.Column("user_agent", sa.String(500), nullable=True),
            sa.Column("device_id", sa.String(64), nullable=True),
            sa.Column("latitude", sa.Float(), nullable=True),
            sa.Column("longitude", sa.Float(), nullable=True),
            sa.Column("distance_m", sa.Float(), nullable=True),
            sa.Column("risk_flags", sa.JSON(), nullable=True),
            sa.Column("evidence", sa.JSON(), nullable=True),
            sa.Column("operator_id", sa.String(36), nullable=True),
            sa.Column("remark", sa.String(500), nullable=True),
            sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
            sa.UniqueConstraint("session_id", "user_id", name="uq_attendance_session_user"),
            comment="线下面授签到记录",
        )
        op.create_index("ix_attendance_records_session_id", "attendance_records", ["session_id"])
        op.create_index("ix_attendance_records_course_id", "attendance_records", ["course_id"])
        op.create_index("ix_attendance_records_user_id", "attendance_records", ["user_id"])
        op.create_index("ix_attendance_records_status", "attendance_records", ["status"])
        op.create_index("ix_attendance_records_device_id", "attendance_records", ["device_id"])
        op.create_index(
            "ix_attendance_records_course_user", "attendance_records", ["course_id", "user_id"]
        )


def downgrade() -> None:
    if _table_exists("attendance_records"):
        op.drop_table("attendance_records")
    if _table_exists("attendance_sessions"):
        op.drop_table("attendance_sessions")
    if _index_exists("courses", "ix_courses_course_type"):
        op.drop_index("ix_courses_course_type", table_name="courses")
    if _column_exists("courses", "course_type"):
        op.drop_column("courses", "course_type")
