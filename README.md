# DATAdarshanam 📊
### Conversational AI for Instant Business Intelligence Dashboards

> Natural language → Interactive charts → AI insights. Instantly.

🔗 **Live Demo:** https://datadarshanam.streamlit.app

---

## What is DATAdarshanam?

DATAdarshanam is a conversational BI dashboard that lets
non-technical users — executives, managers, analysts —
query business data using plain English and instantly get
interactive charts, KPI tiles, and AI-generated insights.
No SQL. No BI tool expertise required.

---

## Demo Queries

Try these in the live app:

| Complexity | Query |
|---|---|
| Simple | `Show total revenue by region as a bar chart` |
| Medium | `Show monthly revenue trend for 2023 as a line chart` |
| Complex | `Show top 5 product categories by average rating as a bar chart` |
| Follow-up | `Now filter this to only show Asia` |
| Dashboard | Click **Generate Full Dashboard** for 3 charts at once |

---

## Features

- **Natural Language Queries** — Ask data questions in plain English
- **Smart Chart Selection** — Automatically picks bar, line, pie, scatter based on query
- **AI-Generated Insights** — 2-3 sentence business analyst commentary per chart
- **KPI Tiles** — Total, Average, Top Performer displayed per query
- **Multi-Chart Dashboard** — Generate 3 charts simultaneously with one click
- **CSV Upload** — Upload your own dataset and query it instantly
- **Hallucination Handling** — Gracefully rejects queries about unavailable fields
- **Interactive Charts** — Hover tooltips, zoom, scroll zoom, double-click to reset
- **Conversation History** — All queries and charts persist in session

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Streamlit |
| Charts | Plotly Express |
| Data Processing | Pandas |
| LLM | Groq LLaMA 3.3-70b-versatile |
| Language | Python 3.x |

---

## Dataset

The app uses a sales dataset (`sales.csv`) with 50,000 rows covering:

| Column | Description |
|---|---|
| order_date | Jan 2022 – Dec 2023 |
| product_category | Beauty, Books, Electronics, Fashion, Home & Kitchen, Sports |
| customer_region | Asia, Europe, Middle East, North America |
| payment_method | Cash on Delivery, Credit Card, Debit Card, UPI, Wallet |
| total_revenue | Key metric for most queries |
| rating | Customer rating (1–5) |
| quantity_sold, discount_percent | Additional metrics |

---

## Architecture
```
User Query
↓
LLM Parser (Groq LLaMA 3.3)
Extracts: metric, dimensions, filters, chart_type
↓
Data Engine (Pandas)
Filters, aggregates, sorts 50,000 rows
↓
Chart Builder (Plotly Express)
Renders bar, line, pie, scatter charts
↓
Insight Generator (Groq LLaMA 3.3)
2-3 sentence business analyst commentary
↓
Streamlit Dashboard
KPI tiles + Interactive chart + AI insight + Data summary
```

---

## Project Structure
```
DATAdarshanam/
├── app.py              # Streamlit UI and chat interface
├── llm_parser.py       # Natural language → structured JSON via Groq
├── data_engine.py      # JSON → pandas aggregation engine
├── chart_builder.py    # Aggregated data → Plotly figures
├── insight_gen.py      # Data summary → AI business insights
├── sales.csv           # 50,000 row sales dataset
├── requirements.txt    # Python dependencies
└── README.md           # This file
```

---

## Local Setup
```bash
# 1. Clone the repo
git clone https://github.com/vijitagarwal/DataDarshanam.git
cd DataDarshanam

# 2. Install dependencies
pip install -r requirements.txt

# 3. Add your Groq API key
echo "GROQ_API_KEY=your_key_here" > .env

# 4. Run the app
streamlit run app.py
```

Get a free Groq API key at https://console.groq.com

---

## Evaluation Alignment

| Criteria | Implementation |
|---|---|
| Data Retrieval (Accuracy) | LLM parses query → pandas aggregation on 50K rows |
| Chart Selection (Accuracy) | Rule-based mapping: trend→line, breakdown→pie, comparison→bar |
| Error Handling (Accuracy) | Rejects unavailable fields, vague queries, chitchat |
| Design (Aesthetics) | Dark theme, KPI tiles, color-coded charts |
| Interactivity (Aesthetics) | Hover tooltips, zoom, scroll zoom, double-click reset |
| User Flow (Aesthetics) | Chat interface, loading spinner, example queries |
| Architecture (Innovation) | 5-stage pipeline: query→parse→aggregate→visualize→insight |
| Prompt Engineering (Innovation) | Strict JSON schema, column-aware system prompt |
| Hallucination Handling (Innovation) | Field validation, empty result detection, friendly errors |
| Follow-up Queries (Bonus) | Conversation history with context passing |
| CSV Upload (Bonus) | Upload any CSV and query it instantly |

---

Built with ❤️ for GFG Hackathon by Vijit Agarwal
