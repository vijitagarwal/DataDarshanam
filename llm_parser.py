import os
import json
import re

from groq import Groq
from dotenv import load_dotenv

load_dotenv()

_API_KEY = os.getenv("GROQ_API_KEY")
_CONFIG_ERROR: str | None = (
    "GROQ_API_KEY not found in .env file. "
    "Create a .env file in the project root containing:\n\nGROQ_API_KEY=your_key_here"
    if not _API_KEY
    else None
)

client = Groq(api_key=_API_KEY) if _API_KEY else None

SYSTEM_PROMPT = """You are a BI query parser. Return ONLY valid JSON, no markdown.

Dataset columns: order_date(2022-2023), product_category(Beauty/Books/Electronics/Fashion/Home & Kitchen/Sports), customer_region(Asia/Europe/Middle East/North America), payment_method(Cash on Delivery/Credit Card/Debit Card/UPI/Wallet), price, discount_percent, quantity_sold, rating, review_count, discounted_price, total_revenue, year, month, quarter(1-4), month_name(Jan-Dec labels)

Return this JSON schema:
{"metric":"total_revenue","aggregation":"sum","dimensions":["customer_region"],"filters":[],"chart_type":"bar","sort_by":"metric","sort_order":"desc","limit":10,"title":"...","x_label":"...","y_label":"..."}

For unknown fields return: {"error":true,"message":"Field not available. Use: [list columns]"}
Quarter mapping: Q1=1,Q2=2,Q3=3,Q4=4
Month name to number: january=1,february=2,march=3,april=4,may=5,june=6,july=7,august=8,september=9,october=10,november=11,december=12
Month filter example: "january" or "jan" or "month 1" → {"field":"month","op":"eq","value":1}
Time trend rule: For any monthly or time-trend chart, ALWAYS use dimensions:["month_name"] not ["month"]. month_name gives readable labels like Jan, Feb, etc."""


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


def parse_query(user_query: str, previous_context: dict = None) -> dict:
    if not user_query or not user_query.strip():
        return {
            "error": True,
            "message": "Query is empty. Please ask a question about the sales data.",
        }

    _GREETINGS = {"hi", "hello", "hey", "thanks", "thank you", "thx", "ty",
                  "how are you", "good morning", "good evening", "what's up", "sup"}
    if user_query.strip().lower().rstrip("!.,?") in _GREETINGS:
        return {
            "error": True,
            "message": (
                "👋 Hi! I can answer questions about your sales data. "
                "Try asking something like: 'Show total revenue by region' "
                "or 'Monthly sales trend for 2023'"
            ),
        }

    if _CONFIG_ERROR:
        return {"error": True, "message": _CONFIG_ERROR}

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
