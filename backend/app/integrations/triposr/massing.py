"""Deterministic GeoJSON polygon extrusion into a compact binary glTF file."""

from __future__ import annotations

import json
import math
import struct
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from shapely.geometry import Polygon, shape
from shapely.ops import triangulate

from app.integrations.triposr.errors import InvalidGeoJSONError, MassingGenerationError
from app.integrations.triposr.models import MassingSummary
from app.integrations.triposr.service import JsonObject, validate_feature_collection

Vector3 = tuple[float, float, float]

_COLORS: dict[str, tuple[float, float, float, float]] = {
    "residential": (0.72, 0.76, 0.86, 1.0),
    "commercial": (0.91, 0.69, 0.30, 1.0),
    "industrial": (0.57, 0.60, 0.64, 1.0),
    "green": (0.32, 0.66, 0.38, 1.0),
    "civic": (0.38, 0.60, 0.82, 1.0),
    "default": (0.68, 0.70, 0.72, 1.0),
}


@dataclass(frozen=True, slots=True)
class _Projection:
    origin_x: float
    origin_y: float
    geographic: bool

    def point(self, x: float, y: float, height: float) -> Vector3:
        if self.geographic:
            east = (x - self.origin_x) * 111_320.0 * math.cos(math.radians(self.origin_y))
            north = (y - self.origin_y) * 110_540.0
        else:
            east = x - self.origin_x
            north = y - self.origin_y
        return (float(east), float(height), float(-north))


@dataclass(slots=True)
class _Primitive:
    name: str
    material: str
    positions: list[Vector3]
    normals: list[Vector3]


