"""GeoJSON orchestration for selective image-to-3D asset generation."""

from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any
from urllib.parse import quote, urlsplit

from app.integrations.triposr.errors import AssetGenerationError, InvalidGeoJSONError
from app.integrations.triposr.models import (
    ELIGIBLE_FEATURE_KINDS,
    AssetProcessingSummary,
    AssetRequest,
)
from app.integrations.triposr.provider import ThreeDAssetProvider

JsonObject = dict[str, Any]


def validate_feature_collection(document: JsonObject) -> list[JsonObject]:
    """Return typed features or raise a useful error for malformed input."""
    if document.get("type") != "FeatureCollection":
        raise InvalidGeoJSONError("Input must be a GeoJSON FeatureCollection")
    features = document.get("features")
    if not isinstance(features, list):
        raise InvalidGeoJSONError("GeoJSON FeatureCollection.features must be a list")
    if not all(isinstance(feature, dict) for feature in features):
        raise InvalidGeoJSONError("Every GeoJSON feature must be an object")
    return features


class GeoJSONAssetService:
    """Generate models only for explicitly eligible GeoJSON features.

    Geometry and planning properties are copied unchanged. A feature is sent to
    the provider only when its ``feature_kind`` is ``poi``, ``building``, or
    ``landmark`` and it contains a local ``triposr_image`` property.
    """

    def __init__(self, provider: ThreeDAssetProvider) -> None:
        self._provider = provider

    def process(
        self,
        document: JsonObject,
        *,
        source_directory: Path,
        asset_directory: Path,
        public_base_url: str | None = None,
    ) -> tuple[JsonObject, AssetProcessingSummary]:
        """Return an enriched copy of a FeatureCollection and generation counts."""
        enriched = copy.deepcopy(document)
        features = validate_feature_collection(enriched)
        generated = 0
        skipped = 0
        generated_ids: set[str] = set()

        for feature in features:
            properties = feature.get("properties")
            if not isinstance(properties, dict):
                properties = {}
                feature["properties"] = properties

            image_reference = properties.get("triposr_image")
            feature_kind = str(properties.get("feature_kind", "")).strip().lower()
            if not image_reference or feature_kind not in ELIGIBLE_FEATURE_KINDS:
                skipped += 1
                continue
            if not isinstance(image_reference, str):
                raise AssetGenerationError("triposr_image must be a local path string")

            feature_id = feature.get("id", properties.get("id"))
            if not isinstance(feature_id, str) or not feature_id.strip():
                raise AssetGenerationError(
                    "Each feature requesting TripoSR must have a non-empty string id"
                )
            if feature_id in generated_ids:
                raise AssetGenerationError(
                    f"Feature ids requesting TripoSR must be unique: {feature_id}"
                )
            generated_ids.add(feature_id)
            image_path = self._resolve_image(source_directory, image_reference)
            result = self._provider.generate(
                AssetRequest(
                    feature_id=feature_id,
                    image_path=image_path,
                    asset_directory=asset_directory,
                )
            )
            local_reference = (asset_directory / result.mesh_path.name).as_posix()
            properties["model_provider"] = result.provider
            properties["model_local_path"] = local_reference
            if public_base_url:
                properties["olcs_modelUrl"] = (
                    f"{public_base_url.rstrip('/')}/{quote(result.mesh_path.name)}"
                )
            generated += 1

        return enriched, AssetProcessingSummary(generated=generated, skipped=skipped)

    @staticmethod
    def _resolve_image(source_directory: Path, image_reference: str) -> Path:
        parsed = urlsplit(image_reference)
        windows_drive = len(parsed.scheme) == 1 and image_reference[1:3] in {":\\", ":/"}
        if parsed.scheme and not windows_drive:
            raise AssetGenerationError("triposr_image must be a local file path, not a URL")
        image_path = Path(image_reference).expanduser()
        if not image_path.is_absolute():
            image_path = source_directory / image_path
        return image_path.resolve()


def load_feature_collection(path: Path) -> JsonObject:
    """Load a UTF-8 GeoJSON object from disk."""
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as error:
        raise InvalidGeoJSONError(f"GeoJSON file does not exist: {path}") from error
    except json.JSONDecodeError as error:
        raise InvalidGeoJSONError(f"GeoJSON is not valid JSON: {error}") from error
    if not isinstance(document, dict):
        raise InvalidGeoJSONError("GeoJSON root must be an object")
    validate_feature_collection(document)
    return document


def write_feature_collection(document: JsonObject, path: Path) -> None:
    """Write an enriched FeatureCollection atomically."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(f"{path.suffix}.partial")
    temporary.write_text(
        json.dumps(document, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    temporary.replace(path)
