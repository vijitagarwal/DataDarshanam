import io

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
    page_title="InsightAI",
    layout="wide",
    page_icon="📊",
    initial_sidebar_state="expanded",
)

# ---------------------------------------------------------------------------
# Premium dark SaaS CSS
# ---------------------------------------------------------------------------

st.markdown(
    """
    <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');

    /* ── Global ─────────────────────────────────────────── */
    html, body, [class*="css"] { font-family: 'Inter', 'Segoe UI', sans-serif; }
    .stApp { background-color: #0A0F1E; color: #F1F5F9; }

    /* ── Sidebar ────────────────────────────────────────── */
    section[data-testid="stSidebar"] {
        background-color: #0D1117 !important;
        border-right: 1px solid rgba(99,102,241,0.18) !important;
    }
    section[data-testid="stSidebar"] > div:first-child { padding-top: 0 !important; }
    section[data-testid="stSidebar"] * { color: #CBD5E1 !important; }

    /* Sidebar example-query buttons */
    section[data-testid="stSidebar"] .stButton > button {
        background: rgba(99,102,241,0.07) !important;
        color: #A5B4FC !important;
        border: 1px solid rgba(99,102,241,0.22) !important;
        border-radius: 8px !important;
        width: 100% !important;
        text-align: left !important;
        padding: 0.45rem 0.8rem !important;
        font-size: 0.81rem !important;
        margin-bottom: 4px !important;
        transition: all 0.15s ease !important;
        font-weight: 400 !important;
    }
    section[data-testid="stSidebar"] .stButton > button:hover {
        background: rgba(99,102,241,0.2) !important;
        border-color: #6366F1 !important;
        color: #fff !important;
    }

    /* ── Hide Streamlit chrome ──────────────────────────── */
    #MainMenu       { visibility: hidden; }
    footer          { visibility: hidden; }
    header          { visibility: hidden; }
    .stDeployButton { display: none; }

    /* ── Main content padding ───────────────────────────── */
    .block-container {
        padding-top: 1.75rem !important;
        padding-bottom: 6rem !important;
        padding-left: 2.5rem !important;
        padding-right: 2.5rem !important;
        max-width: 1440px !important;
    }

    /* ── Dashboard header ───────────────────────────────── */
    .dash-header h1 {
        font-size: 2.3rem;
        font-weight: 800;
        background: linear-gradient(135deg, #6366F1 0%, #8B5CF6 45%, #EC4899 100%);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
        margin: 0 0 0.3rem;
        letter-spacing: -0.025em;
        line-height: 1.15;
    }
    .dash-header p {
        color: #475569;
        font-size: 0.88rem;
        margin: 0 0 0.6rem;
    }
    .query-counter {
        display: inline-flex;
        align-items: center;
        gap: 0.35rem;
        background: rgba(99,102,241,0.1);
        border: 1px solid rgba(99,102,241,0.25);
        border-radius: 20px;
        padding: 0.22rem 0.8rem;
        font-size: 0.77rem;
        color: #A5B4FC;
        font-weight: 500;
    }

    /* ── User chat bubble ───────────────────────────────── */
    .chat-user-row {
        display: flex;
        justify-content: flex-end;
        margin: 0.5rem 0 1.25rem;
    }
    .chat-bubble-user {
        background: linear-gradient(135deg, #6366F1, #8B5CF6);
        border-radius: 18px 18px 4px 18px;
        padding: 0.7rem 1.1rem;
        color: #fff !important;
        font-size: 0.93rem;
        max-width: 66%;
        box-shadow: 0 4px 20px rgba(99,102,241,0.28);
        line-height: 1.5;
    }

    /* ── KPI tiles ──────────────────────────────────────── */
    .kpi-card {
        background: #0F172A;
        border: 1px solid rgba(99,102,241,0.25);
        border-radius: 16px;
        padding: 1.1rem 1.25rem;
        margin-bottom: 1rem;
        transition: border-color 0.2s ease;
    }
    .kpi-card:hover { border-color: rgba(99,102,241,0.55); }
    .kpi-label {
        font-size: 0.67rem;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        color: #64748B;
        margin-bottom: 0.45rem;
        font-weight: 600;
    }
    .kpi-value {
        font-size: 1.65rem;
        font-weight: 700;
        color: #F1F5F9;
        line-height: 1.1;
        letter-spacing: -0.01em;
    }
    .kpi-subtitle {
        font-size: 0.72rem;
        color: #6366F1;
        margin-top: 0.28rem;
        font-weight: 500;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    /* ── Chart wrapper card ─────────────────────────────── */
    .chart-card {
        background: #0F172A;
        border: 1px solid rgba(99,102,241,0.22);
        border-radius: 16px;
        padding: 1rem 0.75rem 0.5rem;
        margin-bottom: 1rem;
    }

    /* ── Insight card ───────────────────────────────────── */
    .insight-card {
        background: rgba(16,185,129,0.06);
        border: 1px solid rgba(16,185,129,0.22);
        border-radius: 16px;
        padding: 1rem 1.1rem;
        margin-bottom: 0.75rem;
    }
    .insight-header {
        font-size: 0.67rem;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        color: #10B981;
        margin-bottom: 0.45rem;
        font-weight: 600;
    }
    .insight-text {
        font-size: 0.84rem;
        color: #CBD5E1;
        line-height: 1.65;
    }

    /* ── Data summary card ──────────────────────────────── */
    .summary-card {
        background: #0F172A;
        border: 1px solid rgba(99,102,241,0.2);
        border-radius: 16px;
        padding: 0.9rem 1rem;
    }
    .summary-header {
        font-size: 0.67rem;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        color: #6366F1;
        margin-bottom: 0.55rem;
        font-weight: 600;
    }

    /* ── Divider ────────────────────────────────────────── */
    .chat-divider {
        border: none;
        border-top: 1px solid rgba(99,102,241,0.1);
        margin: 0.5rem 0 1.75rem;
    }

    /* ── Chat input ─────────────────────────────────────── */
    .stChatInput { background-color: #0D1117 !important; }
    .stChatInput textarea {
        background-color: #0D1117 !important;
        color: #E2E8F0 !important;
        border: 1px solid rgba(99,102,241,0.35) !important;
        border-radius: 14px !important;
        font-size: 0.93rem !important;
    }
    .stChatInput textarea:focus {
        border-color: #6366F1 !important;
        box-shadow: 0 0 0 3px rgba(99,102,241,0.15) !important;
    }

    /* ── Expander ───────────────────────────────────────── */
    .stExpander {
        border: 1px solid rgba(99,102,241,0.18) !important;
        border-radius: 12px !important;
        background-color: #0F172A !important;
    }

    /* ── Misc widgets ───────────────────────────────────── */
    .stSpinner > div { color: #6366F1 !important; }
    [data-testid="stFileUploader"] {
        background: rgba(99,102,241,0.04);
        border: 1px dashed rgba(99,102,241,0.28);
        border-radius: 10px;
        padding: 0.4rem;
    }
    .col-pill {
        display: inline-block;
        background: rgba(99,102,241,0.12);
        border: 1px solid rgba(99,102,241,0.25);
        color: #A5B4FC;
        border-radius: 20px;
        padding: 0.12rem 0.5rem;
        font-size: 0.7rem;
        margin: 0.12rem 0.08rem;
    }

    /* ── Skeleton shimmer ───────────────────────────────── */
    @keyframes shimmer {
        0%   { background-position: 200% 0; }
        100% { background-position: -200% 0; }
    }
    .skeleton-block {
        background: linear-gradient(90deg, #1E293B 25%, #28364D 50%, #1E293B 75%);
        background-size: 200% 100%;
        animation: shimmer 1.6s ease-in-out infinite;
        border-radius: 12px;
    }

    [data-testid="stDataFrame"] { border-radius: 10px; overflow: hidden; }

    /* ── Dashboard section header ───────────────────────── */
    .dashboard-section-header {
        font-size: 1.05rem;
        font-weight: 700;
        color: #E2E8F0;
        background: linear-gradient(135deg, rgba(99,102,241,0.12), rgba(139,92,246,0.06));
        border: 1px solid rgba(99,102,241,0.3);
        border-radius: 12px;
        padding: 0.65rem 1rem;
        margin-bottom: 1rem;
        letter-spacing: -0.01em;
    }

    /* ── Mini stat chips (dashboard grid) ───────────────── */
    .mini-stat {
        background: rgba(99,102,241,0.08);
        border: 1px solid rgba(99,102,241,0.2);
        border-radius: 10px;
        padding: 0.55rem 0.8rem;
        margin-bottom: 0.6rem;
    }
    .mini-stat-label {
        font-size: 0.63rem;
        text-transform: uppercase;
        letter-spacing: 0.09em;
        color: #64748B;
        margin-bottom: 0.2rem;
        font-weight: 600;
    }
    .mini-stat-value {
        font-size: 1.15rem;
        font-weight: 700;
        color: #F1F5F9;
        line-height: 1.2;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    /* ── Generate Full Dashboard primary button ─────────── */
    [data-testid="stBaseButton-primary"] {
        background: linear-gradient(135deg, #6366F1, #8B5CF6) !important;
        border: none !important;
        color: #fff !important;
        border-radius: 10px !important;
        font-weight: 600 !important;
        box-shadow: 0 4px 15px rgba(99,102,241,0.32) !important;
        transition: all 0.15s ease !important;
    }
    [data-testid="stBaseButton-primary"]:hover {
        transform: translateY(-1px) !important;
        box-shadow: 0 6px 22px rgba(99,102,241,0.45) !important;
    }
    </style>
    """,
    unsafe_allow_html=True,
)

