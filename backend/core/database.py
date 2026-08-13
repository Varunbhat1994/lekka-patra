"""
Shared MongoDB connection.

A single AsyncIOMotorClient is created at import time. Every module that
needs database access must import `db` (and `client` if it needs the raw
handle for admin pings) from this module — do NOT create additional
clients elsewhere.

The connection settings must remain identical to the original inline
initialization in server.py:
    - bounded pool (1..25) so we don't exhaust resources
    - short server-selection timeout to fail fast (503 rather than 30s hangs)
    - retryable reads/writes for transient network blips
    - reasonable idle-socket timeout
"""
from motor.motor_asyncio import AsyncIOMotorClient

from core.config import MONGO_URL, DB_NAME

client: AsyncIOMotorClient = AsyncIOMotorClient(
    MONGO_URL,
    maxPoolSize=25,
    minPoolSize=1,
    serverSelectionTimeoutMS=5000,
    connectTimeoutMS=5000,
    socketTimeoutMS=20000,
    waitQueueTimeoutMS=5000,
    maxIdleTimeMS=60000,
    retryWrites=True,
    retryReads=True,
    appname="farmlog",
)
db = client[DB_NAME]
