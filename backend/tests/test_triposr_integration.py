import json
import struct
import subprocess
import sys
from pathlib import Path

import pytest

from app.integrations.triposr.config import TripoSRConfig
from app.integrations.triposr.errors import (
    AssetGenerationError,
    InvalidGeoJSONError,
    MassingGenerationError,
)
from app.integrations.triposr.massing import build_city_massing
from app.integrations.triposr.models import AssetRequest, AssetResult
from app.integrations.triposr.provider import TripoSRProvider
from app.integrations.triposr.service import GeoJSONAssetService, load_feature_collection


def feature_collection(*features: dict[str, object]) -> dict[str, object]:
    return {"type": "FeatureCollection", "features": list(features)}


class RecordingProvider:
    name = "recording"

    def __init__(self) -> None:
        self.requests: list[AssetRequest] = []

    def generate(self, request: AssetRequest) -> AssetResult:
        request.validate()
        self.requests.append(request)
        request.asset_directory.mkdir(parents=True, exist_ok=True)
        request.output_path.write_bytes(b"glTF")
        return AssetResult(request.feature_id, request.output_path, self.name, 0.01)


def test_geojson_service_generates_only_explicit_eligible_assets(tmp_path: Path):
    image = tmp_path / "hospital.png"
    image.write_bytes(b"reference")
    document = feature_collection(
        {
            "type": "Feature",
            "id": "hospital-1",
            "geometry": {"type": "Point", "coordinates": [77.6, 12.9]},
            "properties": {"feature_kind": "poi", "triposr_image": "hospital.png"},
        },
        {
            "type": "Feature",
            "id": "road-1",
            "geometry": {"type": "LineString", "coordinates": [[0, 0], [1, 1]]},
            "properties": {"feature_kind": "road", "triposr_image": "hospital.png"},
        },
        {
            "type": "Feature",
            "id": "zone-1",
            "geometry": {"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 0]]]},
            "properties": {"feature_kind": "zone"},
        },
    )
    provider = RecordingProvider()

    enriched, summary = GeoJSONAssetService(provider).process(
        document,
        source_directory=tmp_path,
        asset_directory=tmp_path / "assets",
        public_base_url="https://assets.example.test/models",
    )

    assert [request.feature_id for request in provider.requests] == ["hospital-1"]
    assert summary.generated == 1
    assert summary.skipped == 2
    properties = enriched["features"][0]["properties"]  # type: ignore[index]
    assert properties["model_provider"] == "recording"
    assert properties["model_local_path"].endswith("assets/hospital-1.glb")
    assert properties["olcs_modelUrl"] == (
        "https://assets.example.test/models/hospital-1.glb"
    )
    assert "model_provider" not in document["features"][0]["properties"]  # type: ignore[index]


def test_geojson_service_rejects_missing_images_for_eligible_features(tmp_path: Path):
    document = feature_collection(
        {
            "type": "Feature",
            "id": "school-1",
            "geometry": {"type": "Point", "coordinates": [0, 0]},
            "properties": {"feature_kind": "poi", "triposr_image": "missing.png"},
        }
    )

    with pytest.raises(AssetGenerationError, match="does not exist"):
        GeoJSONAssetService(RecordingProvider()).process(
            document, source_directory=tmp_path, asset_directory=tmp_path / "assets"
        )


def test_official_provider_builds_cli_and_normalizes_output(tmp_path: Path):
    repository = tmp_path / "TripoSR"
    repository.mkdir()
    (repository / "run.py").write_text("# official entry point", encoding="utf-8")
    image = tmp_path / "station.webp"
    image.write_bytes(b"reference")
    calls: list[list[str]] = []

    def fake_runner(command: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
        calls.append(command)
        output_directory = Path(command[command.index("--output-dir") + 1])
        generated = output_directory / "0" / "mesh.glb"
        generated.parent.mkdir(parents=True)
        generated.write_bytes(b"glTF-model")
        return subprocess.CompletedProcess(command, 0, "", "")

    config = TripoSRConfig(
        repository_path=repository,
        python_executable=sys.executable,
        device="cpu",
        remove_background=False,
    )
    request = AssetRequest("station-1", image, tmp_path / "assets")

    result = TripoSRProvider(config, runner=fake_runner).generate(request)

    assert result.mesh_path.read_bytes() == b"glTF-model"
    command = calls[0]
    assert command[:3] == [sys.executable, str(repository / "run.py"), str(image)]
    assert command[command.index("--model-save-format") + 1] == "glb"
    assert "--no-remove-bg" in command


def test_massing_extrudes_polygon_and_writes_valid_glb_header(tmp_path: Path):
    document = feature_collection(
        {
            "type": "Feature",
            "id": "block-a",
            "geometry": {
                "type": "Polygon",
                "coordinates": [
                    [
                        [77.5900, 12.9700],
                        [77.5910, 12.9700],
                        [77.5910, 12.9710],
                        [77.5900, 12.9710],
                        [77.5900, 12.9700],
                    ]
                ],
            },
            "properties": {"type": "Residential", "height_m": 12},
        }
    )
    output = tmp_path / "city.glb"

    summary = build_city_massing(document, output)

    data = output.read_bytes()
    magic, version, length = struct.unpack("<III", data[:12])
    json_length, json_kind = struct.unpack("<II", data[12:20])
    gltf = json.loads(data[20 : 20 + json_length].decode("utf-8"))
    assert magic == 0x46546C67
    assert version == 2
    assert length == len(data)
    assert json_kind == 0x4E4F534A
    assert gltf["asset"]["version"] == "2.0"
    assert gltf["meshes"][0]["name"] == "block-a"
    assert summary.polygon_features == 1
    assert summary.triangles >= 12


def test_massing_rejects_a_feature_collection_without_polygons(tmp_path: Path):
    document = feature_collection(
        {
            "type": "Feature",
            "id": "hospital",
            "geometry": {"type": "Point", "coordinates": [0, 0]},
            "properties": {"feature_kind": "poi"},
        }
    )

    with pytest.raises(MassingGenerationError, match="no valid Polygon"):
        build_city_massing(document, tmp_path / "city.glb")


def test_geojson_loader_reports_invalid_root(tmp_path: Path):
    path = tmp_path / "invalid.geojson"
    path.write_text(json.dumps([]), encoding="utf-8")

    with pytest.raises(InvalidGeoJSONError, match="root"):
        load_feature_collection(path)
