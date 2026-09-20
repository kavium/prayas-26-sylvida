# Prayas GeoJSON to 3D integration

This module sits after zoning and pathway optimisation. Upstream ML/regression
and `backend/app/pathways` produce the planning data; GeoJSON remains the source
of truth for coordinates, height, land use, population, roads, and accessibility.

```text
zoning ML -> pathway optimisation -> GeoJSON
                                      |       \
                                      |        reference image on selected feature
                                      v         v
                            polygon extrusion  TripoSR worker
                                      |         |
                                      +----+----+
                                           v
                                  GLB + enriched GeoJSON
```

The package is under `backend/app/integrations/triposr`. It has two independent
workflows:

- `massing` deterministically extrudes Polygon and MultiPolygon features into a
  city GLB. It does not invoke an AI model.
- `assets` sends only `poi`, `building`, or `landmark` features with an explicit
  `triposr_image` property to TripoSR, then writes model references into a copy
  of the GeoJSON.

Road LineStrings and ordinary zoning polygons are never sent to TripoSR. That
keeps planning geometry exact and makes the massing demo work without a GPU.

## GeoJSON contract

Massing reads `height_m`, or `building_levels`/`levels` multiplied by the CLI's
`--meters-per-floor`. Features without either use `--default-height-m`.
Geographic coordinates are converted to a local metric frame before extrusion.

An asset request looks like this:

```json
{
  "type": "Feature",
  "id": "hospital-1",
  "geometry": {"type": "Point", "coordinates": [77.5918, 12.97055]},
  "properties": {
    "feature_kind": "poi",
    "poi_type": "hospital",
    "triposr_image": "reference/hospital.png"
  }
}
```

`triposr_image` is resolved relative to the input GeoJSON file. It must be a
local JPG, PNG, or WebP available to the trusted worker. After generation the
copied feature contains:

```json
{
  "model_provider": "triposr",
  "model_local_path": "artifacts/3d-assets/hospital-1.glb",
  "olcs_modelUrl": "https://assets.example.test/models/hospital-1.glb"
}
```

`olcs_modelUrl` is added only when `--public-base-url` is supplied. In a hosted
deployment, upload the GLB to scenario-scoped object storage and use an
authorized or signed URL rather than exposing a worker filesystem path.

## City massing demo

From `backend/`:

```bash
python -m app.integrations.triposr.cli massing \
  examples/triposr/sample_city.geojson \
  artifacts/city_massing.glb
```

The committed sample is synthetic. It includes two polygon masses, a hospital
point, and a road LineString so the geometry boundary is visible.

## TripoSR worker setup

Clone the [official TripoSR repository](https://github.com/VAST-AI-Research/TripoSR)
and install its requirements in a separate environment. Configure the adapter
from the root example file:

```bash
cp .env.triposr.example .env.triposr
```

Export those values in the worker environment. `TRIPOSR_REPOSITORY_PATH` must
contain the official `run.py`; `TRIPOSR_PYTHON_EXECUTABLE` should point to the
Python executable where its PyTorch/CUDA requirements are installed. The
Prayas process invokes:

```text
<triposr-python> <TripoSR>/run.py <image> \
  --output-dir <temporary-dir> \
  --device cuda:0 \
  --model-save-format glb
```

The provider copies the official `0/mesh.glb` result to a stable
`<asset-dir>/<feature-id>.glb` path. It captures worker output, applies a timeout,
and reports a concise error if the subprocess fails.

Add a real reference image to a supported feature, then run from `backend/`:

```bash
python -m app.integrations.triposr.cli assets \
  examples/triposr/sample_city.geojson \
  artifacts/city_with_models.geojson \
  --asset-dir artifacts/3d-assets \
  --public-base-url https://assets.example.test/models
```

## Code boundary and future providers

`ThreeDAssetProvider` is the stable provider protocol. `GeoJSONAssetService`
knows only that protocol, so a later TRELLIS or hosted provider can replace
TripoSR without changing zoning, routing, assignment, or GeoJSON enrichment.
Likewise, future ACO/GA pathway design continues to produce planning GeoJSON and
does not depend on the rendering provider.

The FastAPI process does not load TripoSR, PyTorch, CUDA, or model weights. The
existing durable-job scaffold should eventually stage authorized images, invoke
this integration in a worker, upload results, and persist object-storage keys.

## Checks

The tests use a fake provider and fake official CLI process. They cover feature
selection, enrichment, missing images, official command construction, output
normalization, and valid GLB massing without downloading model weights or using
a GPU:

```bash
pytest tests/test_triposr_integration.py
```
