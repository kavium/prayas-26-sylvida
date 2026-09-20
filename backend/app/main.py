from contextlib import asynccontextmanager
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Annotated
from uuid import UUID

import httpx
from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response

from app.config import get_settings
from app.dependencies import require_user
from app.integrations.triposr.errors import InvalidGeoJSONError, MassingGenerationError
from app.integrations.triposr.massing import build_city_massing
from app.schemas import JobAccepted, JobRequest, JobStatus, MassingRequest


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with httpx.AsyncClient(timeout=10) as client:
        app.state.http = client
        yield


app = FastAPI(title="Prayas API", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origins,
    allow_methods=["GET", "POST"],
    allow_headers=["Authorization", "Content-Type"],
)


@app.get("/health", tags=["infrastructure"])
async def health():
    """Process liveness only; does not claim cloud connectivity."""
    return {"status": "ok", "service": "prayas-api", "version": "0.1.0"}


@app.post("/v1/three-d/massing", tags=["three-d"])
async def create_city_massing(payload: MassingRequest):
    """Convert planning GeoJSON polygons into a browser-ready GLB.

    This deterministic path deliberately does not start TripoSR or load GPU
    model weights. Polygon geometry, `height_m`, `building_levels`, and
    `levels` become exact 3D city massing in the returned binary GLB.
    """
    try:
        with TemporaryDirectory(prefix="prayas-massing-") as temporary:
            output_path = Path(temporary) / "city-massing.glb"
            summary = build_city_massing(
                payload.feature_collection,
                output_path,
                default_height_m=payload.default_height_m,
                meters_per_floor=payload.meters_per_floor,
            )
            glb = output_path.read_bytes()
    except (InvalidGeoJSONError, MassingGenerationError) as error:
        raise HTTPException(status_code=422, detail=str(error)) from error

    return Response(
        content=glb,
        media_type="model/gltf-binary",
        headers={
            "Content-Disposition": 'attachment; filename="city-massing.glb"',
            "X-Prayas-Polygon-Features": str(summary.polygon_features),
            "X-Prayas-Triangles": str(summary.triangles),
        },
    )


@app.post("/v1/jobs", response_model=JobAccepted, status_code=202, tags=["jobs"])
async def create_job(payload: JobRequest, user_id: Annotated[str, Depends(require_user)]):
    # Wire durable persistence + a separate worker before accepting any real jobs.
    raise HTTPException(501, "Job execution is not implemented in this scaffold")


@app.get("/v1/jobs/{job_id}", response_model=JobStatus, tags=["jobs"])
async def get_job(job_id: UUID, user_id: Annotated[str, Depends(require_user)]):
    # Future lookup MUST scope the query to this verified user_id.
    raise HTTPException(501, "Job persistence is not implemented in this scaffold")