# ---------------------------------------------------------------------------
# Session state
# ---------------------------------------------------------------------------

if "chat_history" not in st.session_state:
    st.session_state.chat_history = []

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
# Helpers
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


def _render_mini_chart(chart: dict) -> None:
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
    st.plotly_chart(fig, use_container_width=True, config={"displayModeBar": False})
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

    # Row 1: first two charts side by side
    if len(charts) >= 2:
        col_a, col_b = st.columns(2, gap="medium")
        with col_a:
            _render_mini_chart(charts[0])
        with col_b:
            _render_mini_chart(charts[1])

    # Row 2: third chart full width
    if len(charts) >= 3:
        _render_mini_chart(charts[2])

    st.markdown('<hr class="chat-divider">', unsafe_allow_html=True)


def _render_entry(entry: dict) -> None:
    query   = entry["query"]
    result  = entry["result"]
    fig     = entry["fig"]
    insight = entry["insight"]

    # ── User bubble ──────────────────────────────────────────
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

    # ── Row 1: 4 KPI tiles ───────────────────────────────────
    k1, k2, k3, k4 = st.columns(4, gap="medium")

    with k1:
        total_val = summary.get("total", 0)
        st.markdown(_kpi_card("Total", _fmt_number(total_val, metric)), unsafe_allow_html=True)

    with k2:
        avg_val = summary.get("average", 0)
        st.markdown(_kpi_card("Avg per Group", _fmt_number(avg_val, metric)), unsafe_allow_html=True)

    with k3:
        top_label = summary.get("max_label") or "—"
        st.markdown(_kpi_card("Top Performer", top_label), unsafe_allow_html=True)

    with k4:
        top_val = summary.get("max_value", 0)
        st.markdown(_kpi_card("Top Value", _fmt_number(top_val, metric)), unsafe_allow_html=True)

    # ── Row 2: chart (70%) | insight + table (30%) ───────────
    col_chart, col_right = st.columns([7, 3], gap="medium")

    with col_chart:
        st.markdown('<div class="chart-card">', unsafe_allow_html=True)
        st.plotly_chart(fig, use_container_width=True, config={"displayModeBar": False})
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
            top5 = pd.DataFrame(data_rows).head(5)
            st.dataframe(top5, use_container_width=True, hide_index=True)

    # ── Row 3: full dataset expander ─────────────────────────
    if data_rows:
        with st.expander("View Full Dataset", expanded=False):
            st.dataframe(
                pd.DataFrame(data_rows),
                use_container_width=True,
                hide_index=True,
            )

    # ── Debug info (when toggle is on) ────────────────────────
    if st.session_state.get("debug_mode") and "parsed" in entry:
        with st.expander("🔍 Debug: LLM Parsed Query"):
            st.json(entry["parsed"])

    st.markdown('<hr class="chat-divider">', unsafe_allow_html=True)


