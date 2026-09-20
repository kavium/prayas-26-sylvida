import struct

from fastapi.testclient import TestClient

from app.main import app


def polygon_feature_collection() -> dict[str, object]:
    return {
        "type": "FeatureCollection",
        "features": [
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
                "properties": {"type": "Residential", "building_levels": 4},
            }
        ],
    }


def test_massing_endpoint_returns_browser_ready_glb():
    with TestClient(app) as client:
        response = client.post(
            "/v1/three-d/massing",
            json={"feature_collection": polygon_feature_collection(), "meters_per_floor": 3.5},
        )

    assert response.status_code == 200
    assert response.headers["content-type"] == "model/gltf-binary"
    assert response.headers["content-disposition"] == 'attachment; filename="city-massing.glb"'
    assert response.headers["x-prayas-polygon-features"] == "1"
    magic, version, length = struct.unpack("<III", response.content[:12])
    assert magic == 0x46546C67
    assert version == 2
    assert length == len(response.content)


def test_massing_endpoint_explains_invalid_geojson():
    with TestClient(app) as client:
        response = client.post(
            "/v1/three-d/massing",
            json={"feature_collection": {"type": "FeatureCollection", "features": []}},
        )

    assert response.status_code == 422
    assert "no valid Polygon" in response.json()["detail"]
