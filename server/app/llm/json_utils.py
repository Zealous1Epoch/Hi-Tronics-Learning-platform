"""LLM 破损 JSON 输出打捞

三层修复策略（移植自招聘系统 openai_provider.py 并泛化为独立工具）：
1. clean_json_text：剥 markdown 代码围栏、截取最外层 JSON 块（容忍前后散文）
2. repair_json 策略 B：尾部截断——以最后一个 } 或 ] 截断后补全括号
3. repair_json 策略 C：括号平衡回溯——从解析报错位置逐步截短再补括号

模型输出被 max_tokens 腰斩、带尾逗号、围栏包裹等场景均可救回。
"""

import json
import re


def clean_json_text(text: str) -> str:
    """剥 ```json 围栏，截取第一个 { 或 [ 到最后一个 } 或 ] 的片段。

    找不到任何括号时原样返回（交给 repair_json 抛错）。
    """
    text = (text or "").strip()
    if text.startswith("```"):
        lines = text.split("\n")
        if len(lines) > 1:
            text = "\n".join(lines[1:])
        if text.rstrip().endswith("```"):
            text = text.rstrip()[:-3]
        text = text.strip()
    starts = [i for i in (text.find("{"), text.find("[")) if i != -1]
    start = min(starts) if starts else -1
    end = max(text.rfind("}"), text.rfind("]"))
    if start != -1 and end > start:
        return text[start : end + 1]
    return text


def _clean_candidate(text: str) -> str:
    """清掉 } ] 前的尾逗号；引号数为奇数时补一个闭引号"""
    text = re.sub(r",(\s*[}\]])", r"\1", text)
    text = text.rstrip().rstrip(",")
    if text.count('"') % 2 != 0:
        text += '"'
    return text


def _close_brackets(text: str) -> str:
    """扫描括号栈（字符串字面量内的括号不算），把未闭合的 { [ 补全在末尾"""
    stack: list[str] = []
    in_string = False
    escape = False
    for ch in text:
        if escape:
            escape = False
            continue
        if ch == "\\":
            escape = True
            continue
        if ch == '"':
            in_string = not in_string
            continue
        if in_string:
            continue
        if ch in "{[":
            stack.append(ch)
        elif ch == "}" and stack and stack[-1] == "{":
            stack.pop()
        elif ch == "]" and stack and stack[-1] == "[":
            stack.pop()
    return text + "".join("}" if c == "{" else "]" for c in reversed(stack))


def _gen_cut_points(pos: int):
    """从报错位置 pos 出发生成候选截断点：粗粒度等分扫一遍，再细扫报错点附近"""
    if pos <= 0:
        return
    step = max(1, pos // 10)
    yield from range(pos, step - 1, -step)
    if step > 1:
        for cut in range(pos - 1, max(pos - step, 0), -1):
            yield cut


def repair_json(text: str):
    """把（可能破损的）JSON 文本解析成 dict/list，失败抛 ValueError。

    典型可救场景：markdown 围栏、前后散文、max_tokens 腰斩、尾逗号、
    字符串少一个闭引号。
    """
    text = (text or "").strip()
    if not text:
        raise ValueError("空文本，无法解析为 JSON")
    try:
        return json.loads(text)
    except json.JSONDecodeError as e:
        err_pos = min(int(getattr(e, "pos", 0) or 0), len(text))

    # 策略 B：尾部截断——找到最后一个闭包符，截断后补全外层括号
    for closer in ("}", "]"):
        idx = text.rfind(closer)
        if idx > 0:
            candidate = _close_brackets(_clean_candidate(text[: idx + 1]))
            try:
                return json.loads(candidate)
            except json.JSONDecodeError:
                pass

    # 策略 C：括号平衡回溯——从报错位置逐步截短再补括号
    for cut in _gen_cut_points(err_pos):
        candidate = _close_brackets(_clean_candidate(text[:cut]))
        try:
            return json.loads(candidate)
        except json.JSONDecodeError:
            continue

    raise ValueError(f"JSON 打捞失败（{len(text)} 字符）")
