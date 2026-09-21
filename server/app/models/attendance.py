"""线下课程签到场次与签到记录模型。

设计要点：
- 动态签到码**不落库**：用 `HMAC(secret, session_id:时间槽)` 无状态签发/校验，
  避免每 30 秒写一次数据库（实现见 services/attendance_service.py）。
- `attendance_records` 上有 UNIQUE(session_id, user_id)，
  由数据库兜住并发重复签到，而不是只靠应用层「先查再插」。
- 防代签能力做成**场次级开关**（默认关闭，不影响体验）：
  `require_network` / `require_geofence` / `dedupe_device`，
  需要收紧时改配置即可，无需改代码或数据库结构。
"""

import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    JSON,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class AttendanceSession(Base):
    """签到场次：一个线下课程可以有多个场次（如两天培训 = 两场）。"""

    __tablename__ = "attendance_sessions"
    __table_args__ = (
        Index("ix_attendance_sessions_course_start", "course_id", "start_time"),
    )

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    course_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("courses.id"), nullable=False, index=True, comment="关联课程"
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False, comment="场次名称，如「第一天 上午」")

    # 签到时间窗：只有窗口内提交才有效
    start_time: Mapped[datetime] = mapped_column(DateTime, nullable=False, comment="签到开始时间")
    end_time: Mapped[datetime] = mapped_column(DateTime, nullable=False, comment="签到结束时间")
    # 超过开始时间 N 分钟记为「迟到」；NULL 表示不区分迟到
    late_after_minutes: Mapped[int | None] = mapped_column(
        Integer, nullable=True, comment="超过开始时间多少分钟算迟到，NULL=不区分"
    )

    location_name: Mapped[str | None] = mapped_column(
        String(200), nullable=True, comment="签到地点描述，如「三楼培训室」"
    )

    # ── 可选的地理围栏（require_geofence=True 时强制校验） ──
    latitude: Mapped[float | None] = mapped_column(Float, nullable=True, comment="目标纬度")
    longitude: Mapped[float | None] = mapped_column(Float, nullable=True, comment="目标经度")
    radius_m: Mapped[int] = mapped_column(Integer, default=200, comment="允许半径（米）")

    # ── 可选的网络约束（require_network=True 时强制校验） ──
    ip_allowlist: Mapped[list | None] = mapped_column(
        JSON, nullable=True, comment='允许提交签到的 IP/CIDR 列表，如 ["10.0.0.0/8"]'
    )

    # ── 防代签开关（默认关闭，按需在管理端打开） ──
    require_network: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False, comment="是否强制校验来源 IP 在白名单内"
    )
    require_geofence: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False, comment="是否强制校验定位在半径内"
    )
    dedupe_device: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False,
        comment="是否禁止同一设备为多个账号签到（防一人代签多人）",
    )

    code_rotate_seconds: Mapped[int] = mapped_column(
        Integer, default=30, nullable=False, comment="动态签到码轮换周期（秒）"
    )
    remark: Mapped[str | None] = mapped_column(Text, nullable=True, comment="备注")

    created_by: Mapped[str | None] = mapped_column(String(36), nullable=True, comment="创建者")
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), comment="创建时间"
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now(), comment="更新时间"
    )


class AttendanceRecord(Base):
    """签到记录：每个 (场次, 学员) 最多一条，由唯一约束保证。"""

    __tablename__ = "attendance_records"
    __table_args__ = (
        UniqueConstraint("session_id", "user_id", name="uq_attendance_session_user"),
        Index("ix_attendance_records_course_user", "course_id", "user_id"),
    )

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    session_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("attendance_sessions.id"), nullable=False, index=True, comment="场次"
    )
    course_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("courses.id"), nullable=False, index=True, comment="课程（冗余便于统计）"
    )
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=False, index=True, comment="学员"
    )

    # present=正常签到 / late=迟到 / manual=管理员补签 / revoked=已撤销（不计入出勤）
    status: Mapped[str] = mapped_column(
        String(20), default="present", nullable=False, index=True, comment="present/late/manual/revoked"
    )
    # code=学员凭动态码签到 / manual=管理员补签
    source: Mapped[str] = mapped_column(
        String(20), default="code", nullable=False, comment="code/manual"
    )
    checked_in_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, comment="签到时间")

    # ── 留痕：用于管理员复核与事后审计 ──
    client_ip: Mapped[str | None] = mapped_column(String(64), nullable=True, comment="客户端 IP")
    user_agent: Mapped[str | None] = mapped_column(String(500), nullable=True, comment="浏览器 UA")
    device_id: Mapped[str | None] = mapped_column(
        String(64), nullable=True, index=True, comment="前端生成的设备指纹"
    )
    latitude: Mapped[float | None] = mapped_column(Float, nullable=True, comment="上报纬度")
    longitude: Mapped[float | None] = mapped_column(Float, nullable=True, comment="上报经度")
    distance_m: Mapped[float | None] = mapped_column(Float, nullable=True, comment="距目标点距离（米）")
    risk_flags: Mapped[list | None] = mapped_column(
        JSON, nullable=True, comment='异常标记，如 ["no_geolocation","device_reuse"]'
    )
    evidence: Mapped[dict | None] = mapped_column(
        JSON, nullable=True, comment="校验过程留痕（时间窗/动态码/网络/定位各项结果）"
    )

    operator_id: Mapped[str | None] = mapped_column(
        String(36), nullable=True, comment="人工补签/撤销的操作人"
    )
    remark: Mapped[str | None] = mapped_column(String(500), nullable=True, comment="备注")

    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), comment="创建时间"
    )
