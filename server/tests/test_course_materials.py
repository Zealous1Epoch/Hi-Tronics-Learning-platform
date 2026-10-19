"""课程课件（course_materials）端点测试

覆盖：上传白名单/限流、详情附带、删除确认与磁盘清理、
学员鉴权（未分配 403 / 已分配可预览下载）、删除课程连带清理课件。
磁盘依赖通过 monkeypatch course_files.UPLOAD_DIR 隔离到 tmp_path。
"""

import os
import uuid

import pytest

from app.models.course import CourseMaterial
from app.services import course_files


@pytest.fixture
def materials_dir(tmp_path, monkeypatch):
    """把课件存储目录重定向到临时目录"""
    d = tmp_path / "courses"
    d.mkdir()
    monkeypatch.setattr(course_files, "UPLOAD_DIR", str(d))
    return d


def _upload(client, headers, course_id, filename, content=b"%PDF-1.4 test", mime="application/pdf"):
    return client.post(
        f"/api/courses/{course_id}/materials",
        files={"file": (filename, content, mime)},
        headers=headers,
    )


def test_upload_pdf_and_detail_lists_materials(client, admin_headers, course_id, db, materials_dir):
    res = _upload(client, admin_headers, course_id, "培训手册.pdf")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["original_name"] == "培训手册.pdf"
    assert body["file_type"] == "pdf"
    assert body["file_size"] == len(b"%PDF-1.4 test")
    assert "obs_key" not in body  # 响应不外泄存储文件名
    # 磁盘确实落盘
    mat = db.query(CourseMaterial).filter(CourseMaterial.id == body["id"]).first()
    assert os.path.exists(course_files.resolve_path(mat.obs_key))

    # 课程详情附带 materials
    detail = client.get(f"/api/courses/{course_id}", headers=admin_headers)
    assert detail.status_code == 200
    mats = detail.json()["materials"]
    assert len(mats) == 1 and mats[0]["id"] == body["id"]


def test_upload_image_material_and_preview(client, admin_headers, course_id, db, materials_dir):
    """图片课件：PNG/JPEG 放行、预览返回图片 Content-Type（前端 <img> 直接渲染）"""
    png = bytes.fromhex("89504e470d0a1a0a") + b"\x00" * 24  # PNG 文件头 + 填充
    res = _upload(client, admin_headers, course_id, "现场照片.png", content=png, mime="image/png")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["file_type"] == "png"

    mid = body["id"]
    key = db.query(CourseMaterial).filter(CourseMaterial.id == mid).first().obs_key
    assert os.path.exists(course_files.resolve_path(key))

    prev = client.get(f"/api/course-materials/{mid}/preview", headers=admin_headers)
    assert prev.status_code == 200
    assert prev.headers["content-type"].startswith("image/png")
    assert prev.content == png

    # JPEG 与 gif/webp 同组放行（file_type 列 String(20)，"jpeg" 装得下）
    res2 = _upload(client, admin_headers, course_id, "chart.jpeg",
                   content=b"\xff\xd8\xff" + b"\x00" * 10, mime="image/jpeg")
    assert res2.status_code == 200 and res2.json()["file_type"] == "jpeg"

    # SVG 刻意不放行——可内嵌脚本，浏览器直接预览有 XSS 风险
    r = _upload(client, admin_headers, course_id, "evil.svg", content=b"<svg/>", mime="image/svg+xml")
    assert r.status_code == 400


def test_upload_rejects_bad_extension(client, admin_headers, course_id, materials_dir):
    res = _upload(client, admin_headers, course_id, "virus.exe", content=b"MZ...")
    assert res.status_code == 400
    assert "不支持" in res.json()["detail"]
    # 目录里不应留下任何文件
    assert os.listdir(materials_dir) == []


def test_upload_rejects_oversize(client, admin_headers, course_id, materials_dir, monkeypatch):
    monkeypatch.setattr(course_files, "MAX_FILE_SIZE", 10)
    res = _upload(client, admin_headers, course_id, "big.pdf", content=b"x" * 20)
    assert res.status_code == 400
    assert "文件过大" in res.json()["detail"]
    # 超限半成品必须被清掉
    assert os.listdir(materials_dir) == []


def test_upload_to_missing_course_404(client, admin_headers, materials_dir):
    res = _upload(client, admin_headers, str(uuid.uuid4()), "a.pdf")
    assert res.status_code == 404


