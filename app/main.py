import asyncio
import json
import logging
import secrets
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from mysql.connector import Error as MySQLError, IntegrityError
from pydantic import ValidationError

from app.config import Settings
from app.db import Database
from app.repository import CatalogRepository, DomainError
from app.schemas import CatalogFilters, CatalogOut, ProductCreate, ProductOut, ProductPatch, StockUpdate


STATIC = Path(__file__).parent / "static"
logger = logging.getLogger("flashmarket")


def filter_params(
    search: str = "",
    category_id: int | None = None,
    brand_id: Annotated[list[int] | None, Query()] = None,
    min_price: str | None = None,
    max_price: str | None = None,
    stock: str = "all",
    min_rating: str | None = None,
    sort: str = "newest",
    limit: int = 100,
    offset: int = 0,
) -> CatalogFilters:
    try:
        return CatalogFilters(
            search=search, category_id=category_id, brand_id=brand_id or [],
            min_price=min_price, max_price=max_price, stock=stock,
            min_rating=min_rating, sort=sort, limit=limit, offset=offset,
        )
    except ValidationError as error:
        # Converts dependency-model errors into standard HTTP 422 responses.
        raise RequestValidationError(error.errors()) from error


def repository(request: Request) -> CatalogRepository:
    return request.app.state.repository


def require_admin(request: Request, x_admin_key: Annotated[str | None, Header()] = None):
    key = request.app.state.settings.admin_api_key
    if len(key) < 32:
        raise HTTPException(503, "Inventory writes are disabled until ADMIN_API_KEY is configured")
    if not x_admin_key or not secrets.compare_digest(x_admin_key, key):
        raise HTTPException(401, "An inventory admin key is required")


def parse_event_id(value: str | None) -> int | None:
    if value is None:
        return None
    if not value.isascii() or not value.isdigit() or len(value) > 18:
        raise HTTPException(400, "Last-Event-ID must be a non-negative integer")
    return int(value)


def format_event(event_id: int, event_type: str, payload: dict) -> str:
    return f"id: {event_id}\nevent: {event_type}\ndata: {json.dumps(payload, separators=(',', ':'))}\n\n"