def build_city_massing(
    document: JsonObject,
    output_path: Path,
    *,
    default_height_m: float = 6.0,
    meters_per_floor: float = 3.0,
) -> MassingSummary:
    """Extrude every valid Polygon/MultiPolygon feature and write one GLB.

    Geographic coordinates are projected to a local metric frame around the
    dataset center. Existing planar coordinates are translated to the same
    local-origin convention. Point and line features remain in GeoJSON and are
    intentionally ignored by this massing representation.
    """
    if default_height_m <= 0 or meters_per_floor <= 0:
        raise MassingGenerationError("Massing heights must be positive")
    features = validate_feature_collection(document)
    polygon_entries: list[tuple[JsonObject, Polygon]] = []
    coordinates: list[tuple[float, float]] = []

    for feature in features:
        geometry_data = feature.get("geometry")
        if not isinstance(geometry_data, dict):
            continue
        if geometry_data.get("type") not in {"Polygon", "MultiPolygon"}:
            continue
        try:
            geometry = shape(geometry_data)
        except (TypeError, ValueError) as error:
            raise InvalidGeoJSONError(f"Invalid polygon geometry: {error}") from error
        polygons = [geometry] if isinstance(geometry, Polygon) else list(geometry.geoms)
        for polygon in polygons:
            if polygon.is_empty or not polygon.is_valid or polygon.area <= 0:
                raise InvalidGeoJSONError("Polygon massing geometry must be valid and non-empty")
            polygon_entries.append((feature, polygon))
            coordinates.extend((float(x), float(y)) for x, y in polygon.exterior.coords)

    if not polygon_entries:
        raise MassingGenerationError("GeoJSON contains no valid Polygon or MultiPolygon features")

    min_x = min(point[0] for point in coordinates)
    max_x = max(point[0] for point in coordinates)
    min_y = min(point[1] for point in coordinates)
    max_y = max(point[1] for point in coordinates)
    origin_x = (min_x + max_x) / 2
    origin_y = (min_y + max_y) / 2
    geographic = all(-180 <= x <= 180 and -90 <= y <= 90 for x, y in coordinates)
    projection = _Projection(origin_x, origin_y, geographic)

    primitives: list[_Primitive] = []
    for index, (feature, polygon) in enumerate(polygon_entries):
        properties = feature.get("properties")
        properties = properties if isinstance(properties, dict) else {}
        height = _height(properties, default_height_m, meters_per_floor)
        base_height = _positive_number(
            properties.get("base_height_m"), default=0.0, allow_zero=True
        )
        if base_height < 0:
            raise MassingGenerationError("base_height_m cannot be negative")
        feature_id = str(feature.get("id") or properties.get("id") or f"polygon-{index}")
        land_use = str(properties.get("type") or properties.get("land_use") or "default").lower()
        material = land_use if land_use in _COLORS else "default"
        positions, normals = _extrude(polygon, projection, base_height, base_height + height)
        if positions:
            primitives.append(_Primitive(feature_id, material, positions, normals))

    if not primitives:
        raise MassingGenerationError("Polygon triangulation produced no massing surfaces")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    _write_glb(primitives, output_path)
    triangle_count = sum(len(primitive.positions) // 3 for primitive in primitives)
    return MassingSummary(
        polygon_features=len(primitives),
        triangles=triangle_count,
        origin_x=origin_x,
        origin_y=origin_y,
    )


def _positive_number(value: Any, *, default: float, allow_zero: bool = False) -> float:
    if value is None or value == "":
        return default
    if isinstance(value, bool):
        raise MassingGenerationError("Height properties must be numeric")
    try:
        number = float(value)
    except (TypeError, ValueError) as error:
        raise MassingGenerationError("Height properties must be numeric") from error
    if number < 0 or (number == 0 and not allow_zero):
        raise MassingGenerationError("Height properties must be positive")
    return number


def _height(properties: JsonObject, default_height: float, meters_per_floor: float) -> float:
    height = properties.get("height_m")
    if height is not None and height != "":
        return _positive_number(height, default=default_height)
    levels = properties.get("building_levels", properties.get("levels"))
    if levels is not None and levels != "":
        return _positive_number(levels, default=1.0) * meters_per_floor
    return default_height


def _extrude(
    polygon: Polygon,
    projection: _Projection,
    base_height: float,
    top_height: float,
) -> tuple[list[Vector3], list[Vector3]]:
    positions: list[Vector3] = []
    normals: list[Vector3] = []

    for triangle in triangulate(polygon):
        if not polygon.covers(triangle):
            continue
        points = list(triangle.exterior.coords)[:3]
        top = [projection.point(x, y, top_height) for x, y in points]
        bottom = [projection.point(x, y, base_height) for x, y in reversed(points)]
        positions.extend(top)
        normals.extend([(0.0, 1.0, 0.0)] * 3)
        positions.extend(bottom)
        normals.extend([(0.0, -1.0, 0.0)] * 3)

    rings = [polygon.exterior, *polygon.interiors]
    for ring in rings:
        points = list(ring.coords)
        for first, second in zip(points, points[1:], strict=False):
            bottom_a = projection.point(first[0], first[1], base_height)
            bottom_b = projection.point(second[0], second[1], base_height)
            top_a = projection.point(first[0], first[1], top_height)
            top_b = projection.point(second[0], second[1], top_height)
            dx = bottom_b[0] - bottom_a[0]
            dz = bottom_b[2] - bottom_a[2]
            length = math.hypot(dx, dz)
            if length == 0:
                continue
            normal = (-dz / length, 0.0, dx / length)
            positions.extend([bottom_a, bottom_b, top_b, bottom_a, top_b, top_a])
            normals.extend([normal] * 6)
    return positions, normals


def _packed_vectors(vectors: list[Vector3]) -> bytes:
    flattened = (coordinate for vector in vectors for coordinate in vector)
    return struct.pack(f"<{len(vectors) * 3}f", *flattened)


def _write_glb(primitives: list[_Primitive], output_path: Path) -> None:
    binary = bytearray()
    buffer_views: list[JsonObject] = []
    accessors: list[JsonObject] = []
    meshes: list[JsonObject] = []
    nodes: list[JsonObject] = []
    material_names = sorted({primitive.material for primitive in primitives})
    material_indices = {name: index for index, name in enumerate(material_names)}

    def add_view(data: bytes, target: int) -> int:
        while len(binary) % 4:
            binary.append(0)
        offset = len(binary)
        binary.extend(data)
        buffer_views.append(
            {"buffer": 0, "byteOffset": offset, "byteLength": len(data), "target": target}
        )
        return len(buffer_views) - 1

    def add_accessor(vectors: list[Vector3], view: int, *, bounds: bool) -> int:
        accessor: JsonObject = {
            "bufferView": view,
            "componentType": 5126,
            "count": len(vectors),
            "type": "VEC3",
        }
        if bounds:
            accessor["min"] = [min(vector[axis] for vector in vectors) for axis in range(3)]
            accessor["max"] = [max(vector[axis] for vector in vectors) for axis in range(3)]
        accessors.append(accessor)
        return len(accessors) - 1

    for primitive in primitives:
        position_view = add_view(_packed_vectors(primitive.positions), 34962)
        normal_view = add_view(_packed_vectors(primitive.normals), 34962)
        position_accessor = add_accessor(primitive.positions, position_view, bounds=True)
        normal_accessor = add_accessor(primitive.normals, normal_view, bounds=False)
        meshes.append(
            {
                "name": primitive.name,
                "primitives": [
                    {
                        "attributes": {
                            "POSITION": position_accessor,
                            "NORMAL": normal_accessor,
                        },
                        "material": material_indices[primitive.material],
                        "mode": 4,
                    }
                ],
            }
        )
        nodes.append({"name": primitive.name, "mesh": len(meshes) - 1})

    materials = [
        {
            "name": name,
            "pbrMetallicRoughness": {
                "baseColorFactor": list(_COLORS[name]),
                "metallicFactor": 0.0,
                "roughnessFactor": 0.9,
            },
            "doubleSided": True,
        }
        for name in material_names
    ]
    gltf: JsonObject = {
        "asset": {"version": "2.0", "generator": "Prayas deterministic massing"},
        "scene": 0,
        "scenes": [{"nodes": list(range(len(nodes)))}],
        "nodes": nodes,
        "meshes": meshes,
        "materials": materials,
        "buffers": [{"byteLength": len(binary)}],
        "bufferViews": buffer_views,
        "accessors": accessors,
    }
    json_bytes = json.dumps(gltf, separators=(",", ":")).encode("utf-8")
    json_bytes += b" " * ((-len(json_bytes)) % 4)
    binary.extend(b"\x00" * ((-len(binary)) % 4))
    total_length = 12 + 8 + len(json_bytes) + 8 + len(binary)
    glb = bytearray(struct.pack("<III", 0x46546C67, 2, total_length))
    glb.extend(struct.pack("<II", len(json_bytes), 0x4E4F534A))
    glb.extend(json_bytes)
    glb.extend(struct.pack("<II", len(binary), 0x004E4942))
    glb.extend(binary)
    temporary = output_path.with_suffix(f"{output_path.suffix}.partial")
    temporary.write_bytes(glb)
    temporary.replace(output_path)
