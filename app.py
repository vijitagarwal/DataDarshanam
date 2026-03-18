# -*- coding: utf-8 -*-
import io
import json

import pandas as pd
import streamlit as st

import data_engine
import insight_gen
from chart_builder import build_chart
from data_engine import run_query
from llm_parser import parse_query, parse_dashboard_query

# ---------------------------------------------------------------------------
# Page config — must be the very first Streamlit call
# ---------------------------------------------------------------------------

st.set_page_config(
    page_title="dataदर्शनम्",
    page_icon="📊",
    layout="wide",
    initial_sidebar_state="collapsed",
)

# ---------------------------------------------------------------------------
# Session state
# ---------------------------------------------------------------------------

if "chat_history" not in st.session_state:
    st.session_state.chat_history = []
if "theme" not in st.session_state:
    st.session_state.theme = "dark"
if "pending_query" not in st.session_state:
    st.session_state.pending_query = None
if "custom_df" not in st.session_state:
    st.session_state.custom_df = None
if "query_count" not in st.session_state:
    st.session_state.query_count = 0

# Re-apply custom CSV patch on every rerun
if st.session_state.custom_df is not None:
    data_engine._DF = st.session_state.custom_df

# ---------------------------------------------------------------------------
# Theme logic
# ---------------------------------------------------------------------------

is_dark = st.session_state.theme == "dark"

bg_main    = "#0A0F1E" if is_dark else "#F0F4FF"
bg_card    = "#0F172A" if is_dark else "#FFFFFF"
bg_sidebar = "#0D1117" if is_dark else "#E8EEF8"
text_main  = "#FFFFFF" if is_dark else "#0F172A"
text_muted = "#64748B" if is_dark else "#475569"
border_col = "rgba(99,102,241,0.3)" if is_dark else "#C7D2FE"
accent     = "#6366F1"

# ---------------------------------------------------------------------------
# CSS generation (cached by theme)
# ---------------------------------------------------------------------------

