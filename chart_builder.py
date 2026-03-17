# -*- coding: utf-8 -*-
import pandas as pd
import plotly.express as px
import plotly.graph_objects as go

# ---------------------------------------------------------------------------
# Design tokens
# ---------------------------------------------------------------------------

PALETTE = ["#6366F1", "#8B5CF6", "#EC4899", "#F59E0B", "#10B981", "#3B82F6"]

_BG_PLOT  = "#0F172A"
_BG_PAPER = "#0F172A"
_BG_HOVER = "#1E293B"
_WHITE    = "#FFFFFF"
_GRID     = "rgba(255,255,255,0.08)"
_FONT     = dict(family="Inter, sans-serif", size=13, color=_WHITE)

CHART_HEIGHT = 420

# Continuous scale derived from palette for single-series bar coloring
_CONTINUOUS_SCALE = [
    [0.0,  "#1E1B4B"],
    [0.33, "#6366F1"],
    [0.66, "#8B5CF6"],
    [1.0,  "#EC4899"],
]

# ---------------------------------------------------------------------------
# Shared layout factory
# ---------------------------------------------------------------------------

def _base_layout(title: str, x_label: str, y_label: str) -> dict:
    return dict(
        height=CHART_HEIGHT,
        plot_bgcolor=_BG_PLOT,
        paper_bgcolor=_BG_PAPER,
        font=_FONT,
        title=dict(
            text=title,
            font=dict(size=18, color=_WHITE, family="Inter, sans-serif"),
            x=0.03,
        ),
        margin=dict(t=60, b=40, l=40, r=20),
        legend=dict(
            font=dict(color=_WHITE),
            bgcolor="rgba(0,0,0,0)",
        ),
        hoverlabel=dict(bgcolor=_BG_HOVER, font_color=_WHITE),
        xaxis=dict(
            title=dict(text=x_label, font=dict(color=_WHITE)),
            tickfont=dict(color=_WHITE),
            gridcolor=_GRID,
            showgrid=True,
            zeroline=False,
        ),
        yaxis=dict(
            title=dict(text=y_label, font=dict(color=_WHITE)),
            tickfont=dict(color=_WHITE),
            gridcolor=_GRID,
            showgrid=True,
            zeroline=False,
        ),
        coloraxis_colorbar=dict(
            tickfont=dict(color=_WHITE),
            title=dict(font=dict(color=_WHITE)),
        ),
    )


def _hover_fmt(metric: str) -> str:
    """Return a hover template that shows the metric with comma-separated thousands."""
    return f"<b>%{{x}}</b><br>{metric}: %{{y:,.2f}}<extra></extra>"


def _hover_fmt_h(metric: str) -> str:
    """Horizontal bar hover template."""
    return f"<b>%{{y}}</b><br>{metric}: %{{x:,.2f}}<extra></extra>"


# ---------------------------------------------------------------------------
# Individual chart builders
# ---------------------------------------------------------------------------