def create_app(settings: Settings | None = None) -> FastAPI:
    @asynccontextmanager
    async def lifespan(application: FastAPI):
        configuration = settings or Settings.from_env()
        database = await asyncio.to_thread(Database, configuration)
        application.state.settings = configuration
        application.state.repository = CatalogRepository(database)
        application.state.sse_clients = 0
        application.state.sse_lock = asyncio.Lock()
        try:
            yield
        finally:
            await asyncio.to_thread(database.close)

    application = FastAPI(
        title="Flash Market — Catalog & Inventory API",
        description="MySQL-backed sample catalog with recursive category filtering and live stock events.",
        version="1.0.0",
        lifespan=lifespan,
        redoc_url=None,
    )

    @application.middleware("http")
    async def security_headers(request: Request, call_next):
        started = time.perf_counter()
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "same-origin"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-Response-Time-Ms"] = f"{(time.perf_counter() - started) * 1000:.2f}"
        if request.url.path != "/docs":
            response.headers["Content-Security-Policy"] = (
                "default-src 'self'; script-src 'self'; style-src 'self'; "
                "connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; "
                "base-uri 'none'; form-action 'self'"
            )
        return response

    @application.exception_handler(DomainError)
    async def domain_error(_request, error):
        return JSONResponse(status_code=error.status, content={"detail": error.detail})

    @application.exception_handler(MySQLError)
    async def database_error(_request, error):
        if isinstance(error, IntegrityError):
            if error.errno == 1062:
                return JSONResponse(status_code=409, content={"detail": "That SKU already exists"})
            return JSONResponse(status_code=422, content={"detail": "Database constraint rejected the change"})
        logger.error("Database operation failed (%s)", type(error).__name__)
        return JSONResponse(
            status_code=503,
            content={"detail": "Database temporarily unavailable. Please retry."},
            headers={"Retry-After": "3"},
        )

    @application.get("/", include_in_schema=False)
    def index():
        return FileResponse(STATIC / "index.html", headers={"Cache-Control": "no-cache"})

    @application.get("/health", tags=["Operations"])
    def health(repo: Annotated[CatalogRepository, Depends(repository)]):
        return repo.health()

    @application.get("/api/products", response_model=CatalogOut, tags=["Catalog"])
    def products(
        filters: Annotated[CatalogFilters, Depends(filter_params)],
        repo: Annotated[CatalogRepository, Depends(repository)],
    ):
        return repo.list_products(filters)

    @application.get("/api/products/{product_id}", response_model=ProductOut, tags=["Catalog"])
    def product(product_id: int, repo: Annotated[CatalogRepository, Depends(repository)]):
        return repo.get_product(product_id)

    @application.get("/api/categories", tags=["Catalog"])
    def categories(repo: Annotated[CatalogRepository, Depends(repository)]):
        return repo.categories()

    @application.get("/api/brands", tags=["Catalog"])
    def brands(repo: Annotated[CatalogRepository, Depends(repository)]):
        return repo.brands()

    @application.get("/api/stats", tags=["Catalog"])
    def stats(repo: Annotated[CatalogRepository, Depends(repository)]):
        return repo.stats()

    @application.post(
        "/api/products", response_model=ProductOut, status_code=201,
        dependencies=[Depends(require_admin)], tags=["Inventory"],
    )
    def add_product(payload: ProductCreate, repo: Annotated[CatalogRepository, Depends(repository)]):
        return repo.create_product(payload)

    @application.get("/api/admin/status", dependencies=[Depends(require_admin)], tags=["Inventory"])
    def admin_status():
        return {"authorized": True}

    @application.patch(
        "/api/products/{product_id}", response_model=ProductOut,
        dependencies=[Depends(require_admin)], tags=["Inventory"],
    )
    def edit_product(
        product_id: int, payload: ProductPatch,
        repo: Annotated[CatalogRepository, Depends(repository)],
    ):
        return repo.patch_product(product_id, payload)

    @application.patch(
        "/api/products/{product_id}/stock", response_model=ProductOut,
        dependencies=[Depends(require_admin)], tags=["Inventory"],
    )
    def stock_update(
        product_id: int, payload: StockUpdate,
        repo: Annotated[CatalogRepository, Depends(repository)],
    ):
        return repo.update_stock(product_id, payload)

    @application.delete(
        "/api/products/{product_id}", status_code=204,
        dependencies=[Depends(require_admin)], tags=["Inventory"],
    )
    def archive_product(
        product_id: int, expected_version: Annotated[int, Query(ge=0)],
        repo: Annotated[CatalogRepository, Depends(repository)],
    ):
        repo.archive_product(product_id, expected_version)
        return Response(status_code=204)

    @application.get("/api/events", tags=["Live updates"])
    async def events(
        request: Request,
        repo: Annotated[CatalogRepository, Depends(repository)],
        last_event_id: Annotated[str | None, Header()] = None,
    ):
        saved_cursor = parse_event_id(last_event_id)
        async with application.state.sse_lock:
            if application.state.sse_clients >= application.state.settings.sse_max_clients:
                raise HTTPException(429, "Live-update connection limit reached", headers={"Retry-After": "5"})
            application.state.sse_clients += 1

        async def stream():
            try:
                cursor = saved_cursor if saved_cursor is not None else await asyncio.to_thread(repo.event_cursor)
                yield "retry: 3000\n" + format_event(cursor, "ready", {"cursor": cursor})
                heartbeat = time.monotonic()
                while not await request.is_disconnected():
                    batch = await asyncio.to_thread(repo.events_after, cursor)
                    for event in batch:
                        yield format_event(event["id"], event["event_type"], event["payload"])
                        cursor = event["id"]
                    if time.monotonic() - heartbeat >= 15:
                        yield ": keep-alive\n\n"
                        heartbeat = time.monotonic()
                    await asyncio.sleep(1)
            finally:
                async with application.state.sse_lock:
                    application.state.sse_clients -= 1

        return StreamingResponse(
            stream(), media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    application.mount("/static", StaticFiles(directory=STATIC), name="static")
    return application


app = create_app()
