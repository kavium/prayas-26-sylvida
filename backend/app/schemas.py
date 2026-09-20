from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field


class JobRequest(BaseModel):
    # Persist this generic envelope unchanged; pathway workers validate its contents
    # with app.pathways.inputs.PathwayParameters before calling pathway_optimizer.
    parameters: dict[str, Any] = Field(default_factory=dict)


class JobAccepted(BaseModel):
    job_id: UUID
    status: Literal["queued"] = "queued"


class JobStatus(BaseModel):
    job_id: UUID
    status: Literal["queued", "running", "succeeded", "failed"]
    created_at: datetime
    result_path: str | None = None
    error: str | None = None


class MassingRequest(BaseModel):
    """A planning GeoJSON document ready for deterministic 3D extrusion."""

    feature_collection: dict[str, Any]
    default_height_m: float = Field(default=6.0, gt=0, le=1_000)
    meters_per_floor: float = Field(default=3.0, gt=0, le=100)
