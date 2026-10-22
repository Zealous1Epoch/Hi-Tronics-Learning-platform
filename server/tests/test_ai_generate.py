"""AI 生成编排与 /api/ai 端点测试 —— 全部 monkeypatch chat_completion_json，零网络"""

import json

import pytest

import app.services.ai_question_service as svc
from app.config import settings
from app.schemas.ai_question import AIGenerateRequest


def _req(**over):
    kw = dict(
        topic="安全生产基础知识",
        counts={
            "single_choice": 2,
            "multi_choice": 0,
            "true_false": 0,
            "fill_blank": 0,
            "essay": 0,
        },
        difficulty_mode="mixed",
    )
    kw.update(over)
    return AIGenerateRequest(**kw)


def _q(stem, **over):
    item = {
        "stem": stem,
        "options": {"A": "甲", "B": "乙", "C": "丙", "D": "丁"},
        "answer": {"correct": "A"},
        "difficulty": "easy",
    }
    item.update(over)
    return item


def _payload(questions):
    return json.dumps({"questions": questions}, ensure_ascii=False)


TWO_OK = _payload(
    [
        _q("以下谁是本岗位安全生产第一责任人？"),
        _q("三级安全教育分为哪三级？", difficulty="hard"),
    ]
)


class TestGenerateOneType:
    def test_success_first_try(self, monkeypatch):
        calls = []

        def fake(prompt, max_tokens=None):
            calls.append(prompt)
            return TWO_OK, {"prompt_tokens": 10, "completion_tokens": 20}

        monkeypatch.setattr(svc, "chat_completion_json", fake)
        items, ws, usage = svc._generate_one_type(_req(), "single_choice", 2)
        assert len(items) == 2
        assert ws == []
        assert usage == {"prompt_tokens": 10, "completion_tokens": 20}
        assert len(calls) == 1

    def test_prompt_contains_topic_and_format(self, monkeypatch):
        captured = {}

        def fake(prompt, max_tokens=None):
            captured["p"] = prompt
            return TWO_OK, {}

        monkeypatch.setattr(svc, "chat_completion_json", fake)
        svc._generate_one_type(_req(extra_requirement="多用厂区真实场景"), "single_choice", 2)
        p = captured["p"]
        assert "安全生产基础知识" in p
        assert '"questions"' in p  # schema 示例
        assert "多用厂区真实场景" in p  # 补充要求已注入
        assert "无权修改" in p  # 注入软化定界

    def test_invalid_json_then_retry(self, monkeypatch):
        seq = iter(["这不是 JSON", TWO_OK])

        def fake(prompt, max_tokens=None):
            return next(seq), {}

        monkeypatch.setattr(svc, "chat_completion_json", fake)
        items, ws, _ = svc._generate_one_type(_req(), "single_choice", 2)
        assert len(items) == 2
        assert any("无法解析" in w for w in ws)

    def test_gap_second_call_asks_remaining(self, monkeypatch):
        first = _payload([_q("第一题？")])
        second = _payload([_q("第二题？")])
        prompts = []

        def fake(prompt, max_tokens=None):
            prompts.append(prompt)
            return (first if len(prompts) == 1 else second), {}

        monkeypatch.setattr(svc, "chat_completion_json", fake)
        items, ws, _ = svc._generate_one_type(_req(), "single_choice", 2)
        assert len(items) == 2
        assert ws == []
        assert "出 1 道单选题" in prompts[1]  # 第二轮只补缺口

    def test_all_attempts_fail(self, monkeypatch):
        def boom(prompt, max_tokens=None):
            raise RuntimeError("connection reset")

        monkeypatch.setattr(svc, "chat_completion_json", boom)
        items, ws, _ = svc._generate_one_type(_req(), "single_choice", 2)
        assert items == []
        assert sum("调用失败" in w for w in ws) == 3
        assert any("实际获得 0 题" in w for w in ws)

    def test_excess_output_discarded(self, monkeypatch):
        three = _payload([_q("A？"), _q("B？"), _q("C？")])

        def fake(prompt, max_tokens=None):
            return three, {}

        monkeypatch.setattr(svc, "chat_completion_json", fake)
        items, ws, _ = svc._generate_one_type(_req(), "single_choice", 2)
        assert len(items) == 2
        assert any("超出" in w for w in ws)

    def test_array_root_tolerated(self, monkeypatch):
        arr = json.dumps([_q("直接输出数组？")], ensure_ascii=False)

        def fake(prompt, max_tokens=None):
            return arr, {}

        monkeypatch.setattr(svc, "chat_completion_json", fake)
        items, _, _ = svc._generate_one_type(_req(), "single_choice", 1)
        assert len(items) == 1

    def test_fenced_output_recovered(self, monkeypatch):
        fenced = "```json\n" + TWO_OK + "\n```"

        def fake(prompt, max_tokens=None):
            return fenced, {}

        monkeypatch.setattr(svc, "chat_completion_json", fake)
        items, ws, _ = svc._generate_one_type(_req(), "single_choice", 2)
        assert len(items) == 2