@st.cache_resource(show_spinner=False)
def _generate_main_css(is_dark: bool) -> str:
    """Generate main CSS block cached by theme state."""
    bg_main_    = "#0A0F1E" if is_dark else "#F0F4FF"
    bg_card_    = "#0F172A" if is_dark else "#FFFFFF"
    bg_sidebar_ = "#0D1117" if is_dark else "#E8EEF8"
    text_main_  = "#FFFFFF" if is_dark else "#0F172A"
    text_muted_ = "#64748B" if is_dark else "#475569"
    border_col_ = "rgba(99,102,241,0.3)" if is_dark else "#C7D2FE"
    accent_     = "#6366F1"

    return f"""
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=Noto+Sans+Devanagari:wght@400;700;800&display=swap');

/* Reset and base */
html, body, [class*="css"] {{ font-family: 'Inter', 'Segoe UI', sans-serif; }}
.stApp {{
    background-color: {bg_main_} !important;
    color: {text_main_} !important;
}}

/* Hide sidebar completely */
section[data-testid="stSidebar"] {{
    display: none !important;
}}
[data-testid="collapsedControl"] {{
    display: none !important;
}}

/* Hide streamlit branding */
#MainMenu {{ visibility: hidden; }}
footer {{ visibility: hidden; }}
header {{ visibility: hidden; }}
.stDeployButton {{ display: none; }}

/* Cards */
.kpi-card {{
    background: {bg_card_};
    border: 1px solid {border_col_};
    border-radius: 16px;
    padding: 1.1rem 1.25rem;
    margin-bottom: 1rem;
    transition: border-color 0.2s ease;
}}
.kpi-card:hover {{ border-color: {accent_}; }}
.kpi-label {{
    font-size: 0.67rem;
    font-weight: 600;
    letter-spacing: 0.1em;
    color: {text_muted_};
    text-transform: uppercase;
    margin-bottom: 0.45rem;
}}
.kpi-value {{
    font-size: 1.65rem;
    font-weight: 700;
    color: {text_main_};
    line-height: 1.1;
    letter-spacing: -0.01em;
}}
.kpi-subtitle {{
    font-size: 0.72rem;
    color: {accent_};
    margin-top: 0.28rem;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}}

.insight-card {{
    background: {bg_card_};
    border: 1px solid {border_col_};
    border-radius: 16px;
    padding: 1rem 1.1rem;
    margin-bottom: 0.75rem;
}}
.insight-header {{
    font-size: 0.67rem;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: #10B981;
    margin-bottom: 0.45rem;
    font-weight: 600;
}}
.insight-text {{
    font-size: 0.84rem;
    color: {text_muted_};
    line-height: 1.65;
}}

.chart-card {{
    background: {bg_card_};
    border: 1px solid {border_col_};
    border-radius: 16px;
    padding: 1rem 0.75rem 0.5rem;
    margin-bottom: 1rem;
}}

.summary-card {{
    background: {bg_card_};
    border: 1px solid {border_col_};
    border-radius: 16px;
    padding: 0.9rem 1rem;
}}
.summary-header {{
    font-size: 0.67rem;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: {accent_};
    margin-bottom: 0.55rem;
    font-weight: 600;
}}

/* User chat bubble */
.chat-user-row {{
    display: flex;
    justify-content: flex-end;
    margin: 0.5rem 0 1.25rem;
}}
.chat-bubble-user {{
    background: linear-gradient(135deg, #6366F1, #8B5CF6);
    border-radius: 18px 18px 4px 18px;
    padding: 0.7rem 1.1rem;
    color: #fff !important;
    font-size: 0.93rem;
    max-width: 66%;
    box-shadow: 0 4px 20px rgba(99,102,241,0.28);
    line-height: 1.5;
}}

/* Divider */
.chat-divider {{
    border: none;
    border-top: 1px solid {border_col_};
    margin: 0.5rem 0 1.75rem;
}}

/* Dashboard section header */
.dashboard-section-header {{
    font-size: 1.05rem;
    font-weight: 700;
    color: {text_main_};
    background: linear-gradient(135deg, rgba(99,102,241,0.12), rgba(139,92,246,0.06));
    border: 1px solid {border_col_};
    border-radius: 12px;
    padding: 0.65rem 1rem;
    margin-bottom: 1rem;
    letter-spacing: -0.01em;
}}

/* Mini stat chips */
.mini-stat {{
    background: rgba(99,102,241,0.08);
    border: 1px solid {border_col_};
    border-radius: 10px;
    padding: 0.55rem 0.8rem;
    margin-bottom: 0.6rem;
}}
.mini-stat-label {{
    font-size: 0.63rem;
    text-transform: uppercase;
    letter-spacing: 0.09em;
    color: {text_muted_};
    margin-bottom: 0.2rem;
    font-weight: 600;
}}
.mini-stat-value {{
    font-size: 1.15rem;
    font-weight: 700;
    color: {text_main_};
    line-height: 1.2;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}}

/* Col pills (CSV upload) */
.col-pill {{
    display: inline-block;
    background: rgba(99,102,241,0.12);
    border: 1px solid rgba(99,102,241,0.25);
    color: #A5B4FC;
    border-radius: 20px;
    padding: 0.12rem 0.5rem;
    font-size: 0.7rem;
    margin: 0.12rem 0.08rem;
}}

/* Chat input */
.stChatInput > div {{
    background: {bg_card_} !important;
    border: 1px solid {border_col_} !important;
    border-radius: 28px !important;
}}
.stChatInput textarea {{
    color: {text_main_} !important;
    background: {bg_card_} !important;
    caret-color: {text_main_} !important;
}}
.stChatInput textarea::placeholder {{
    color: {text_muted_} !important;
}}
/* The send button icon color */
.stChatInput button svg {{
    fill: {text_main_} !important;
}}

/* Buttons */
.stButton > button {{
    background: transparent !important;
    border: 1px solid {border_col_} !important;
    color: {text_main_} !important;
    border-radius: 10px !important;
    text-align: left !important;
    width: 100% !important;
    padding: 8px 12px !important;
    font-size: 13px !important;
    transition: all 0.2s !important;
}}
.stButton > button:hover {{
    background: {accent_} !important;
    border-color: {accent_} !important;
    color: white !important;
}}

/* Primary button (Generate Full Dashboard) */
[data-testid="stBaseButton-primary"] {{
    background: linear-gradient(135deg, #6366F1, #8B5CF6) !important;
    border: none !important;
    color: #fff !important;
    border-radius: 10px !important;
    font-weight: 600 !important;
    box-shadow: 0 4px 15px rgba(99,102,241,0.32) !important;
    transition: all 0.15s ease !important;
}}
[data-testid="stBaseButton-primary"]:hover {{
    transform: translateY(-1px) !important;
    box-shadow: 0 6px 22px rgba(99,102,241,0.45) !important;
}}

/* Main content padding */
.block-container {{
    padding: 2rem 2.5rem 6rem 2.5rem !important;
    max-width: 1440px !important;
}}

/* Expander */
.stExpander {{
    border: 1px solid {border_col_} !important;
    border-radius: 12px !important;
    background-color: {bg_card_} !important;
}}

/* Skeleton shimmer */
@keyframes shimmer {{
    0%   {{ background-position: 200% 0; }}
    100% {{ background-position: -200% 0; }}
}}
.skeleton-block {{
    background: linear-gradient(90deg, #1E293B 25%, #28364D 50%, #1E293B 75%);
    background-size: 200% 100%;
    animation: shimmer 1.6s ease-in-out infinite;
    border-radius: 12px;
}}

[data-testid="stDataFrame"] {{ border-radius: 10px; overflow: hidden; }}
.stSpinner > div {{ color: {accent_} !important; }}
[data-testid="stFileUploader"] {{
    background: rgba(99,102,241,0.04);
    border: 1px dashed {border_col_};
    border-radius: 10px;
    padding: 0.4rem;
}}
</style>
"""

