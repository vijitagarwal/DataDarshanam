# -*- coding: utf-8 -*-
import os
import json
import re

from groq import Groq
from dotenv import load_dotenv

load_dotenv()

SYSTEM_PROMPT = """You are a BI query parser. Return ONLY a raw JSON object — no markdown, no code fences, no prose.

DATASET COLUMNS:
  order_date (2022–2023 dates)
  product_category: Beauty | Books | Electronics | Fashion | Home & Kitchen | Sports
  customer_region: Asia | Europe | Middle East | North America
  payment_method: Cash on Delivery | Credit Card | Debit Card | UPI | Wallet
  price, discount_percent, quantity_sold, rating, review_count, discounted_price, total_revenue
  year (2022 or 2023), month (1–12), quarter (1–4), month_name (Jan–Dec labels)

OUTPUT SCHEMA (all fields required):
{"metric":"total_revenue","aggregation":"sum","dimensions":["customer_region"],"filters":[],"chart_type":"bar","sort_by":"metric","sort_order":"desc","limit":100,"title":"...","x_label":"...","y_label":"..."}

═══ METRIC RULES ═══
"revenue" / "sales" / "income"          → metric:"total_revenue",    aggregation:"sum"
"quantity" / "units sold" / "units"     → metric:"quantity_sold",     aggregation:"sum"
"rating" / "rated" / "average rating"  → metric:"rating",            aggregation:"mean"
"discount" / "discount percent"         → metric:"discount_percent",  aggregation:"mean"
"price"                                 → metric:"price",             aggregation:"mean"
"count" / "number of orders" / "orders"→ metric:"total_revenue",     aggregation:"count"

═══ DIMENSION + CHART TYPE RULES ═══
"trend" / "over time" / "monthly" / "month by month"
  → dimensions:["month_name"], chart_type:"line", sort_by:"month_name", sort_order:"asc"

"yearly" / "annual" / "by year" / "year over year"
  → dimensions:["year"], chart_type:"line", sort_by:"year", sort_order:"asc"

"by region" / "per region" / "regional" / "across regions"
  → dimensions:["customer_region"], chart_type:"bar"

"by category" / "per category" / "by product" / "product-wise"
  → dimensions:["product_category"], chart_type:"bar"

"by payment" / "payment method" / "payment-wise"
  → dimensions:["payment_method"], chart_type:"bar"

"compare" / "breakdown" / "X vs Y" or any query needing two groupings
  → dimensions:["month_name", <second_dim>], chart_type:"line", sort_by:"month_name", sort_order:"asc"
  Example: "compare revenue by category monthly" → dimensions:["month_name","product_category"]
  Example: "revenue breakdown by region over time" → dimensions:["month_name","customer_region"]

CHART TYPE summary:
  month_name or year in dimensions         → chart_type:"line"
  single categorical dimension             → chart_type:"bar"
  two dimensions                           → chart_type:"line"

═══ TOP-N RULES ═══
"top 5"       → limit:5,  sort_order:"desc"
"top 10"      → limit:10, sort_order:"desc"
"top N"       → limit:N,  sort_order:"desc"
"bottom N" / "lowest N" → limit:N, sort_order:"asc"
No top-N mentioned → limit:100

═══ FILTER RULES ═══
Quarter filters (value must be an integer, NOT a string):
  "Q1" / "first quarter" / "quarter 1"   → {"field":"quarter","op":"eq","value":1}
  "Q2" / "second quarter" / "quarter 2"  → {"field":"quarter","op":"eq","value":2}
  "Q3" / "third quarter" / "quarter 3"   → {"field":"quarter","op":"eq","value":3}
  "Q4" / "fourth quarter" / "last quarter" / "quarter 4" → {"field":"quarter","op":"eq","value":4}

Year filters (value must be an integer, NOT a string):
  "2022" → {"field":"year","op":"eq","value":2022}
  "2023" → {"field":"year","op":"eq","value":2023}

Month filters (value must be the month NUMBER as an integer):
  "january" / "jan"  → {"field":"month","op":"eq","value":1}
  "february" / "feb" → {"field":"month","op":"eq","value":2}
  "march" / "mar"    → {"field":"month","op":"eq","value":3}
  "april" / "apr"    → {"field":"month","op":"eq","value":4}
  "may"              → {"field":"month","op":"eq","value":5}
  "june" / "jun"     → {"field":"month","op":"eq","value":6}
  "july" / "jul"     → {"field":"month","op":"eq","value":7}
  "august" / "aug"   → {"field":"month","op":"eq","value":8}
  "september" / "sep"→ {"field":"month","op":"eq","value":9}
  "october" / "oct"  → {"field":"month","op":"eq","value":10}
  "november" / "nov" → {"field":"month","op":"eq","value":11}
  "december" / "dec" → {"field":"month","op":"eq","value":12}

Category filters (exact capitalisation required):
  "electronics"       → {"field":"product_category","op":"eq","value":"Electronics"}
  "fashion"           → {"field":"product_category","op":"eq","value":"Fashion"}
  "beauty"            → {"field":"product_category","op":"eq","value":"Beauty"}
  "books"             → {"field":"product_category","op":"eq","value":"Books"}
  "home" / "kitchen"  → {"field":"product_category","op":"eq","value":"Home & Kitchen"}
  "sports"            → {"field":"product_category","op":"eq","value":"Sports"}

Region filters (exact capitalisation required):
  "asia"          → {"field":"customer_region","op":"eq","value":"Asia"}
  "europe"        → {"field":"customer_region","op":"eq","value":"Europe"}
  "north america" → {"field":"customer_region","op":"eq","value":"North America"}
  "middle east"   → {"field":"customer_region","op":"eq","value":"Middle East"}

═══ SORT RULES ═══
  month_name in dimensions → sort_by:"month_name", sort_order:"asc"
  year in dimensions       → sort_by:"year",       sort_order:"asc"
  otherwise                → sort_by:"metric",     sort_order:"desc"

DEFAULTS (when intent is unclear): metric:"total_revenue", aggregation:"sum", chart_type:"bar", limit:100
ERROR (unknown column): {"error":true,"message":"Field not available. Valid columns: order_date, product_category, customer_region, payment_method, price, discount_percent, quantity_sold, rating, review_count, discounted_price, total_revenue, year, month, quarter, month_name"}"""


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

    # Too short to be a data query (under 3 words)
    if len(q.split()) < 3:
        return True

    # Must contain at least one data-related keyword
    data_keywords = [
        "show", "tell", "what", "how", "revenue", "sales", "trend",
        "compare", "top", "best", "worst", "average", "total", "count",
        "region", "category", "product", "month", "year", "quarter",
        "rating", "discount", "payment", "chart", "graph", "breakdown",
        "analyze", "analysis", "dashboard", "report", "filter", "by",
    ]
    if not any(kw in q for kw in data_keywords):
        return True

    return False