def _bar(df: pd.DataFrame, x: str, y: str, result: dict) -> go.Figure:
    title   = result["title"]
    x_label = result["x_label"]
    y_label = result["y_label"]
    n_cats  = df[x].nunique() if x in df.columns else len(df)

    horizontal = n_cats > 6

    if horizontal:
        fig = px.bar(
            df,
            x=y, y=x,
            orientation="h",
            color=y,
            color_continuous_scale=_CONTINUOUS_SCALE,
            title=title,
        )
        fig.update_traces(
            hovertemplate=_hover_fmt_h(y),
            marker_line_width=0,
            texttemplate="%{x:.2s}",
            textposition="outside",
            textfont=dict(color=_WHITE, size=11),
        )
        fig.update_layout(
            **_base_layout(title, y_label, x_label),
            yaxis=dict(
                title=dict(text=x_label, font=dict(color=_WHITE)),
                tickfont=dict(color=_WHITE),
                autorange="reversed",   # top value at top
                gridcolor=_GRID,
                showgrid=True,
                zeroline=False,
            ),
        )
    else:
        # Colour each bar from palette, cycling if needed
        bar_colors = (PALETTE * ((n_cats // len(PALETTE)) + 1))[:n_cats]

        fig = px.bar(
            df,
            x=x, y=y,
            title=title,
            color=x,
            color_discrete_sequence=bar_colors,
        )
        fig.update_traces(
            hovertemplate=_hover_fmt(y),
            marker_line_width=0,
            texttemplate="%{y:.2s}",
            textposition="outside",
            textfont=dict(color=_WHITE, size=11),
        )
        fig.update_layout(**_base_layout(title, x_label, y_label))

    # Rounded corners via marker.cornerradius (Plotly ≥5.12)
    try:
        fig.update_traces(marker_cornerradius=6)
    except Exception:
        pass

    if len(result.get("dimensions", [])) == 1:
        fig.update_layout(showlegend=False)

    fig.update_coloraxes(showscale=False)
    return fig


def _line(df: pd.DataFrame, x: str, y: str, result: dict) -> go.Figure:
    title   = result["title"]
    x_label = result["x_label"]
    y_label = result["y_label"]

    color_dim = result["dimensions"][1] if len(result["dimensions"]) > 1 else None

    # Sort by calendar order when x-axis is month_name
    if x == "month_name" and x in df.columns:
        month_order = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                       "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
        df = df.copy()
        df[x] = pd.Categorical(df[x], categories=month_order, ordered=True)
        df = df.sort_values(x)

    fig = px.line(
        df,
        x=x, y=y,
        color=color_dim,
        title=title,
        markers=True,
        color_discrete_sequence=PALETTE,
        line_shape="spline",        # smooth curve
    )
    fig.update_traces(
        line=dict(width=2.5),
        marker=dict(size=7, line=dict(width=1.5, color=_BG_PLOT)),
        hovertemplate=f"<b>%{{x}}</b><br>{y}: %{{y:,.2f}}<extra></extra>",
    )
    fig.update_layout(**_base_layout(title, x_label, y_label))
    return fig


def _pie(df: pd.DataFrame, names_col: str, values_col: str, result: dict) -> go.Figure:
    title = result["title"]

    # Pull the largest slice outward slightly
    max_idx = df[values_col].idxmax()
    pull    = [0.07 if i == max_idx else 0 for i in df.index]

    fig = px.pie(
        df,
        names=names_col,
        values=values_col,
        title=title,
        color_discrete_sequence=PALETTE,
        hole=0.35,          # Donut style looks better on dark bg
    )
    fig.update_traces(
        pull=pull,
        textposition="outside",
        textinfo="label+percent",
        textfont=dict(color=_WHITE, size=12),
        hovertemplate=(
            f"<b>%{{label}}</b><br>"
            f"{values_col}: %{{value:,.2f}}<br>"
            f"Share: %{{percent}}<extra></extra>"
        ),
        marker=dict(line=dict(color=_BG_PAPER, width=2)),
    )
    fig.update_layout(
        height=CHART_HEIGHT,
        plot_bgcolor=_BG_PLOT,
        paper_bgcolor=_BG_PAPER,
        font=_FONT,
        title=dict(text=title, font=dict(size=18, color=_WHITE), x=0.03),
        margin=dict(t=60, b=20, l=20, r=20),
        legend=dict(font=dict(color=_WHITE), bgcolor="rgba(0,0,0,0)"),
        hoverlabel=dict(bgcolor=_BG_HOVER, font_color=_WHITE),
    )
    return fig


def _scatter(df: pd.DataFrame, x: str, y: str, result: dict) -> go.Figure:
    title      = result["title"]
    x_label    = result["x_label"]
    y_label    = result["y_label"]
    dimensions = result["dimensions"]

    color_dim = dimensions[1] if len(dimensions) > 1 else None

    # Only add OLS trendline when both axes are numeric
    x_is_numeric = pd.api.types.is_numeric_dtype(df[x]) if x in df.columns else False
    trendline    = "ols" if x_is_numeric and color_dim is None else None

    fig = px.scatter(
        df,
        x=x, y=y,
        color=color_dim,
        trendline=trendline,
        title=title,
        color_discrete_sequence=PALETTE,
        color_continuous_scale=_CONTINUOUS_SCALE,
    )
    fig.update_traces(
        marker=dict(size=9, opacity=0.85, line=dict(width=1, color=_BG_PAPER)),
        hovertemplate=f"<b>{x}: %{{x:,.2f}}</b><br>{y}: %{{y:,.2f}}<extra></extra>",
        selector=dict(mode="markers"),
    )
    # Style trendline if present
    fig.update_traces(
        line=dict(color="#F59E0B", width=2, dash="dot"),
        selector=dict(mode="lines"),
    )
    fig.update_layout(**_base_layout(title, x_label, y_label))
    return fig


def _heatmap(df: pd.DataFrame, result: dict) -> go.Figure:
    title      = result["title"]
    x_label    = result["x_label"]
    y_label    = result["y_label"]
    dimensions = result["dimensions"]
    metric     = result["metric"]

    if len(dimensions) >= 2:
        dim_x, dim_y = dimensions[0], dimensions[1]
        pivot = df.pivot_table(index=dim_y, columns=dim_x, values=metric, aggfunc="sum")

        fig = go.Figure(
            data=go.Heatmap(
                z=pivot.values,
                x=pivot.columns.tolist(),
                y=pivot.index.tolist(),
                colorscale=_CONTINUOUS_SCALE,
                hovertemplate=(
                    f"<b>{dim_x}: %{{x}}</b><br>"
                    f"{dim_y}: %{{y}}<br>"
                    f"{metric}: %{{z:,.2f}}<extra></extra>"
                ),
                colorbar=dict(
                    tickfont=dict(color=_WHITE),
                    title=dict(text=metric, font=dict(color=_WHITE)),
                ),
            )
        )
    else:
        # Fallback: single-dimension density bar rendered as horizontal heatmap
        x_col = dimensions[0] if dimensions else metric
        fig = px.density_heatmap(
            df, x=x_col, y=metric,
            color_continuous_scale=_CONTINUOUS_SCALE,
            title=title,
        )

    base = _base_layout(title, x_label, y_label)
    # Heatmap doesn't need grid lines on axes
    base["xaxis"]["showgrid"] = False
    base["yaxis"]["showgrid"] = False
    fig.update_layout(**base)
    return fig


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def _apply_light_theme(fig: go.Figure) -> None:
    """Override dark-mode colors with light-theme equivalents."""
    lf = "#0F172A"   # light font
    fig.update_layout(
        plot_bgcolor="#FFFFFF",
        paper_bgcolor="#F8FAFC",
        font=dict(color=lf),
        title=dict(font=dict(color=lf)),
        legend=dict(font=dict(color=lf)),
        hoverlabel=dict(bgcolor="#F1F5F9", font_color=lf),
        xaxis=dict(
            tickfont=dict(color=lf),
            title=dict(font=dict(color=lf)),
            gridcolor="#E2E8F0",
        ),
        yaxis=dict(
            tickfont=dict(color=lf),
            title=dict(font=dict(color=lf)),
            gridcolor="#E2E8F0",
        ),
    )
    # Fix text labels on bars / lines
    fig.update_traces(textfont_color=lf)
    # Fix line-chart marker borders
    fig.update_traces(
        marker=dict(line=dict(color="#F8FAFC")),
        selector=dict(type="scatter"),
    )


def build_chart(result: dict, is_dark: bool = True) -> go.Figure:
    """
    Convert a data_engine result dict into a styled Plotly Figure.

    Args:
        result: dict returned by data_engine.run_query()

    Returns:
        A Plotly Figure, or a simple error figure if result contains an error.
    """
    # --- Error pass-through: render a blank figure with the error message ---
    if result.get("error"):
        fig = go.Figure()
        fig.update_layout(
            **_base_layout("Error", "", ""),
            annotations=[
                dict(
                    text=result.get("message", "Unknown error"),
                    x=0.5, y=0.5,
                    xref="paper", yref="paper",
                    showarrow=False,
                    font=dict(size=15, color="#EC4899"),
                    align="center",
                )
            ],
        )
        return fig

    # --- Unpack result ---
    records    = result.get("data", [])
    metric     = result.get("metric", "value")
    dimensions = result.get("dimensions") or []
    chart_type = result.get("chart_type", "bar")

    if not records:
        return build_chart({"error": True, "message": "No data to display."})

    df = pd.DataFrame(records)

    # Primary x-axis dimension (first dimension, or metric itself if none)
    x_dim = dimensions[0] if dimensions else metric

    # --- Dispatch to chart-specific builder ---
    if chart_type == "line":
        fig = _line(df, x_dim, metric, result)

    elif chart_type == "pie":
        fig = _pie(df, x_dim, metric, result)

    elif chart_type == "scatter":
        x_col = dimensions[1] if len(dimensions) > 1 else x_dim
        fig   = _scatter(df, x_col, metric, result)

    elif chart_type == "heatmap":
        fig = _heatmap(df, result)

    else:
        # "bar" or any unknown type → default to bar
        fig = _bar(df, x_dim, metric, result)

    if not is_dark:
        _apply_light_theme(fig)

    return fig