def test_delete_requires_confirm_and_cleans_disk(
    client, admin_headers, course_id, db, materials_dir
):
    res = _upload(client, admin_headers, course_id, "slides.pdf")
    mid = res.json()["id"]
    key = db.query(CourseMaterial).filter(CourseMaterial.id == mid).first().obs_key
    path = course_files.resolve_path(key)
    assert os.path.exists(path)

    # 不带 confirm → 400，文件仍在
    r = client.delete(f"/api/course-materials/{mid}", headers=admin_headers)
    assert r.status_code == 400
    assert os.path.exists(path)

    # 带 confirm → 删除，行与文件都没了
    r = client.delete(f"/api/course-materials/{mid}?confirm=true", headers=admin_headers)
    assert r.status_code == 200
    assert db.query(CourseMaterial).filter(CourseMaterial.id == mid).first() is None
    assert not os.path.exists(path)


def test_student_access_control(client, admin_headers, student_headers, course_id, db, materials_dir):
    res = _upload(client, admin_headers, course_id, "handout.pdf")
    mid = res.json()["id"]

    # 学员未被分配课程 → 预览/下载 403
    assert client.get(f"/api/course-materials/{mid}/preview", headers=student_headers).status_code == 403
    assert client.get(f"/api/course-materials/{mid}/download", headers=student_headers).status_code == 403

    # 分配该学员 → 可预览可下载（admin 在 check_course_assignment 恒通过）
    from app.models.user import User
    uid = db.query(User).filter(User.username == "student1").first().id
    r = client.post(
        f"/api/courses/{course_id}/assignments",
        json={"user_ids": [uid], "department_ids": []},
        headers=admin_headers,
    )
    assert r.status_code == 200

    pv = client.get(f"/api/course-materials/{mid}/preview", headers=student_headers)
    assert pv.status_code == 200
    assert pv.content == b"%PDF-1.4 test"

    dl = client.get(f"/api/course-materials/{mid}/download", headers=student_headers)
    assert dl.status_code == 200
    assert "attachment" in dl.headers.get("content-disposition", "")


def test_pptx_preview_prefers_converted_pdf(
    client, admin_headers, student_headers, course_id, db, materials_dir, monkeypatch
):
    """PPTX 预览返回转换产物 PDF；转换函数打桩避免测试依赖 LibreOffice"""
    from app.routers import course_materials as cm_router
    monkeypatch.setattr(cm_router, "convert_office_to_pdf", lambda fp, ext: None)

    res = _upload(
        client, admin_headers, course_id, "课件.pptx",
        content=b"PK\x03\x04fake", mime="application/vnd.openxmlformats-officedocument.presentationml.presentation",
    )
    assert res.status_code == 200
    mid = res.json()["id"]
    key = db.query(CourseMaterial).filter(CourseMaterial.id == mid).first().obs_key

    # 无转换产物时预览回落原文件
    pv = client.get(f"/api/course-materials/{mid}/preview", headers=admin_headers)
    assert pv.status_code == 200
    assert pv.content == b"PK\x03\x04fake"

    # 模拟 LibreOffice 产出同名 PDF 后，预览应返回 PDF
    pdf_path = os.path.splitext(course_files.resolve_path(key))[0] + ".pdf"
    with open(pdf_path, "wb") as f:
        f.write(b"%PDF converted")
    pv2 = client.get(f"/api/course-materials/{mid}/preview", headers=admin_headers)
    assert pv2.content == b"%PDF converted"

    # 删除课件时转换 PDF 一并清理
    r = client.delete(f"/api/course-materials/{mid}?confirm=true", headers=admin_headers)
    assert r.status_code == 200
    assert not os.path.exists(pdf_path)
    assert not os.path.exists(course_files.resolve_path(key))