def parse_query(user_query: str, previous_context: dict = None) -> dict:
    if not user_query or not user_query.strip():
        return {
            "error": True,
            "message": "Query is empty. Please ask a question about the sales data.",
        }

    if is_chitchat(user_query):
        return {
            "error": True,
            "message": (
                "👋 That doesn't look like a data question! Try asking something like:\n"
                "- 'Show total revenue by region'\n"
                "- 'Monthly sales trend for 2023'\n"
                "- 'Top product categories by average rating'"
            ),
        }

    try:
        import streamlit as st
        api_key = st.secrets["GROQ_API_KEY"]
    except:
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
            f"Reuse filters/dimensions when the new query is ambiguous."
        )

    user_content = user_query.strip() + context_block

    try:
        response = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
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
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_content},
                {"role": "assistant", "content": raw},
                {
                    "role": "user",
                    "content": (
                        "⚠ RETRY: Output ONLY a raw JSON object starting with { and ending with }. "
                        "No markdown, no prose, no code fences."
                    ),
                },
            ]
            raw = client.chat.completions.create(
                model="llama-3.3-70b-versatile",
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


# ---------------------------------------------------------------------------
# Dashboard mode — hardcoded 3-chart overview, no LLM call needed
# ---------------------------------------------------------------------------

_DASHBOARD_TRIGGERS = frozenset(["dashboard", "overview", "summary", "report"])

_DASHBOARD_QUERIES: list[dict] = [
    {
        "metric":      "total_revenue",
        "aggregation": "sum",
        "dimensions":  ["customer_region"],
        "filters":     [],
        "chart_type":  "bar",
        "sort_by":     "metric",
        "sort_order":  "desc",
        "limit":       100,
        "title":       "Revenue by Region",
        "x_label":     "Region",
        "y_label":     "Total Revenue ($)",
    },
    {
        "metric":      "total_revenue",
        "aggregation": "sum",
        "dimensions":  ["month_name"],
        "filters":     [],
        "chart_type":  "line",
        "sort_by":     "month_name",
        "sort_order":  "asc",
        "limit":       100,
        "title":       "Monthly Revenue Trend (All Time)",
        "x_label":     "Month",
        "y_label":     "Total Revenue ($)",
    },
    {
        "metric":      "total_revenue",
        "aggregation": "sum",
        "dimensions":  ["product_category"],
        "filters":     [],
        "chart_type":  "pie",
        "sort_by":     "metric",
        "sort_order":  "desc",
        "limit":       100,
        "title":       "Revenue Share by Product Category",
        "x_label":     "Category",
        "y_label":     "Total Revenue ($)",
    },
]


def parse_dashboard_query(user_query: str) -> list[dict] | None:
    """
    Return the fixed 3-chart dashboard spec if the query contains a
    dashboard/overview trigger word, otherwise return None.
    """
    query_lower = user_query.lower()
    words = set(query_lower.split())
    triggered = bool(words & _DASHBOARD_TRIGGERS) or "full report" in query_lower
    return list(_DASHBOARD_QUERIES) if triggered else None