st.markdown(_generate_main_css(is_dark), unsafe_allow_html=True)

# ---------------------------------------------------------------------------
# Main header
# ---------------------------------------------------------------------------

_REVENUE_METRICS = {"total_revenue", "discounted_price", "price"}


def _fmt_number(val: float, metric: str = "") -> str:
    prefix = "$" if metric in _REVENUE_METRICS or "revenue" in metric or "price" in metric else ""
    abs_val = abs(val)
    if abs_val >= 1_000_000:
        return f"{prefix}{val / 1_000_000:.2f}M"
    if abs_val >= 1_000:
        return f"{prefix}{val / 1_000:.1f}K"
    return f"{prefix}{val:,.2f}"


def _kpi_card(label: str, value: str, subtitle: str = "") -> str:
    sub = f'<div class="kpi-subtitle">{subtitle}</div>' if subtitle else ""
    return (
        f'<div class="kpi-card">'
        f'<div class="kpi-label">{label}</div>'
        f'<div class="kpi-value">{value}</div>'
        f'{sub}'
        f'</div>'
    )


def _insight_card(text: str) -> str:
    return (
        f'<div class="insight-card">'
        f'<div class="insight-header">💡 AI Insight</div>'
        f'<div class="insight-text">{text}</div>'
        f'</div>'
    )


def _skeleton_html() -> str:
    kpi = '<div class="skeleton-block" style="height:90px;margin-bottom:1rem;"></div>'
    return f"""
    <div style="display:flex;gap:1rem;margin-bottom:1rem;">
        {kpi}{kpi}{kpi}{kpi}
    </div>
    <div style="display:flex;gap:1rem;">
        <div style="flex:7;">
            <div class="skeleton-block" style="height:400px;"></div>
        </div>
        <div style="flex:3;display:flex;flex-direction:column;gap:0.75rem;">
            <div class="skeleton-block" style="height:130px;"></div>
            <div class="skeleton-block" style="height:220px;"></div>
        </div>
    </div>
    """

# ---------------------------------------------------------------------------
# Main header
# ---------------------------------------------------------------------------

