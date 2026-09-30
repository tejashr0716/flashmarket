import os
from dataclasses import dataclass
from urllib.parse import unquote, urlparse

from dotenv import load_dotenv


@dataclass(frozen=True)
class Settings:
    db_host: str = "127.0.0.1"
    db_port: int = 3306
    db_user: str = "flashmarket"
    db_password: str = ""
    db_name: str = "flashmarket"
    db_pool_size: int = 10
    admin_api_key: str = ""
    sse_max_clients: int = 32
    db_ssl_ca: str | None = None

    @classmethod
    def from_env(cls) -> "Settings":
        # An existing environment variable always wins over the local .env.
        load_dotenv(override=False)
        values = {
            "db_host": os.getenv("DB_HOST", "127.0.0.1"),
            "db_port": int(os.getenv("DB_PORT", "3306")),
            "db_user": os.getenv("DB_USER", "flashmarket"),
            "db_password": os.getenv("DB_PASSWORD", ""),
            "db_name": os.getenv("DB_NAME", "flashmarket"),
            "db_pool_size": int(os.getenv("DB_POOL_SIZE", "10")),
            "admin_api_key": os.getenv("ADMIN_API_KEY", ""),
            "sse_max_clients": int(os.getenv("SSE_MAX_CLIENTS", "32")),
            "db_ssl_ca": os.getenv("DB_SSL_CA") or None,
        }
        if url := os.getenv("DATABASE_URL"):
            parsed = urlparse(url)
            if parsed.scheme not in {"mysql", "mysql+mysqlconnector"}:
                raise ValueError("DATABASE_URL must use the mysql:// scheme")
            if not parsed.hostname or not parsed.path.lstrip("/"):
                raise ValueError("DATABASE_URL must include a host and database")
            values.update(
                db_host=parsed.hostname,
                db_port=parsed.port or 3306,
                db_user=unquote(parsed.username or ""),
                db_password=unquote(parsed.password or ""),
                db_name=unquote(parsed.path.lstrip("/")),
            )
        if not 1 <= values["db_pool_size"] <= 32:
            raise ValueError("DB_POOL_SIZE must be between 1 and 32")
        if not 1 <= values["sse_max_clients"] <= 100:
            raise ValueError("SSE_MAX_CLIENTS must be between 1 and 100")
        return cls(**values)
