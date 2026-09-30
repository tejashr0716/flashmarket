from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class CatalogFilters(StrictModel):
    search: str = Field(default="", max_length=100)
    category_id: int | None = Field(default=None, gt=0)
    brand_id: list[int] = Field(default_factory=list, max_length=20)
    min_price: Decimal | None = Field(default=None, ge=0, max_digits=10, decimal_places=2)
    max_price: Decimal | None = Field(default=None, ge=0, max_digits=10, decimal_places=2)
    stock: Literal["all", "in", "low", "out"] = "all"
    min_rating: Decimal | None = Field(default=None, ge=0, le=5, decimal_places=1)
    sort: Literal["newest", "name", "price_asc", "price_desc", "rating_desc", "stock_desc"] = "newest"
    limit: int = Field(default=100, ge=1, le=1000)
    offset: int = Field(default=0, ge=0, le=100000)

    @model_validator(mode="after")
    def validate_ranges(self):
        if any(brand <= 0 for brand in self.brand_id):
            raise ValueError("brand_id values must be positive")
        if self.min_price is not None and self.max_price is not None:
            if self.min_price > self.max_price:
                raise ValueError("min_price cannot exceed max_price")
        # Stable placeholder order and no unnecessary duplicate conditions.
        self.brand_id = list(dict.fromkeys(self.brand_id))
        return self


class ProductCreate(StrictModel):
    sku: str = Field(min_length=3, max_length=32, pattern=r"^[A-Z0-9][A-Z0-9-]+$")
    name: str = Field(min_length=3, max_length=160)
    description: str = Field(default="", max_length=1000)
    category_id: int = Field(gt=0)
    brand_id: int = Field(gt=0)
    price: Decimal = Field(ge=0, max_digits=10, decimal_places=2)
    stock: int = Field(ge=0, le=100000)
    rating: Decimal = Field(default=Decimal("0.0"), ge=0, le=5, decimal_places=1)


class ProductPatch(StrictModel):
    expected_version: int = Field(ge=0)
    name: str | None = Field(default=None, min_length=3, max_length=160)
    description: str | None = Field(default=None, max_length=1000)
    category_id: int | None = Field(default=None, gt=0)
    brand_id: int | None = Field(default=None, gt=0)
    price: Decimal | None = Field(default=None, ge=0, max_digits=10, decimal_places=2)
    rating: Decimal | None = Field(default=None, ge=0, le=5, decimal_places=1)

    @model_validator(mode="after")
    def validate_patch(self):
        fields = self.model_fields_set - {"expected_version"}
        if not fields:
            raise ValueError("Provide at least one product field to update")
        if any(getattr(self, field) is None for field in fields):
            raise ValueError("Product fields cannot be null")
        return self


class StockUpdate(StrictModel):
    stock: int = Field(ge=0, le=100000)
    expected_version: int = Field(ge=0)
    reason: str = Field(default="Manual adjustment", min_length=3, max_length=120)


class ProductOut(BaseModel):
    id: int
    sku: str
    name: str
    description: str
    category_id: int
    category: str
    brand_id: int
    brand: str
    price: float
    stock: int
    rating: float
    version: int
    is_sample: bool
    created_at: datetime
    updated_at: datetime


class CatalogOut(BaseModel):
    items: list[ProductOut]
    total: int
    limit: int
    offset: int
