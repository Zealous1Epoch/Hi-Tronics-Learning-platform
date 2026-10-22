"""LLM 接入选型层（AI 出题专用）

与业务解耦：本包只负责「调用 OpenAI 兼容协议 + 打捞输出」，
不感知试题/题库等业务概念（业务编排在 services/ai_question_service.py）。
"""
