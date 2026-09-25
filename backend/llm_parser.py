# -*- coding: utf-8 -*-
from __future__ import annotations

import json
import os
import re

from dotenv import load_dotenv
from groq import Groq

load_dotenv()


BASE_SYSTEM_PROMPT = """You are a BI query parser for a live CSV dataset.
Return ONLY a raw JSON object. No markdown, no code fences, no prose.

{schema_context}

OUTPUT SCHEMA (all fields required):
{{"metric":"<numeric_column>","aggregation":"sum|mean|count|max|min","dimensions":["<column>"],"filters":[],"chart_type":"bar|line|pie|scatter|heatmap","sort_by":"metric|<column>","sort_order":"asc|desc","limit":100,"title":"...","x_label":"...","y_label":"..."}}

RULES:
- Use ONLY columns listed in the dataset profile.
- The metric must be a numeric column from the profile, or "__row_count" for record counts.
- Use aggregation:"sum" for totals, revenue, sales, amount, quantity, value, cost, or profit.
- Use aggregation:"mean" for average, rating, score, price, percent, or rate.
- Use metric:"__row_count" and aggregation:"count" when the user asks for number of records/orders/items.
- Use categorical/date columns as dimensions and filters.
- For filters, use exact sample values when shown in the profile.
- For top N, set limit:N and sort_order:"desc"; for bottom/lowest N, set sort_order:"asc".
- If the query asks for a trend/over time/monthly/yearly view, use a date/time dimension and chart_type:"line".
- If there is one categorical dimension, default to chart_type:"bar"; use "pie" only for share/distribution questions with few categories.
- If there are two dimensions with time first, use chart_type:"line"; otherwise use chart_type:"heatmap" for matrix-style comparisons.
- Sort month_name chronologically with sort_by:"month_name", sort_order:"asc".
- Sort year/month/quarter/date dimensions ascending unless the user asks otherwise.
- If the query is unclear, choose the best metric and dimension from the profile and make a useful chart.
- If the user asks for a field that is not listed, return {{"error":true,"message":"Field not available in this dataset. Try one of the visible columns."}}
"""


def _build_system_prompt(schema_context: str | None = None) -> str:
    if not schema_context:
        try:
            from data_engine import build_schema_context

            schema_context = build_schema_context()
        except Exception:
            schema_context = (
                "No dataset profile was available. Use only columns the user "
                "explicitly names."
            )
    return BASE_SYSTEM_PROMPT.format(schema_context=schema_context)


def _extract_json(text: str) -> dict:
    """Strip markdown fences and extract the first JSON object from text."""
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\s*```$", "", text)
    text = text.strip()

    match = re.search(r"\{.*\}", text, re.DOTALL)
    if not match:
        raise ValueError(f"No JSON object found in model response: {text!r}")

    return json.loads(match.group())


def is_chitchat(query: str) -> bool:
    """Return True if the query is conversational rather than a data question."""
    q = query.lower().strip()

    chitchat_exact = {
        "hello", "hi", "hey", "awesome", "great", "thanks", "thank you",
        "cool", "nice", "ok", "okay", "wow", "yep", "nope", "sure", "bye",
        "good", "bad", "how are you", "what can you do", "who are you",
        "how are you?", "what's up", "whats up", "sup",
    }
    if q in chitchat_exact:
        return True

    if len(q.split()) < 3:
        return True

    data_keywords = [
        "show", "tell", "what", "how", "revenue", "sales", "trend",
        "compare", "top", "best", "worst", "average", "total", "count",
        "region", "category", "product", "month", "year", "quarter",
        "rating", "discount", "payment", "chart", "graph", "breakdown",
        "analyze", "analysis", "dashboard", "report", "filter", "by",
        "insights", "insight", "generate", "whole", "full", "all",
        "give", "about", "data", "overview", "summary", "performance",
        "distribution", "share", "records", "rows", "columns",
    ]
    return not any(kw in q for kw in data_keywords)


def parse_query(
    user_query: str,
    previous_context: dict | None = None,
    schema_context: str | None = None,
) -> dict:
    if not user_query or not user_query.strip():
        return {
            "error": True,
            "message": "Query is empty. Please ask a question about the dataset.",
        }

    if is_chitchat(user_query):
        return {
            "error": True,
            "message": (
                "That does not look like a data question. Try asking things like "
                "'show sales by region', 'monthly trend', or 'top categories'."
            ),
        }

    try:
        import streamlit as st

        api_key = st.secrets["GROQ_API_KEY"]
    except Exception:
        api_key = os.getenv("GROQ_API_KEY")

    client = Groq(api_key=api_key)

    context_block = ""
    if previous_context and not previous_context.get("error"):
        prev_title = previous_context.get("title", "the previous query")
        prev_metric = previous_context.get("metric", "")
        prev_dims = ", ".join(previous_context.get("dimensions") or [])
        context_block = (
            f"\n\nConversation context: user previously asked \"{prev_title}\". "
            f"Previous metric: {prev_metric}. Previous dimensions: {prev_dims or 'none'}. "
            "Reuse filters/dimensions when the new query is ambiguous."
        )

    user_content = user_query.strip() + context_block
    system_prompt = _build_system_prompt(schema_context)

    try:
        response = client.chat.completions.create(
            model="llama3-70b-8192",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_content},
            ],
            temperature=0.1,
            max_tokens=500,
        )
        raw = response.choices[0].message.content

        try:
            parsed = _extract_json(raw)
        except (json.JSONDecodeError, ValueError):
            retry_messages = [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_content},
                {"role": "assistant", "content": raw},
                {
                    "role": "user",
                    "content": (
                        "RETRY: Output ONLY a raw JSON object starting with { "
                        "and ending with }. No markdown, no prose."
                    ),
                },
            ]
            raw = client.chat.completions.create(
                model="llama3-70b-8192",
                messages=retry_messages,
                temperature=0.0,
                max_tokens=500,
            ).choices[0].message.content
            try:
                parsed = _extract_json(raw)
            except (json.JSONDecodeError, ValueError):
                return {
                    "error": True,
                    "message": (
                        "The AI returned an unreadable response twice in a row. "
                        "Please try rephrasing your question."
                    ),
                }

    except Exception as e:
        return {
            "error": True,
            "message": f"Failed to reach the AI service: {e}",
        }

    if "error" in parsed and parsed["error"] not in (True, False):
        parsed["error"] = bool(parsed["error"])

    return parsed


_DASHBOARD_TRIGGERS = frozenset(["dashboard", "overview", "summary", "report"])


def parse_dashboard_query(user_query: str) -> list[dict] | None:
    """Return a data-driven overview spec when dashboard intent is present."""
    query_lower = user_query.lower()
    words = set(query_lower.split())
    triggered = bool(words & _DASHBOARD_TRIGGERS) or "full report" in query_lower
    if not triggered:
        return None

    try:
        from data_engine import build_overview_queries

        queries = build_overview_queries()
        return queries or None
    except Exception:
        return None
