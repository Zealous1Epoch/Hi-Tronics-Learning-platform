"""POST /questions/import 查重口径测试：归一化（与 AI 入库路径统一）+ 批内相互查重"""

import io

from app.models.question import Question
from tests.conftest import create_question


def _xlsx(rows):
    from openpyxl import Workbook

    wb = Workbook()
    ws = wb.active
    ws.append(["题型", "题干", "选项A", "选项B", "选项C", "选项D", "答案", "关键词", "标签", "难度"])
    for r in rows:
        ws.append(r)
    bio = io.BytesIO()
    wb.save(bio)
    bio.seek(0)
    return bio


class TestImportDedup:
    def test_punctuation_variant_and_infile_duplicate_skipped(self, client, admin_headers, db):
        # 库内已有题（无标点版）
        create_question(db, "single_choice", "与库内重复的题干", {"correct": "A"})
        bio = _xlsx(
            [
                ["单选题", "与库内重复的题干？", "甲", "乙", "丙", "丁", "A", "", "", "easy"],  # 跨来源标点变体 → skipped
                ["单选题", "新导入的题干", "甲", "乙", "丙", "丁", "A", "", "", "easy"],  # 正常 → created
                ["单选题", "新导入的题干！！", "甲", "乙", "丙", "丁", "A", "", "", "easy"],  # 批内变体 → skipped
            ]
        )
        res = client.post(
            "/api/questions/import",
            files={"file": ("t.xlsx", bio, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
            headers=admin_headers,
        )
        assert res.status_code == 200
        body = res.json()
        assert body["created"] == 1
        assert body["skipped"] == 2
        assert db.query(Question).count() == 2  # 库内 1 + 新增 1

    def test_requires_admin(self, client, student_headers):
        res = client.post(
            "/api/questions/import",
            files={"file": ("t.xlsx", io.BytesIO(b"x"), "application/octet-stream")},
            headers=student_headers,
        )
        assert res.status_code == 403
