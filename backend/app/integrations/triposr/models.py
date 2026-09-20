"""Typed contracts shared by 3D asset providers and GeoJSON orchestration."""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

from app.integrations.triposr.errors import AssetGenerationError

ELIGIBLE_FEATURE_KINDS = frozenset({"poi", "building", "landmark"})
SUPPORTED_IMAGE_SUFFIXES = frozenset({".jpg", ".jpeg", ".png", ".webp"})
_SAFE_IDENTIFIER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]*$")


@dataclass(frozen=True, slots=True)
class AssetRequest:
    """One trusted, worker-local image requested by a GeoJSON feature."""

    feature_id: str
    image_path: Path
    asset_directory: Path

    def validate(self) -> None:
        """Validate the stable identifier and local image before model work."""
        if not _SAFE_IDENTIFIER.fullmatch(self.feature_id):
            raise AssetGenerationError(
                "Feature id must start with a letter or number and contain only "
                "letters, numbers, hyphens, and underscores"
            )
        if not self.image_path.is_file():
            raise AssetGenerationError(f"TripoSR image does not exist: {self.image_path}")
        if self.image_path.suffix.lower() not in SUPPORTED_IMAGE_SUFFIXES:
            supported = ", ".join(sorted(SUPPORTED_IMAGE_SUFFIXES))
            raise AssetGenerationError(f"TripoSR image must be one of: {supported}")

    @property
    def output_path(self) -> Path:
        """Stable GLB destination shared by all provider implementations."""
        return self.asset_directory / f"{self.feature_id}.glb"


@dataclass(frozen=True, slots=True)
class AssetResult:
    """A GLB created by an image-to-3D provider."""

    feature_id: str
    mesh_path: Path
    provider: str
    elapsed_seconds: float


@dataclass(frozen=True, slots=True)
class AssetProcessingSummary:
    """Counts returned after enriching a FeatureCollection."""

    generated: int
    skipped: int


@dataclass(frozen=True, slots=True)
class MassingSummary:
    """Counts and coordinate origin for a deterministic city GLB."""

    polygon_features: int
    triangles: int
    origin_x: float
    origin_y: float