def test_pptx_preview_lazy_conversion_when_upload_convert_failed(
    client, admin_headers, course_id, db, materials_dir, monkeypatch
):
    """上传时转换失败的 PPTX，预览请求要触发懒转换补转（存量课程恢复预览的通道）。
    打桩：第 1 次（上传）失败，第 2 次（预览懒转）成功产出 PDF。"""
    from app.routers import course_materials as cm_router

    calls = []

    def fake_convert(filepath, ext):
        calls.append(filepath)
        if len(calls) == 1:
            return None
        pdf_path = os.path.splitext(filepath)[0] + ".pdf"
        with open(pdf_path, "wb") as f:
            f.write(b"%PDF lazy converted")
        return pdf_path

    monkeypatch.setattr(cm_router, "convert_office_to_pdf", fake_convert)

    res = _upload(
        client, admin_headers, course_id, "slides.pptx",
        content=b"PK\x03\x04fake",
        mime="application/vnd.openxmlformats-officedocument.presentationml.presentation",
    )
    assert res.status_code == 200
    assert len(calls) == 1  # 上传时尝试过一次

    pv = client.get(f"/api/course-materials/{res.json()['id']}/preview", headers=admin_headers)
    assert pv.status_code == 200
    assert len(calls) == 2  # 预览发现缺 PDF，懒转换被触发
    assert pv.content == b"%PDF lazy converted"


def test_delete_course_removes_materials(client, admin_headers, course_id, db, materials_dir):
    res = _upload(client, admin_headers, course_id, "gone.pdf")
    mid = res.json()["id"]
    key = db.query(CourseMaterial).filter(CourseMaterial.id == mid).first().obs_key
    path = course_files.resolve_path(key)
    assert os.path.exists(path)

    r = client.delete(f"/api/courses/{course_id}?confirm=true", headers=admin_headers)
    assert r.status_code == 200
    assert db.query(CourseMaterial).count() == 0
    assert not os.path.exists(path)


def test_no_video_course_material_count_in_student_views(
    client, admin_headers, student_headers, db, materials_dir
):
    """课件是与视频平级的第一等内容：纯课件课程在学员列表与今日计划中
    返回 material_count，total_count 为 0 而不是「没有内容」。"""
    from datetime import date as date_type

    from app.models.course import Course
    from app.models.user import User

    course = Course(
        id=str(uuid.uuid4()),
        title="纯课件课程",
        status="published",
        start_date=date_type.today(),
        end_date=date_type.today(),
    )
    db.add(course)
    db.commit()

    res = _upload(client, admin_headers, course.id, "SOP手册.pdf")
    assert res.status_code == 200

    uid = db.query(User).filter(User.username == "student1").first().id
    r = client.post(
        f"/api/courses/{course.id}/assignments",
        json={"user_ids": [uid], "department_ids": []},
        headers=admin_headers,
    )
    assert r.status_code == 200

    rows = client.get("/api/student/courses-with-progress", headers=student_headers).json()
    row = next(x for x in rows if x["id"] == course.id)
    assert row["material_count"] == 1
    assert row["total_count"] == 0

    plan = client.get(
        f"/api/student/daily-plan?date={date_type.today().isoformat()}",
        headers=student_headers,
    ).json()
    prow = next(x for x in plan["courses"] if x["id"] == course.id)
    assert prow["material_count"] == 1
    assert prow["total_count"] == 0


def test_no_video_completion_semantics(client, db, student_headers):
    """完成口径（progress_service.batch_progress_map）：
    无视频且无考试的课程不算完成（课件不采集阅读进度，无可验证痕迹）；
    无视频但有考试的课程，过考即完成；考试入口不被无视频卡住。"""
    from datetime import datetime

    from app.models.course import Course
    from app.models.exam import Exam, ExamResult
    from app.models.user import User
    from app.services.progress_service import batch_progress_map

    student = db.query(User).filter(User.username == "student1").first()

    plain = Course(id=str(uuid.uuid4()), title="纯课件", status="published")
    with_exam = Course(id=str(uuid.uuid4()), title="课件+考试", status="published")
    db.add_all([plain, with_exam])
    db.commit()

    exam = Exam(
        id=str(uuid.uuid4()),
        course_id=with_exam.id,
        title="课件考试",
        duration=30,
        total_score=100,
        pass_score=60,
        status="published",
    )
    db.add(exam)
    with_exam.exam_id = exam.id
    db.add(
        ExamResult(
            id=str(uuid.uuid4()),
            exam_id=exam.id,
            user_id=student.id,
            answers={},
            score=80,
            passed=True,
            attempt_number=1,
            started_at=datetime.now(),
            submitted_at=datetime.now(),
        )
    )
    db.commit()

    rows = batch_progress_map(db, student.id, [plain, with_exam])
    assert rows[plain.id].total_count == 0
    assert rows[plain.id].completed is False
    assert rows[plain.id].can_take_exam is True
    assert rows[with_exam.id].completed is True
