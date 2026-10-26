# -*- coding: utf-8 -*-
import io
import json
import traceback
import re
from typing import Any, Dict, List, Optional

import pandas as pd
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

import chart_builder
import config
import data_engine
import insight_gen
import llm_parser

app = FastAPI(
    title="DataDarshanam API",
    description="Backend API for Conversational BI Dashboard powered by Groq",
    version="2.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=config.ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


@app.middleware("http")
async def workspace_middleware(request, call_next):
    workspace_id = request.headers.get("X-Workspace-ID", "default")
    if not re.fullmatch(r"[A-Za-z0-9_-]{8,64}", workspace_id):
        raise HTTPException(status_code=400, detail="Invalid workspace identifier")
    data_engine.set_workspace(workspace_id)
    return await call_next(request)


class QueryRequest(BaseModel):
    query: str = Field(min_length=1, max_length=2000)
    previous_context: Optional[Dict[str, Any]] = None


class DashboardRequest(BaseModel):
    query: str = Field(default="generate full dashboard overview", max_length=500)


@app.get("/api/health")
def health_check():
    return {
        "status": "ok",
        "service": "DataDarshan API",
        "ai_configured": bool(config.GROQ_API_KEY),
    }


@app.get("/api/schema")
def get_schema():
    try:
        profile = data_engine.get_dataset_profile()
        suggested = data_engine.suggest_questions(5)
        return {
            "profile": profile,
            "suggested_questions": suggested,
        }
    except Exception:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail="Unable to load dataset schema")


@app.post("/api/query")
def run_nl_query(req: QueryRequest):
    if not req.query or not req.query.strip():
        raise HTTPException(status_code=400, detail="Query string cannot be empty")

    query = req.query.strip()
    previous_context = req.previous_context

    try:
        schema_context = data_engine.build_schema_context()
        parsed = llm_parser.parse_query(
            query,
            previous_context=previous_context,
            schema_context=schema_context,
        )

        if parsed.get("error"):
            return {
                "success": False,
                "error": True,
                "query": query,
                "parsed": parsed,
                "message": parsed.get("message", "Unable to parse query"),
                "insight": parsed.get("message", "Unable to parse query"),
            }

        result = data_engine.run_query(parsed)
        if result.get("error"):
            return {
                "success": False,
                "error": True,
                "query": query,
                "parsed": parsed,
                "result": result,
                "message": result.get("message", "Error running query on dataset"),
                "insight": result.get("message", "Error running query on dataset"),
            }

        # Build figure for dark & light mode specs
        fig_dark = chart_builder.build_chart(result, is_dark=True)
        fig_light = chart_builder.build_chart(result, is_dark=False)
        insight = insight_gen.generate_insight(query, result)

        return {
            "success": True,
            "error": False,
            "query": query,
            "parsed": parsed,
            "result": result,
            "insight": insight,
            "fallback": insight_gen._last_used_fallback,
            "used_context": previous_context is not None,
            "plotly_spec": {
                "dark": json.loads(fig_dark.to_json()),
                "light": json.loads(fig_light.to_json()),
            },
        }

    except Exception:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail="Query execution failed")


@app.post("/api/dashboard")
def run_dashboard_query(req: DashboardRequest):
    query = req.query.strip() if req.query else "generate full dashboard overview"
    try:
        dashboard_queries = llm_parser.parse_dashboard_query(query)
        if not dashboard_queries:
            # Fallback default queries
            dashboard_queries = [
                {"chart_type": "bar", "metric": "total_revenue", "dimensions": ["category"], "sort_order": "desc", "limit": 5, "title": "Top Categories by Revenue"},
                {"chart_type": "line", "metric": "total_revenue", "dimensions": ["month_name"], "sort_order": "asc", "limit": 12, "title": "Monthly Revenue Trend"},
                {"chart_type": "pie", "metric": "total_revenue", "dimensions": ["region"], "sort_order": "desc", "limit": 5, "title": "Revenue Distribution by Region"},
            ]

        charts = []
        for p in dashboard_queries:
            res = data_engine.run_query(p)
            if not res.get("error"):
                fig_dark = chart_builder.build_chart(res, is_dark=True)
                fig_light = chart_builder.build_chart(res, is_dark=False)
                charts.append({
                    "parsed": p,
                    "result": res,
                    "plotly_spec": {
                        "dark": json.loads(fig_dark.to_json()),
                        "light": json.loads(fig_light.to_json()),
                    }
                })

        return {
            "success": True,
            "query": query,
            "charts": charts
        }
    except Exception:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail="Dashboard generation failed")


@app.post("/api/upload")
async def upload_csv(file: UploadFile = File(...)):
    filename = file.filename or ""
    if not filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="File must be a CSV format")

    try:
        contents = bytearray()
        while chunk := await file.read(1024 * 1024):
            contents.extend(chunk)
            if len(contents) > config.MAX_UPLOAD_BYTES:
                raise HTTPException(
                    status_code=413,
                    detail=f"CSV file exceeds the {config.MAX_UPLOAD_BYTES // (1024 * 1024)} MB limit",
                )

        raw_str = bytes(contents).decode("utf-8-sig")
        df_up = pd.read_csv(io.StringIO(raw_str))
        if df_up.empty:
            raise HTTPException(status_code=400, detail="CSV file does not contain any rows")
        if len(df_up) > config.MAX_UPLOAD_ROWS:
            raise HTTPException(
                status_code=413,
                detail=f"CSV file exceeds the {config.MAX_UPLOAD_ROWS:,} row limit",
            )
        if len(df_up.columns) > config.MAX_UPLOAD_COLUMNS:
            raise HTTPException(
                status_code=413,
                detail=f"CSV file exceeds the {config.MAX_UPLOAD_COLUMNS} column limit",
            )
        df_up = data_engine.prepare_dataframe(df_up)
        data_engine.set_dataframe(df_up)

        profile = data_engine.get_dataset_profile()
        suggested = data_engine.suggest_questions(5)

        return {
            "success": True,
            "filename": filename,
            "rows": len(df_up),
            "profile": profile,
            "suggested_questions": suggested,
        }
    except UnicodeDecodeError:
        raise HTTPException(status_code=400, detail="CSV file must use UTF-8 encoding")
    except pd.errors.ParserError:
        raise HTTPException(status_code=400, detail="CSV file could not be parsed")
    except HTTPException:
        raise
    except Exception:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail="CSV processing failed")
