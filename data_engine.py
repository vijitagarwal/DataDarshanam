# -*- coding: utf-8 -*-
import pandas as pd

DATA_PATH = "sales.csv"

# ---------------------------------------------------------------------------
# Module-level data load (cached for the lifetime of the process)
# ---------------------------------------------------------------------------

def _load_data(path: str) -> pd.DataFrame:
    df = pd.read_csv(path)
    df["order_date"]  = pd.to_datetime(df["order_date"])
    df["year"]        = df["order_date"].dt.year
    df["month"]       = df["order_date"].dt.month
    df["month_name"]  = df["order_date"].dt.strftime("%b")
    df["quarter"]     = df["order_date"].dt.quarter
    return df

_DF: pd.DataFrame = _load_data(DATA_PATH)

# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

_OPS = {
    "eq":  lambda s, v: s == v,
    "neq": lambda s, v: s != v,
    "ne":  lambda s, v: s != v,        # alias
    "gt":  lambda s, v: s > v,
    "lt":  lambda s, v: s < v,
    "gte": lambda s, v: s >= v,
    "lte": lambda s, v: s <= v,
    "in":  lambda s, v: s.isin(v if isinstance(v, list) else [v]),
}

_AGG_FUNCS = {
    "sum":   "sum",
    "mean":  "mean",
    "count": "count",
    "max":   "max",
    "min":   "min",
}

# Columns that represent ordered time for nicer sort ordering
_TIME_DIMS = {"year", "month", "quarter"}

# Human-readable month ordering when month_name is a dimension
_MONTH_ORDER = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def _err(message: str) -> dict:
    return {"error": True, "message": message}


def _apply_filters(df: pd.DataFrame, filters: list) -> tuple[pd.DataFrame, str | None]:
    """
    Apply a list of filter dicts to df.
    Returns (filtered_df, error_message_or_None).
    """
    for f in filters:
        field = f.get("field", "")
        op    = f.get("op", "eq")
        value = f.get("value")

        if field not in df.columns:
            return df, (
                f"Filter field '{field}' is not available. "
                f"Available fields: {', '.join(sorted(df.columns))}"
            )

        if op not in _OPS:
            return df, (
                f"Unsupported filter operator '{op}'. "
                f"Supported: {', '.join(_OPS)}"
            )

        # Validate categorical membership for 'eq' / 'in' filters
        if op in ("eq", "in"):
            col_dtype = df[field].dtype
            if col_dtype == object:               # categorical string column
                valid = set(df[field].dropna().unique())
                candidates = value if isinstance(value, list) else [value]
                bad = [v for v in candidates if v not in valid]
                if bad:
                    return df, (
                        f"Value(s) {bad} not found in column '{field}'. "
                        f"Valid values: {sorted(valid)}"
                    )

            # Validate integer enum columns (quarter 1-4, year, month, etc.)
            # Only applies to low-cardinality integer columns (≤ 20 distinct values)
            elif pd.api.types.is_integer_dtype(col_dtype) and df[field].nunique() <= 20:
                valid_ints = sorted(df[field].dropna().unique().tolist())
                candidates = value if isinstance(value, list) else [value]
                bad = [v for v in candidates if v not in valid_ints]
                if bad:
                    return df, (
                        f"Value(s) {bad} not valid for '{field}'. "
                        f"Valid values: {valid_ints}"
                    )

        mask = _OPS[op](df[field], value)
        df = df[mask]

    return df, None


def _aggregate(
    df: pd.DataFrame,
    metric: str,
    dimensions: list,
    aggregation: str,
) -> tuple[pd.DataFrame, str | None]:
    """Group df by dimensions and aggregate metric. Returns (result_df, error_or_None)."""
    if metric not in df.columns:
        return df, (
            f"Metric column '{metric}' not found. "
            f"Numeric columns available: price, discount_percent, quantity_sold, "
            f"rating, review_count, discounted_price, total_revenue"
        )

    agg_func = _AGG_FUNCS.get(aggregation, "sum")

    if dimensions:
        # Verify every dimension exists
        missing = [d for d in dimensions if d not in df.columns]
        if missing:
            return df, f"Dimension column(s) not found: {missing}"

        result = (
            df.groupby(dimensions, observed=True)[metric]
            .agg(agg_func)
            .reset_index()
        )
    else:
        # No group-by: single-row summary
        scalar = getattr(df[metric], agg_func)()
        result = pd.DataFrame({metric: [scalar]})

    return result, None


