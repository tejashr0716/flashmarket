from contextlib import contextmanager
from uuid import uuid4

from mysql.connector.pooling import MySQLConnectionPool

from app.config import Settings


class Database:
    """Blocking MySQL driver: called from FastAPI's threadpool, never the event loop."""

    def __init__(self, settings: Settings):
        options = {
            "pool_name": f"fm_{uuid4().hex[:12]}",
            "pool_size": settings.db_pool_size,
            "pool_reset_session": True,
            "host": settings.db_host,
            "port": settings.db_port,
            "user": settings.db_user,
            "password": settings.db_password,
            "database": settings.db_name,
            "connection_timeout": 5,
            "autocommit": False,
            "charset": "utf8mb4",
        }
        if settings.db_ssl_ca:
            options.update(
                ssl_ca=settings.db_ssl_ca,
                ssl_verify_cert=True,
                ssl_verify_identity=True,
            )
        self.pool = MySQLConnectionPool(**options)

    @contextmanager
    def connection(self):
        connection = self.pool.get_connection()
        try:
            with connection.cursor() as cursor:
                cursor.execute("SET time_zone = '+00:00'")
            yield connection
        except Exception:
            connection.rollback()
            raise
        finally:
            # SELECT starts a transaction too. Never return an open transaction.
            if connection.in_transaction:
                connection.rollback()
            connection.close()

    def close(self):
        # A pool owns its physical connections. Drain it on application shutdown.
        for _ in range(self.pool.pool_size):
            connection = self.pool._cnx_queue.get_nowait()
            connection.close()
