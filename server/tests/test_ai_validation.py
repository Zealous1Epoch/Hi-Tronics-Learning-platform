"""AI 草稿校验（validate_item / mark_duplicates）单元测试——零网络零 LLM"""

from app.services.ai_question_service import normalize_stem, validate_item


def _single(**over):
    item = {
        "type": "single_choice",
        "stem": "以下哪个是 Python 的不可变类型？",
        "options": {"A": "字符串", "B": "列表", "C": "字典", "D": "字节数组"},
        "answer": {"correct": "A"},
        "difficulty": "easy",
    }
    item.update(over)
    return item


class TestValidateSingleChoice:
    def test_valid(self):
        draft, warnings = validate_item(_single())
        assert draft is not None
        assert draft["answer"] == {"correct": "A"}
        assert draft["difficulty"] == "easy"
        assert warnings == []

    def test_expected_type_fallback(self):
        raw = _single()
        del raw["type"]
        draft, _ = validate_item(raw, expected_type="single_choice")
        assert draft["type"] == "single_choice"

    def test_invalid_type_dropped(self):
        draft, warnings = validate_item(_single(type="unknown"))
        assert draft is None
        assert warnings

    def test_letter_normalization(self):
        # "a." / "选项A" 都应归一为 "A"
        for raw_val in ("a.", "选项A", " A "):
            draft, _ = validate_item(_single(answer={"correct": raw_val}))
            assert draft["answer"] == {"correct": "A"}

    def test_correct_not_in_options_dropped(self):
        draft, warnings = validate_item(_single(answer={"correct": "E"}))
        assert draft is None
        assert "选项" in warnings[0]

    def test_legacy_answer_dict_coerced(self):
        draft, warnings = validate_item(_single(answer={"answer": "A"}))
        assert draft["answer"] == {"correct": "A"}
        assert any("legacy" in w for w in warnings)

    def test_bare_string_answer_coerced(self):
        draft, _ = validate_item(_single(answer="A"))
        assert draft["answer"] == {"correct": "A"}

    def test_options_list_converted(self):
        draft, warnings = validate_item(
            _single(options=["甲", "乙", "丙"], answer={"correct": "B"})
        )
        assert draft["options"] == {"A": "甲", "B": "乙", "C": "丙"}
        assert any("数组" in w for w in warnings)

    def test_options_numeric_keys_converted(self):
        draft, _ = validate_item(
            _single(options={"1": "甲", "2": "乙"}, answer={"correct": "A"})
        )
        assert draft["options"] == {"A": "甲", "B": "乙"}

    def test_options_zero_based_numeric_keys(self):
        draft, _ = validate_item(
            _single(options={"0": "甲", "1": "乙"}, answer={"correct": "B"})
        )
        assert draft["options"] == {"A": "甲", "B": "乙"}

    def test_missing_options_dropped(self):
        draft, warnings = validate_item(_single(options=None))
        assert draft is None

    def test_single_option_dropped(self):
        draft, _ = validate_item(_single(options={"A": "只有这个"}))
        assert draft is None

    def test_non_dict_item_dropped(self):
        draft, warnings = validate_item("我是题目")
        assert draft is None and warnings

    def test_empty_stem_dropped(self):
        draft, _ = validate_item(_single(stem="   "))
        assert draft is None

    def test_long_stem_truncated(self):
        draft, warnings = validate_item(_single(stem="题" * 3000))
        assert len(draft["stem"]) == 2000
        assert any("截断" in w for w in warnings)

    def test_invalid_difficulty_coerced(self):
        draft, warnings = validate_item(_single(difficulty="简单"))
        assert draft["difficulty"] == "medium"
        assert any("medium" in w for w in warnings)

    def test_keywords_string_to_list(self):
        draft, _ = validate_item(_single(keywords="Python，基础、列表"))
        assert draft["keywords"] == ["Python", "基础", "列表"]