col_title, col_counter = st.columns([4, 1])
with col_title:
    st.markdown(f"""
    <div style="margin-bottom:4px;">
      <span style="font-size:40px; font-weight:900; color:{text_main};">data</span><span
            style="font-size:40px; font-weight:900; color:{accent};
                   font-family:'Noto Sans Devanagari',sans-serif;">दर्शनम्</span>
    </div>
    <div style="color:{text_muted}; font-size:13px; margin-bottom:24px;">
      Powered by Groq LLaMA 3.3 · Natural language → instant charts
    </div>
    """, unsafe_allow_html=True)
with col_counter:
    count = len(st.session_state.chat_history)
    st.markdown(f"""
    <div style="text-align:right; padding-top:12px;
                color:{text_muted}; font-size:13px;">
      📊 {count} quer{"y" if count == 1 else "ies"} answered
    </div>
    """, unsafe_allow_html=True)

# ---------------------------------------------------------------------------
# Inline Controls - ROW 1
# ---------------------------------------------------------------------------

ctrl1, ctrl2, ctrl3 = st.columns([1, 1, 2])

with ctrl1:
    # Theme toggle
    current_theme = "🌙 Dark" if st.session_state.theme == "dark" else "☀️ Light"
    theme_idx = 0 if st.session_state.theme == "dark" else 1
    theme_choice = st.radio(
        "Theme",
        ["🌙 Dark", "☀️ Light"],
        index=theme_idx,
        horizontal=True,
        key="theme_radio",
        label_visibility="collapsed"
    )
    if "Dark" in theme_choice and st.session_state.theme != "dark":
        st.session_state.theme = "dark"
        st.rerun()
    elif "Light" in theme_choice and st.session_state.theme != "light":
        st.session_state.theme = "light"
        st.rerun()

with ctrl2:
    # CSV Upload
    uploaded_file = st.file_uploader(
        "Upload CSV",
        type="csv",
        label_visibility="collapsed",
        key="csv_uploader"
    )
    if uploaded_file is not None:
        try:
            raw = uploaded_file.getvalue().decode("utf-8")
            df_up = pd.read_csv(io.StringIO(raw))
            df_up = data_engine.prepare_dataframe(df_up)
            st.session_state.custom_df = df_up
            data_engine._DF = df_up
            st.success(f"✓ Loaded {len(df_up):,} rows")
        except Exception as exc:
            st.error(f"Could not read file: {exc}")
    else:
        if st.session_state.custom_df is None:
            st.caption("📂 Default: sales.csv · 2022–2023")

with ctrl3:
    # Generate dashboard button + clear chat
    bcol1, bcol2 = st.columns([3, 1])
    with bcol1:
        if st.button("📊 Generate Full Dashboard",
                     type="primary",
                     use_container_width=True,
                     key="gen_dashboard"):
            st.session_state.pending_query = "generate full dashboard overview"
            st.rerun()
    with bcol2:
        if st.button("🗑️ Clear", use_container_width=True, key="clear_chat"):
            st.session_state.chat_history = []
            st.session_state.query_count = 0
            st.rerun()

st.divider()

# ---------------------------------------------------------------------------
# Inline Controls - ROW 2: Example Queries
# ---------------------------------------------------------------------------

st.markdown(f"<div style='font-size:12px; font-weight:600; color:{text_muted}; letter-spacing:1px; margin-bottom:8px;'>✨ TRY THESE EXAMPLES</div>", unsafe_allow_html=True)

ex1, ex2, ex3, ex4, ex5 = st.columns(5)
examples = {
    ex1: "Revenue by region",
    ex2: "Monthly trend for 2023",
    ex3: "Top categories by rating",
    ex4: "Payment method breakdown",
    ex5: "Q3 2023 performance",
}
for col, example in examples.items():
    with col:
        if st.button(example, use_container_width=True, key=f"example_{example}"):
            st.session_state.pending_query = example
            st.rerun()

st.divider()

st.markdown("<div style='margin-bottom:24px;'></div>", unsafe_allow_html=True)

# ---------------------------------------------------------------------------
# Render functions
# ---------------------------------------------------------------------------

