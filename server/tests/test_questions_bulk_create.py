"""POST /questions/bulk-create（AI 草稿批量入库）测试"""

from app.models.question import Question
from tests.conftest import create_question


def _item(stem, **over):
    item = {
        "type": "single_choice",
        "stem": stem,
        "options": {"A": "甲", "B": "乙", "C": "丙", "D": "丁"},
        "answer": {"correct": "A"},
        "difficulty": "easy",
    }
    item.update(over)
    return item


class TestBulkCreate:
    def test_create_dedup_and_ai_tag(self, client, admin_headers, db):
        create_question(db, "single_choice", "以下哪种属于A类火灾？", {"correct": "A"})
        payload = {
            "items": [
                _item("以下哪种属于A类火灾？"),  # 与现有题库重复 → skipped
                _item("灭火的基本方法有哪些？", tags=["消防"]),  # 有效 → created
                _item("灭火的基本方法有哪些？"),  # 批内重复 → skipped
                _item("答案无效题", answer={"correct": "Z"}),  # 非法 → errors
            ]
        }
        res = client.post("/api/questions/bulk-create", json=payload, headers=admin_headers)
        assert res.status_code == 200
        body = res.json()
        assert body["created"] == 1
        assert body["skipped"] == 2
        assert len(body["errors"]) == 1
        assert "第4题" in body["errors"][0]

        q = db.query(Question).filter(Question.stem == "灭火的基本方法有哪些？").first()
        assert q is not None
        assert "AI生成" in q.tags
        assert "消防" in q.tags  # 原标签保留
        assert q.difficulty == "easy"

    def test_punctuation_variant_treated_as_duplicate(self, client, admin_headers, db):
        create_question(db, "single_choice", "灭火的基本方法有哪些", {"correct": "A"})
        res = client.post(
            "/api/questions/bulk-create",
            json={"items": [_item(" 灭火的基本方法 有哪些？！ ")]},
            headers=admin_headers,
        )
        assert res.json() == {"created": 0, "skipped": 1, "errors": []}

    def test_category_and_section_passthrough(self, client, admin_headers, db):
        res = client.post(
            "/api/questions/bulk-create",
            json={
                "items": [
                    _item("新题目一？", category_id="cat-9", section="第二章", type="true_false", answer={"correct": True}, options=None)
                ]
            },
            headers=admin_headers,
        )
        assert res.json()["created"] == 1
        q = db.query(Question).filter(Question.stem == "新题目一？").first()
        assert q.category_id == "cat-9"
        assert q.section == "第二章"
        assert q.type == "true_false"

    def test_empty_items_422(self, client, admin_headers):
        res = client.post("/api/questions/bulk-create", json={"items": []}, headers=admin_headers)
        assert res.status_code == 422

    def test_requires_admin(self, client, student_headers):
        res = client.post(
            "/api/questions/bulk-create", json={"items": [_item("x？")]}, headers=student_headers
        )
        assert res.status_code == 403
