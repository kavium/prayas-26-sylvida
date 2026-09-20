"""Command-line workflows for city massing and selective TripoSR assets."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Sequence

from app.integrations.triposr.config import TripoSRConfig
from app.integrations.triposr.errors import TripoSRIntegrationError
from app.integrations.triposr.massing import build_city_massing
from app.integrations.triposr.provider import TripoSRProvider
from app.integrations.triposr.service import (
    GeoJSONAssetService,
    load_feature_collection,
    write_feature_collection,
)


def build_parser() -> argparse.ArgumentParser:
    """Create the two-command integration CLI."""
    parser = argparse.ArgumentParser(
        description="Create exact city massing or selected 3D assets from Prayas GeoJSON."
    )
    commands = parser.add_subparsers(dest="command", required=True)

    massing = commands.add_parser("massing", help="Extrude GeoJSON polygons into one GLB")
    massing.add_argument("input", type=Path, help="Planning GeoJSON FeatureCollection")
    massing.add_argument("output", type=Path, help="Output city massing .glb")
    massing.add_argument("--default-height-m", type=float, default=6.0)
    massing.add_argument("--meters-per-floor", type=float, default=3.0)

    assets = commands.add_parser(
        "assets", help="Generate models for eligible features with triposr_image"
    )
    assets.add_argument("input", type=Path, help="Planning GeoJSON FeatureCollection")
    assets.add_argument("output", type=Path, help="Enriched output GeoJSON")
    assets.add_argument(
        "--asset-dir", type=Path, default=Path("artifacts/3d-assets"), help="GLB directory"
    )
    assets.add_argument(
        "--public-base-url",
        help="Optional browser-visible base URL used for olcs_modelUrl",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    """Run a CLI command and return a process exit code."""
    parser = build_parser()
    arguments = parser.parse_args(argv)
    try:
        document = load_feature_collection(arguments.input)
        if arguments.command == "massing":
            summary = build_city_massing(
                document,
                arguments.output,
                default_height_m=arguments.default_height_m,
                meters_per_floor=arguments.meters_per_floor,
            )
            payload = {
                "output": str(arguments.output),
                "polygon_features": summary.polygon_features,
                "triangles": summary.triangles,
                "origin": [summary.origin_x, summary.origin_y],
            }
        else:
            provider = TripoSRProvider(TripoSRConfig.from_env())
            enriched, summary = GeoJSONAssetService(provider).process(
                document,
                source_directory=arguments.input.resolve().parent,
                asset_directory=arguments.asset_dir,
                public_base_url=arguments.public_base_url,
            )
            write_feature_collection(enriched, arguments.output)
            payload = {
                "output": str(arguments.output),
                "asset_directory": str(arguments.asset_dir),
                "generated": summary.generated,
                "skipped": summary.skipped,
            }
    except TripoSRIntegrationError as error:
        parser.error(str(error))
    print(json.dumps(payload))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