class TestValidateMultiChoice:
    def _multi(self, **over):
        item = {
            "type": "multi_choice",
            "stem": "以下哪些是法定工作日？",
            "options": {"A": "周一", "B": "周六", "C": "周三", "D": "周日"},
            "answer": {"correct": ["A", "C"]},
        }
        item.update(over)
        return item

    def test_valid(self):
        draft, warnings = validate_item(self._multi())
        assert draft["answer"] == {"correct": ["A", "C"]}
        assert warnings == []

    def test_string_answer_split(self):
        draft, warnings = validate_item(self._multi(answer={"correct": "A,C、D"}))
        assert draft["answer"] == {"correct": ["A", "C", "D"]}
        assert any("拆分" in w for w in warnings)

    def test_single_letter_answer_dropped(self):
        draft, _ = validate_item(self._multi(answer={"correct": ["A"]}))
        assert draft is None

    def test_dedup_letters(self):
        draft, _ = validate_item(self._multi(answer={"correct": ["A", "a", "A", "C"]}))
        assert draft["answer"] == {"correct": ["A", "C"]}


class TestValidateTrueFalse:
    def _tf(self, correct):
        return {"type": "true_false", "stem": "进入车间必须佩戴劳保用品", "answer": {"correct": correct}}

    def test_bool_values(self):
        assert validate_item(self._tf(True))[0]["answer"] == {"correct": True}
        assert validate_item(self._tf(False))[0]["answer"] == {"correct": False}

    def test_text_values_coerced(self):
        for v in ("true", "对", "正确", "是", "1"):
            assert validate_item(self._tf(v))[0]["answer"] == {"correct": True}
        for v in ("false", "错", "错误", "否", "0"):
            assert validate_item(self._tf(v))[0]["answer"] == {"correct": False}

    def test_garbage_dropped(self):
        draft, warnings = validate_item(self._tf("看情况"))
        assert draft is None and warnings


class TestValidateFillBlank:
    def test_valid_with_mark(self):
        raw = {"type": "fill_blank", "stem": "我国安全生产方针是安全第一、______。", "answer": {"correct": "预防为主"}}
        draft, warnings = validate_item(raw)
        assert draft["answer"] == {"correct": "预防为主"}
        assert warnings == []

    def test_mark_injected_when_missing(self):
        raw = {"type": "fill_blank", "stem": "消防电话是119吗？错，是____", "answer": {"correct": "119"}}
        raw["stem"] = "火灾报警电话是多少"
        draft, warnings = validate_item(raw)
        assert "______" in draft["stem"]
        assert any("注入" in w for w in warnings)

    def test_list_answer_takes_first(self):
        raw = {"type": "fill_blank", "stem": "安全色中______表示禁止", "answer": {"correct": ["红色", "红"]}}
        draft, _ = validate_item(raw)
        assert draft["answer"] == {"correct": "红色"}

    def test_empty_answer_dropped(self):
        raw = {"type": "fill_blank", "stem": "______是安全生产第一责任人", "answer": {"correct": ""}}
        draft, _ = validate_item(raw)
        assert draft is None


class TestValidateEssay:
    def test_reference_dict(self):
        raw = {"type": "essay", "stem": "简述三级安全教育的内容", "answer": {"reference": "厂级、车间级、班组级……"}}
        draft, warnings = validate_item(raw)
        assert draft["answer"] == {"reference": "厂级、车间级、班组级……"}
        assert warnings == []

    def test_bare_answer_coerced_to_reference(self):
        raw = {"type": "essay", "stem": "简述灭火器的使用步骤", "answer": "提拔握压"}
        draft, _ = validate_item(raw)
        assert draft["answer"] == {"reference": "提拔握压"}

    def test_empty_reference_dropped(self):
        raw = {"type": "essay", "stem": "简述应急疏散流程", "answer": {}}
        draft, _ = validate_item(raw)
        assert draft is None


class TestNormalizeStem:
    def test_punct_and_case_ignored(self):
        a = normalize_stem("Python 中，什么是「列表」?")
        b = normalize_stem("python中什么是列表")
        assert a == b