def _run_pipeline(query: str) -> None:
    previous_context = None
    if st.session_state.chat_history:
        last = st.session_state.chat_history[-1]
        if not last["result"].get("error"):
            previous_context = last["result"]

    with st.spinner("🧠 Analyzing your query…"):
        parsed = parse_query(query, previous_context=previous_context)

        if parsed.get("error"):
            entry = {
                "query":   query,
                "parsed":  parsed,
                "result":  parsed,
                "fig":     build_chart(parsed),
                "insight": parsed.get("message", ""),
            }
            st.session_state.chat_history.append(entry)
            _render_entry(entry)
            return

        st.toast("✅ Query parsed successfully")
        result  = run_query(parsed)
        fig     = build_chart(result)
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
    """Run the 3 hardcoded dashboard queries and render the grid."""
    dashboard_queries = parse_dashboard_query(query)
    charts = []
    with st.spinner("📊 Building your full dashboard…"):
        for p in dashboard_queries:
            result = run_query(p)
            fig    = build_chart(result)
            charts.append({"parsed": p, "result": result, "fig": fig})

    entry = {"type": "dashboard", "query": query, "charts": charts}
    st.session_state.chat_history.append(entry)
    st.session_state.query_count += sum(
        1 for c in charts if not c["result"].get("error")
    )
    _render_dashboard_entry(entry)


# ---------------------------------------------------------------------------
# Sidebar
# ---------------------------------------------------------------------------

