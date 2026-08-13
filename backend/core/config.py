"""
Shared configuration loader.

Importing this module has the side effect of loading environment variables
from backend/.env. This MUST happen before any other module reads
os.environ, so keep `core.config` (or anything that imports it, e.g.
`core.database`) at the top of server.py's imports.

Only the environment variables strictly required by the shared
infrastructure are read here. Feature-specific env vars (Razorpay,
Firebase, Stripe, Owner identity, CORS, etc.) remain in server.py for now
and will be moved when their respective route modules are extracted.
"""
import os
from pathlib import Path

from dotenv import load_dotenv

# Backend directory (same directory as server.py). __file__ is at
# backend/core/config.py, so .parent.parent → backend/
BACKEND_DIR = Path(__file__).resolve().parent.parent

# Load .env once at import time. python-dotenv is idempotent so subsequent
# imports are safe no-ops.
load_dotenv(BACKEND_DIR / ".env")

# Required MongoDB configuration. Accessed via os.environ[...] (not .get)
# so that a missing key still fails fast at startup — identical behavior
# to the original inline initialization in server.py.
MONGO_URL: str = os.environ["MONGO_URL"]
DB_NAME: str = os.environ["DB_NAME"]
