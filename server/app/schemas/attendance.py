"""线下面授签到相关 Pydantic 模型"""

from datetime import datetime

from pydantic import BaseModel, Field, model_validator


# ── 管理端：场次 CRUD ──

class SessionCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    start_time: datetime
    end_time: datetime
    late_after_minutes: int | None = Field(default=None, ge=0, le=1440)
    location_name: str | None = Field(default=None, max_length=200)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    radius_m: int = Field(default=200, ge=10, le=20000)
    ip_allowlist: list[str] | None = None
    require_network: bool = False
    require_geofence: bool = False
    dedupe_device: bool = False
    code_rotate_seconds: int = Field(default=30, ge=10, le=600)
    remark: str | None = None

    @model_validator(mode="after")
    def check(self):
        if self.end_time <= self.start_time:
            raise ValueError("签到结束时间必须晚于开始时间")
        if self.require_geofence and (self.latitude is None or self.longitude is None):
            raise ValueError("启用定位校验前请先填写目标经纬度")
        if self.require_network and not self.ip_allowlist:
            raise ValueError("启用网络校验前请先填写允许的 IP / 网段")
        return self


class SessionUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    start_time: datetime | None = None
    end_time: datetime | None = None
    late_after_minutes: int | None = Field(default=None, ge=0, le=1440)
    location_name: str | None = Field(default=None, max_length=200)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    radius_m: int | None = Field(default=None, ge=10, le=20000)
    ip_allowlist: list[str] | None = None
    require_network: bool | None = None
    require_geofence: bool | None = None
    dedupe_device: bool | None = None
    code_rotate_seconds: int | None = Field(default=None, ge=10, le=600)
    remark: str | None = None


class SessionOut(BaseModel):
    id: str
    course_id: str
    title: str
    start_time: datetime
    end_time: datetime
    late_after_minutes: int | None = None
    location_name: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    radius_m: int = 200
    ip_allowlist: list[str] | None = None
    require_network: bool = False
    require_geofence: bool = False
    dedupe_device: bool = False
    code_rotate_seconds: int = 30
    remark: str | None = None
    created_at: datetime
    # 派生字段（不入库）
    state: str = "upcoming"           # upcoming / open / closed
    checked_in_count: int = 0
    expected_count: int = 0
    risk_count: int = 0

    class Config:
        from_attributes = True


# ── 管理端：投屏签到码 ──

class ProjectorCodeOut(BaseModel):
    session_id: str
    session_title: str
    course_title: str
    location_name: str | None = None
    code: str
    rotate_seconds: int
    expires_in: int                    # 当前码剩余有效秒数
    server_time: datetime
    state: str
    checked_in_count: int
    expected_count: int
    checkin_url: str                   # 投屏页签到二维码完整 URL（供手机扫码）


class StudentCodeOut(BaseModel):
    """学员扫码页拉取当前动态签到码（只读，不写库）。"""

    session_id: str
    course_id: str
    session_title: str
    course_title: str
    location_name: str | None = None
    code: str
    rotate_seconds: int
    expires_in: int                    # 当前码剩余有效秒数
    state: str


# ── 管理端：名单 ──

class RecordOut(BaseModel):
    id: str
    user_id: str
    user_name: str
    username: str
    employee_id: str | None = None
    department: str | None = None
    status: str
    source: str
    checked_in_at: datetime
    client_ip: str | None = None
    device_id: str | None = None
    distance_m: float | None = None
    risk_flags: list[str] = []
    remark: str | None = None


class RosterEntry(BaseModel):
    """应到名单中的一名学员（含未签到者）。"""

    user_id: str
    user_name: str
    username: str
    employee_id: str | None = None
    department: str | None = None
    record: RecordOut | None = None       # NULL 表示未签到
    status: str = "absent"                # present / late / manual / revoked / absent


class RosterOut(BaseModel):
    session: SessionOut
    entries: list[RosterEntry]
    present_count: int
    absent_count: int
    risk_count: int


class ManualCheckInRequest(BaseModel):
    """管理员补签：为指定学员直接记账。"""

    user_ids: list[str] = Field(min_length=1)
    status: str = "manual"                # manual / late / present
    remark: str | None = Field(default=None, max_length=500)


# ── 学员端 ──

class CheckInRequest(BaseModel):
    code: str = Field(min_length=1, max_length=16, description="投屏上显示的动态签到码")
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    device_id: str | None = Field(default=None, max_length=64, description="前端生成的设备指纹")


class PublicCheckInRequest(BaseModel):
    """扫码输工号签到（公开、无登录）。

    用于 HTTP 环境 + 任何手机扫码 App（不依赖企业微信 OAuth）。
    通过 (employee_id, name) 双重校验匹配系统账号，防止误输。
    """

    employee_id: str = Field(min_length=1, max_length=50, description="工号")
    name: str = Field(min_length=1, max_length=100, description="姓名（双重校验）")


class MySessionState(BaseModel):
    id: str
    title: str
    start_time: datetime
    end_time: datetime
    location_name: str | None = None
    state: str                             # upcoming / open / closed
    # 供前端提前提示「本场需要定位」并按需申请浏览器定位权限
    require_geofence: bool = False
    checked_in: bool = False
    status: str | None = None              # present / late / manual / revoked
    checked_in_at: datetime | None = None
    remark: str | None = None


class MyAttendanceOut(BaseModel):
    course_id: str
    # 历史字段保留（响应兼容），新前端按 require_attendance 判定
    course_type: str
    # 是否启用现场签到（前端据此决定是否渲染签到卡片）
    require_attendance: bool = False
    sessions: list[MySessionState]
    required_count: int
    attended_count: int
    satisfied: bool
    can_take_exam: bool
    blockers: list[str] = []


class CheckInResultOut(BaseModel):
    ok: bool
    status: str
    checked_in_at: datetime
    message: str
    risk_flags: list[str] = []


# ── 课程维度汇总（管理端） ──

class CourseAttendanceOverview(BaseModel):
    course_id: str
    course_title: str
    # 历史字段保留（响应兼容）
    course_type: str
    # 是否启用现场签到
    require_attendance: bool = False
    sessions: list[SessionOut]
    expected_count: int
    fully_attended_count: int          # 全部场次都签到的学员数
    partially_attended_count: int
    absent_count: int