def _render_mini_chart(chart: dict, index: int = 0) -> None:
    """Compact chart card used inside the 3-chart dashboard grid."""
    result = chart["result"]
    fig    = chart["fig"]

    if result.get("error"):
        st.error(result.get("message", "Error rendering chart."))
        return

    summary = result.get("summary", {})
    metric  = result.get("metric", "value")

    s1, s2 = st.columns(2, gap="small")
    with s1:
        st.markdown(
            f'<div class="mini-stat">'
            f'<div class="mini-stat-label">Total</div>'
            f'<div class="mini-stat-value">{_fmt_number(summary.get("total", 0), metric)}</div>'
            f'</div>',
            unsafe_allow_html=True,
        )
    with s2:
        top_label = summary.get("max_label") or "—"
        st.markdown(
            f'<div class="mini-stat">'
            f'<div class="mini-stat-label">Top Performer</div>'
            f'<div class="mini-stat-value">{top_label}</div>'
            f'</div>',
            unsafe_allow_html=True,
        )

    st.markdown('<div class="chart-card">', unsafe_allow_html=True)
    st.plotly_chart(
        fig,
        use_container_width=True,
        key=f"dash_chart_{index}",
        config={
            'displayModeBar': True,
            'displaylogo': False,
            'modeBarButtonsToAdd': ['resetScale2d'],
            'modeBarButtonsToRemove': ['lasso2d', 'select2d'],
            'scrollZoom': True,
            'doubleClick': 'reset'
        }
    )
    st.markdown('</div>', unsafe_allow_html=True)


def _render_dashboard_entry(entry: dict) -> None:
    """Render the 3-chart dashboard grid from a dashboard pipeline entry."""
    query  = entry["query"]
    charts = entry["charts"]

    st.markdown(
        f'<div class="chat-user-row"><div class="chat-bubble-user">{query}</div></div>',
        unsafe_allow_html=True,
    )
    st.markdown(
        '<div class="dashboard-section-header">📊 Sales Overview Dashboard</div>',
        unsafe_allow_html=True,
    )

    if len(charts) >= 2:
        col_a, col_b = st.columns(2, gap="medium")
        with col_a:
            _render_mini_chart(charts[0], index=0)
        with col_b:
            _render_mini_chart(charts[1], index=1)

    if len(charts) >= 3:
        _render_mini_chart(charts[2], index=2)

    st.markdown('<hr class="chat-divider">', unsafe_allow_html=True)


def _render_entry(entry: dict) -> None:
    query   = entry["query"]
    result  = entry["result"]
    fig     = entry["fig"]
    insight = entry["insight"]

    st.markdown(
        f'<div class="chat-user-row">'
        f'<div class="chat-bubble-user">{query}</div>'
        f'</div>',
        unsafe_allow_html=True,
    )

    if result.get("error"):
        st.error(result.get("message", "An unknown error occurred."))
        if st.session_state.get("debug_mode") and "parsed" in entry:
            with st.expander("🔍 Debug: LLM Parsed Query"):
                st.json(entry["parsed"])
        st.markdown('<hr class="chat-divider">', unsafe_allow_html=True)
        return

    summary   = result.get("summary", {})
    metric    = result.get("metric", "value")
    data_rows = result.get("data", [])

    # Row 1: 4 KPI tiles
    k1, k2, k3, k4 = st.columns(4, gap="medium")
    with k1:
        st.markdown(_kpi_card("Total", _fmt_number(summary.get("total", 0), metric)), unsafe_allow_html=True)
    with k2:
        st.markdown(_kpi_card("Avg per Group", _fmt_number(summary.get("average", 0), metric)), unsafe_allow_html=True)
    with k3:
        st.markdown(_kpi_card("Top Performer", summary.get("max_label") or "—"), unsafe_allow_html=True)
    with k4:
        st.markdown(_kpi_card("Top Value", _fmt_number(summary.get("max_value", 0), metric)), unsafe_allow_html=True)

    # Row 2: chart (70%) | insight + table (30%)
    col_chart, col_right = st.columns([7, 3], gap="medium")

    with col_chart:
        st.markdown('<div class="chart-card">', unsafe_allow_html=True)
        st.plotly_chart(
        fig,
        use_container_width=True,
        key=f"chart_{hash(str(result.get('title','')))}",
        config={
            'displayModeBar': True,
            'displaylogo': False,
            'modeBarButtonsToAdd': ['resetScale2d'],
            'modeBarButtonsToRemove': ['lasso2d', 'select2d'],
            'scrollZoom': True,
            'doubleClick': 'reset'
        }
    )
        st.markdown('</div>', unsafe_allow_html=True)

    with col_right:
        st.markdown(_insight_card(insight), unsafe_allow_html=True)

        if data_rows:
            st.markdown(
                '<div class="summary-card">'
                '<div class="summary-header">📋 Data Summary</div>'
                '</div>',
                unsafe_allow_html=True,
            )
            st.dataframe(pd.DataFrame(data_rows).head(5), use_container_width=True, hide_index=True)

    # Row 3: full dataset expander
    if data_rows:
        with st.expander("View Full Dataset", expanded=False):
            st.dataframe(pd.DataFrame(data_rows), use_container_width=True, hide_index=True)

    if st.session_state.get("debug_mode") and "parsed" in entry:
        with st.expander("🔍 Debug: LLM Parsed Query"):
            st.json(entry["parsed"])

    st.markdown('<hr class="chat-divider">', unsafe_allow_html=True)

