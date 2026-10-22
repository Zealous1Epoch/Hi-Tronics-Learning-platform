"""LLM 输出 JSON 打捞（app.llm.json_utils）单元测试——零网络"""

import pytest

from app.llm.json_utils import clean_json_text, repair_json


class TestCleanJsonText:
    def test_strip_json_fence(self):
        raw = '```json\n{"questions": []}\n```'
        assert clean_json_text(raw) == '{"questions": []}'

    def test_strip_plain_fence(self):
        raw = '```\n{"a": 1}\n```'
        assert clean_json_text(raw) == '{"a": 1}'

    def test_extract_from_prose(self):
        raw = '好的，以下是题目：\n{"questions": [{"stem": "1+1=?"}]}\n希望有帮助！'
        out = clean_json_text(raw)
        assert out.startswith('{"questions"')
        assert out.endswith("}")

    def test_no_bracket_passthrough(self):
        assert clean_json_text("no json here") == "no json here"

    def test_none_safe(self):
        assert clean_json_text(None) == ""


class TestRepairJson:
    def test_plain_object(self):
        assert repair_json('{"a": 1}') == {"a": 1}

    def test_array_root(self):
        assert repair_json('[{"a": 1}]') == [{"a": 1}]

    def test_full_question_list(self):
        raw = '{"questions": [{"stem": "Q1"}, {"stem": "Q2"}]}'
        assert len(repair_json(raw)["questions"]) == 2

    def test_truncated_tail_recovers_complete_items(self):
        # max_tokens 腰斩：最后一题不完整，但前一题完整可救
        raw = (
            '{"questions": ['
            '{"stem": "Q1", "answer": {"correct": "A"}}, '
            '{"stem": "Q2", "opt'
        )
        data = repair_json(raw)
        stems = [q["stem"] for q in data["questions"]]
        assert "Q1" in stems

    def test_trailing_comma(self):
        assert repair_json('{"q": [1, 2,],}') == {"q": [1, 2]}

    def test_odd_quote_closed(self):
        # 字符串少一个闭引号 + 括号未闭合
        data = repair_json('{"questions": [{"stem": "broken')
        assert isinstance(data, dict)

    def test_chinese_quotes_inside_value_ok(self):
        # 值内部中文引号是合法 JSON 内容，直接 loads 就能过
        data = repair_json('{"stem": "所谓“安全第一”是指？"}')
        assert "安全第一" in data["stem"]

    def test_garbage_raises(self):
        with pytest.raises(ValueError):
            repair_json("not json at all")

    def test_empty_raises(self):
        with pytest.raises(ValueError):
            repair_json("")

    def test_pipeline_clean_then_repair(self):
        raw = '这是输出：\n```json\n{"questions": [{"stem": "A"}]}\n```'
        data = repair_json(clean_json_text(raw))
        assert data["questions"][0]["stem"] == "A"