with st.sidebar:
    # Brand
    st.markdown(
        """
        <div style="padding:1.5rem 0.5rem 0.75rem;">
            <div style="font-size:1.65rem;font-weight:800;color:#E2E8F0;letter-spacing:-0.02em;">
                📊 InsightAI
            </div>
            <div style="font-size:0.78rem;color:#475569;margin-top:0.25rem;font-weight:500;">
                Business Intelligence, Simplified
            </div>
        </div>
        """,
        unsafe_allow_html=True,
    )

    st.markdown(
        '<hr style="border:none;border-top:1px solid rgba(99,102,241,0.18);margin:0 0 1.25rem;">',
        unsafe_allow_html=True,
    )

    # Data Source
    st.markdown(
        '<div style="font-size:0.67rem;color:#6366F1;text-transform:uppercase;'
        'letter-spacing:0.1em;font-weight:600;margin-bottom:0.5rem;">📁 Data Source</div>',
        unsafe_allow_html=True,
    )

    uploaded_file = st.file_uploader(
        "Upload CSV",
        type="csv",
        label_visibility="collapsed",
    )

    if uploaded_file is not None:
        try:
            raw   = uploaded_file.getvalue().decode("utf-8")
            df_up = pd.read_csv(io.StringIO(raw))
            if "order_date" in df_up.columns:
                df_up["order_date"] = pd.to_datetime(df_up["order_date"], errors="coerce")
                df_up["year"]       = df_up["order_date"].dt.year
                df_up["month"]      = df_up["order_date"].dt.month
                df_up["month_name"] = df_up["order_date"].dt.strftime("%b")
                df_up["quarter"]    = df_up["order_date"].dt.quarter
            st.session_state.custom_df = df_up
            data_engine._DF = df_up
            st.success(f"✓ Loaded {len(df_up):,} rows")
            pills = "".join(f'<span class="col-pill">{c}</span>' for c in df_up.columns)
            st.markdown(
                f'<div style="margin-top:0.4rem;line-height:2.2;">{pills}</div>',
                unsafe_allow_html=True,
            )
        except Exception as exc:
            st.error(f"Could not read file: {exc}")
    else:
        if st.session_state.custom_df is None:
            st.caption("Default · sales.csv · 2022–2023")
        else:
            st.caption("Custom CSV active. Re-upload to change.")

    st.markdown(
        '<hr style="border:none;border-top:1px solid rgba(99,102,241,0.12);margin:1.25rem 0;">',
        unsafe_allow_html=True,
    )

    # Example Queries
    st.markdown(
        '<div style="font-size:0.67rem;color:#6366F1;text-transform:uppercase;'
        'letter-spacing:0.1em;font-weight:600;margin-bottom:0.6rem;">✨ Example Queries</div>',
        unsafe_allow_html=True,
    )

    _EXAMPLES = [
        "Revenue by region",
        "Monthly trend for 2023",
        "Top categories by rating",
        "Payment method breakdown",
        "Q3 2023 performance",
    ]

    for ex in _EXAMPLES:
        if st.button(ex, key=f"ex_{hash(ex)}"):
            st.session_state.pending_query = ex
            st.rerun()

    st.markdown(
        '<hr style="border:none;border-top:1px solid rgba(99,102,241,0.12);margin:1.25rem 0;">',
        unsafe_allow_html=True,
    )

    # Clear chat
    if st.button("🗑️ Clear Chat", key="clear_chat"):
        st.session_state.chat_history = []
        st.session_state.query_count  = 0
        st.rerun()

    st.markdown(
        '<hr style="border:none;border-top:1px solid rgba(99,102,241,0.12);margin:1.25rem 0;">',
        unsafe_allow_html=True,
    )

    # Debug toggle
    st.checkbox("🔍 Show Query Debug Info", key="debug_mode", value=False)

    # Footer
    st.markdown(
        '<div style="margin-top:1.5rem;text-align:center;font-size:0.71rem;color:#334155;">'
        'Built with Groq LLaMA 3.3'
        '</div>',
        unsafe_allow_html=True,
    )

# ---------------------------------------------------------------------------
# Header
# ---------------------------------------------------------------------------

count = st.session_state.query_count
st.markdown(
    f"""
    <div class="dash-header">
        <h1>Ask Your Data Anything</h1>
        <p>Powered by Groq LLaMA 3.3 · Natural language → instant charts</p>
        <div class="query-counter">📊 {count} {"query" if count == 1 else "queries"} answered</div>
    </div>
    """,
    unsafe_allow_html=True,
)

if st.button("📊 Generate Full Dashboard", key="btn_full_dashboard", type="primary"):
    st.session_state.pending_query = "Give me a full dashboard overview"
    st.rerun()

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