def _sort_result(
    df: pd.DataFrame,
    metric: str,
    sort_by: str,
    sort_order: str,
) -> pd.DataFrame:
    ascending = sort_order != "desc"

    # Always apply calendar ordering when month_name is a dimension.
    # After aggregation, month_name only appears in the result if it was
    # grouped on, so its presence is a reliable signal.
    if "month_name" in df.columns:
        df = df.copy()
        df["_month_order"] = df["month_name"].map(
            {m: i for i, m in enumerate(_MONTH_ORDER)}
        )
        df = df.sort_values("_month_order", ascending=True).drop(
            columns=["_month_order"]
        )
        return df

    if sort_by == "metric" or sort_by == metric:
        return df.sort_values(metric, ascending=ascending)

    # Numeric time dimensions → natural integer sort
    if sort_by in _TIME_DIMS and sort_by in df.columns:
        return df.sort_values(sort_by, ascending=ascending)

    # Dimension sort (alphabetical)
    if sort_by in df.columns:
        return df.sort_values(sort_by, ascending=ascending)

    # Fallback: sort by metric
    return df.sort_values(metric, ascending=ascending)


def _build_summary(df: pd.DataFrame, metric: str, dimensions: list) -> dict:
    col = df[metric]
    summary: dict = {
        "total":     round(float(col.sum()), 2),
        "average":   round(float(col.mean()), 2),
        "max_value": round(float(col.max()), 2),
        "row_count": len(df),
    }

    # Find which dimension-label combination produced the max value
    if not df.empty and dimensions:
        max_idx = col.idxmax()
        max_row = df.loc[max_idx, dimensions]
        if len(dimensions) == 1:
            summary["max_label"] = str(max_row.iloc[0])
        else:
            summary["max_label"] = " | ".join(str(v) for v in max_row)
    else:
        summary["max_label"] = None

    return summary


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def prepare_dataframe(df: pd.DataFrame) -> pd.DataFrame:
    """
    Prepare and enrich a DataFrame with date columns.
    Handles missing date columns gracefully (e.g., custom CSV uploads).
    """
    if "order_date" in df.columns:
        df = df.copy()
        df["order_date"] = pd.to_datetime(df["order_date"], errors="coerce")
        df["year"]       = df["order_date"].dt.year
        df["month"]      = df["order_date"].dt.month
        df["month_name"] = df["order_date"].dt.strftime("%b")
        df["quarter"]    = df["order_date"].dt.quarter
    return df


def get_dataframe() -> pd.DataFrame:
    """Return the cached raw DataFrame (for reference / display purposes)."""
    return _DF.copy()


def run_query(parsed: dict) -> dict:
    """
    Execute a structured BI query against the cached sales DataFrame.

    Args:
        parsed: dict produced by llm_parser.parse_query()

    Returns:
        {
            "data":       list[dict],   # aggregated rows
            "metric":     str,
            "dimensions": list[str],
            "chart_type": str,
            "title":      str,
            "x_label":    str,
            "y_label":    str,
            "summary":    { total, average, max_value, max_label, row_count }
        }
        or {"error": True, "message": str}
    """
    # --- Pass-through errors from the parser ---
    if parsed.get("error"):
        return parsed

    # --- Extract query parameters (with sensible defaults) ---
    metric     = parsed.get("metric", "total_revenue")
    aggregation= parsed.get("aggregation", "sum")
    dimensions = parsed.get("dimensions") or []
    filters    = parsed.get("filters") or []
    chart_type = parsed.get("chart_type", "bar")
    sort_by    = parsed.get("sort_by", "metric")
    sort_order = parsed.get("sort_order", "desc")
    limit      = int(parsed.get("limit", 10))
    title      = parsed.get("title", "Query Result")
    x_label    = parsed.get("x_label", dimensions[0] if dimensions else "")
    y_label    = parsed.get("y_label", metric)

    df = _DF.copy()

    # --- Apply filters ---
    df, filter_err = _apply_filters(df, filters)
    if filter_err:
        return _err(filter_err)

    if df.empty:
        return _err(
            "No data matched your filters. "
            "Try broadening your search criteria."
        )

    # --- Aggregate ---
    result, agg_err = _aggregate(df, metric, dimensions, aggregation)
    if agg_err:
        return _err(agg_err)

    if result.empty:
        return _err("No data matched your query after aggregation.")

    # --- Sort ---
    result = _sort_result(result, metric, sort_by, sort_order)

    # --- Limit ---
    if limit < 999:
        result = result.head(limit)

    # --- Build summary (before converting to records) ---
    summary = _build_summary(result, metric, dimensions)

    # --- Serialise ---
    # Round floats to 2 dp for cleaner display
    for col in result.select_dtypes(include="float").columns:
        result[col] = result[col].round(2)

    return {
        "data":       result.to_dict(orient="records"),
        "metric":     metric,
        "dimensions": dimensions,
        "chart_type": chart_type,
        "title":      title,
        "x_label":    x_label,
        "y_label":    y_label,
        "summary":    summary,
    }
