import os

from groq import Groq
from dotenv import load_dotenv

load_dotenv()
client = Groq(api_key=os.getenv("GROQ_API_KEY"))

# Set to True when the API call fails and the template fallback is used.
# Checked by app.py to show a toast notification.
_last_used_fallback: bool = False

_SYSTEM_PROMPT = "Write exactly 2-3 sentences. No bullets or headers. Use exact numbers from the data. End with one actionable recommendation."


def _format_prompt(user_query: str, result: dict) -> str:
    summary = result.get("summary", {})
    top_rows = result.get("data", [])[:3]
    metric = result.get("metric", "value")

    total = summary.get("total", "")
    max_label = summary.get("max_label", "")
    max_value = summary.get("max_value", "")

    rows_str = "; ".join(
        str({k: v for k, v in row.items()}) for row in top_rows
    )

    return (
        f"Q: {user_query}\n"
        f"Metric: {metric}. Total: {total}. Best: {max_label} ({max_value}).\n"
        f"Top rows: {rows_str}"
    )


def generate_insight(user_query: str, result: dict) -> str:
    global _last_used_fallback
    _last_used_fallback = False

    if result.get("error"):
        return result.get("message", "An unknown error occurred.")

    if not result.get("data"):
        return "No data was returned for this query. Try adjusting your filters or broadening the date range."

    prompt = _format_prompt(user_query, result)

    try:
        response = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[
                {"role": "system", "content": _SYSTEM_PROMPT},
                {"role": "user", "content": prompt},
            ],
            temperature=0.7,
            max_tokens=200,
        )
        insight = response.choices[0].message.content.strip()
        if insight.startswith('"') and insight.endswith('"'):
            insight = insight[1:-1].strip()
        return insight
    except Exception:
        _last_used_fallback = True
        summary = result.get("summary", {})
        max_label = summary.get("max_label", "N/A")
        max_value = summary.get("max_value", 0)
        metric = result.get("metric", "value").replace("_", " ")
        return f"Top performer: {max_label} with ${max_value:,.0f} in {metric}."