class TestGenerateDrafts:
    def test_parallel_types_and_meta(self, db, monkeypatch):
        req = _req(
            counts={
                "single_choice": 1,
                "multi_choice": 0,
                "true_false": 1,
                "fill_blank": 0,
                "essay": 0,
            }
        )

        def fake(prompt, max_tokens=None):
            if "单选题" in prompt:
                return _payload([_q("单选题一？")]), {}
            return _payload([{"stem": "进入车间前必须佩戴劳保用品。", "answer": {"correct": True}}]), {}

        monkeypatch.setattr(svc, "chat_completion_json", fake)
        drafts, ws, meta = svc.generate_drafts(db, req)
        assert len(drafts) == 2
        types = [d["type"] for d in drafts]
        assert types == ["single_choice", "true_false"]  # 稳定题型顺序
        assert meta["requested"] == 2 and meta["generated"] == 2
        assert meta["elapsed_ms"] >= 0

    def test_duplicate_marked_against_bank(self, db, monkeypatch):
        from tests.conftest import create_question

        create_question(db, "single_choice", "以下谁是本岗位安全生产第一责任人？", {"correct": "A"})
        monkeypatch.setattr(svc, "chat_completion_json", lambda p, max_tokens=None: (TWO_OK, {}))
        drafts, _, meta = svc.generate_drafts(db, _req())
        assert drafts[0]["dup_existing"] is True
        assert drafts[1]["dup_existing"] is False
        assert meta["duplicates"] == 1

    def test_category_propagated(self, db, monkeypatch):
        monkeypatch.setattr(svc, "chat_completion_json", lambda p, max_tokens=None: (TWO_OK, {}))
        drafts, _, _ = svc.generate_drafts(db, _req(category_id="cat-123"))
        assert all(d["category_id"] == "cat-123" for d in drafts)


class TestAIStatusEndpoint:
    def test_status_reports_disabled(self, client, admin_headers, monkeypatch):
        monkeypatch.setattr(settings, "LLM_API_KEY", "")
        res = client.get("/api/ai/status", headers=admin_headers)
        assert res.status_code == 200
        body = res.json()
        assert body["enabled"] is False
        assert body["model"]

    def test_status_requires_admin(self, client, student_headers):
        assert client.get("/api/ai/status", headers=student_headers).status_code == 403


GEN_BODY = {"topic": "消防安全", "counts": {"single_choice": 2}}


class TestAIGenerateEndpoint:
    def test_503_when_disabled(self, client, admin_headers, monkeypatch):
        monkeypatch.setattr(settings, "LLM_API_KEY", "")
        res = client.post("/api/ai/generate", json=GEN_BODY, headers=admin_headers)
        assert res.status_code == 503

    def test_success_returns_drafts_without_db_write(self, client, admin_headers, db, monkeypatch):
        monkeypatch.setattr(settings, "LLM_API_KEY", "test-key")
        monkeypatch.setattr(svc, "chat_completion_json", lambda p, max_tokens=None: (TWO_OK, {}))
        res = client.post("/api/ai/generate", json=GEN_BODY, headers=admin_headers)
        assert res.status_code == 200
        body = res.json()
        assert len(body["drafts"]) == 2
        assert body["meta"]["generated"] == 2
        assert body["drafts"][0]["dup_existing"] is False
        assert body["drafts"][0]["answer"] == {"correct": "A"}
        # 生成绝不写题库
        from app.models.question import Question

        assert db.query(Question).count() == 0

    def test_zero_total_422(self, client, admin_headers, monkeypatch):
        monkeypatch.setattr(settings, "LLM_API_KEY", "test-key")
        res = client.post(
            "/api/ai/generate", json={"topic": "x", "counts": {}}, headers=admin_headers
        )
        assert res.status_code == 422

    def test_over_30_422(self, client, admin_headers, monkeypatch):
        monkeypatch.setattr(settings, "LLM_API_KEY", "test-key")
        res = client.post(
            "/api/ai/generate",
            json={"topic": "x", "counts": {"single_choice": 31}},
            headers=admin_headers,
        )
        assert res.status_code == 422

    def test_requires_admin(self, client, student_headers):
        res = client.post("/api/ai/generate", json=GEN_BODY, headers=student_headers)
        assert res.status_code == 403
