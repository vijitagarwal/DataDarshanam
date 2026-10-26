import os
from dotenv import load_dotenv

load_dotenv()

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
GROQ_MODEL = os.getenv("GROQ_MODEL", "openai/gpt-oss-120b")
DEFAULT_ORIGINS = "http://localhost:3000,http://127.0.0.1:3000"
ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.getenv("ALLOWED_ORIGINS", DEFAULT_ORIGINS).split(",")
    if origin.strip()
]
MAX_UPLOAD_BYTES = int(os.getenv("MAX_UPLOAD_BYTES", str(25 * 1024 * 1024)))
MAX_UPLOAD_ROWS = int(os.getenv("MAX_UPLOAD_ROWS", "250000"))
MAX_UPLOAD_COLUMNS = int(os.getenv("MAX_UPLOAD_COLUMNS", "100"))
DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "sales.db")
DEFAULT_TABLE = "sales"