# ---------------------------------------------------------------------------
# Pipeline functions
# ---------------------------------------------------------------------------

def _run_pipeline(query: str) -> None:
    _is_dark = st.session_state.theme == "dark"
    previous_context = None
    if st.session_state.chat_history:
        last = st.session_state.chat_history[-1]
        if last.get("result") and not last["result"].get("error"):
            previous_context = last["result"]

    with st.spinner("🧠 Analyzing your query…"):
        parsed = parse_query(query, previous_context=previous_context)

        if parsed.get("error"):
            entry = {
                "query":   query,
                "parsed":  parsed,
                "result":  parsed,
                "fig":     build_chart(parsed, is_dark=_is_dark),
                "insight": parsed.get("message", ""),
            }
            st.session_state.chat_history.append(entry)
            _render_entry(entry)
            return

        st.toast("✅ Query parsed successfully")
        result  = run_query(parsed)
        fig     = build_chart(result, is_dark=_is_dark)
        insight = insight_gen.generate_insight(query, result)
        if insight_gen._last_used_fallback:
            st.toast("⚠️ Using fallback response")

    entry = {
        "query":   query,
        "parsed":  parsed,
        "result":  result,
        "fig":     fig,
        "insight": insight,
    }
    st.session_state.chat_history.append(entry)
    if not result.get("error"):
        st.session_state.query_count += 1
    _render_entry(entry)


def _run_dashboard_pipeline(query: str) -> None:
    _is_dark = st.session_state.theme == "dark"
    dashboard_queries = parse_dashboard_query(query)
    charts = []
    with st.spinner("📊 Building your full dashboard…"):
        for p in dashboard_queries:
            result = run_query(p)
            fig    = build_chart(result, is_dark=_is_dark)
            charts.append({"parsed": p, "result": result, "fig": fig})

    entry = {"type": "dashboard", "query": query, "charts": charts}
    st.session_state.chat_history.append(entry)
    st.session_state.query_count += sum(
        1 for c in charts if not c["result"].get("error")
    )
    _render_dashboard_entry(entry)

# ---------------------------------------------------------------------------
# Render chat history
# ---------------------------------------------------------------------------

for entry in st.session_state.chat_history:
    if entry.get("type") == "dashboard":
        _render_dashboard_entry(entry)
    else:
        _render_entry(entry)

# ---------------------------------------------------------------------------
# Chat input
# ---------------------------------------------------------------------------

query_input   = st.chat_input("Ask a question about your sales data…")
pending_query = st.session_state.pop("pending_query", None)
active_query  = query_input or pending_query

if active_query:
    _skeleton_ph = st.empty()
    _skeleton_ph.markdown(_skeleton_html(), unsafe_allow_html=True)
    if parse_dashboard_query(active_query) is not None:
        _run_dashboard_pipeline(active_query)
    else:
        _run_pipeline(active_query)
    _skeleton_ph.empty()
