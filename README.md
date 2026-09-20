# Prayas

Geospatial planning scaffold with an integrated Python pathway module. No dashboard,
login screen, or working job execution is implemented yet.

**Start with [the setup guide](docs/SETUP.md)** for GitHub, Supabase, local development,
Vercel, Render, your domain, and v0.

## Layout

```text
frontend/            Next.js App Router + TypeScript + Tailwind + shadcn/ui
  src/components/    Minimal connection checks and lazy MapLibre/deck.gl canvas
  src/lib/supabase/  Browser/server clients, session refresh, private storage helpers
  src/lib/api/      Typed FastAPI client and cancellable job polling helper
backend/             FastAPI + locked GIS/optimisation dependencies
  supabase/          Supabase CLI config + PostGIS/storage/job-table migration
  scripts/           Backend tooling, including OpenAPI export
docs/SETUP.md        Account setup and deployment walkthrough
render.yaml          Render deployment blueprint for the API
```

## Local development

Requires Node.js 22 and [uv](https://docs.astral.sh/uv/getting-started/installation/).
uv manages Python 3.12 and the Python virtual environment.

```bash
npm ci
npm --prefix frontend ci
uv sync --directory backend --locked
cp frontend/.env.example frontend/.env.local
cp backend/.env.example backend/.env
```

Run in two terminals, both from the repository root:

```bash
npm run dev:api
```

```bash
npm run dev
```

- Web: <http://localhost:3000>
- Python health: <http://localhost:8000/health>
- OpenAPI/Swagger: <http://localhost:8000/docs>

The app boots with blank Supabase credentials. Click **Check API connection** to test
the browser-to-FastAPI connection. The map canvas starts without tiles; supply a
MapLibre-compatible style URL when you choose a basemap provider.

## Checks

```bash
npm run lint
npm run typecheck
npm run build
npm run lint:api
npm run test:api
```

After changing API schemas, run `npm run api:types` and commit both the OpenAPI JSON
and generated TypeScript definitions. GitHub Actions runs these checks and checks
the generated contract for drift.

## Boundaries

- Supabase owns Postgres, PostGIS, Auth, and private object storage. User-facing
  database and storage requests use the user's session and row-level security.
- FastAPI verifies bearer tokens through Supabase Auth. Liveness is public; job
  routes require a verified user and currently return **501 Not Implemented**.
- Future jobs: API validates and persists a job → returns `202 { job_id, status }`
  → separate Python worker runs optimisation → browser polls `GET /v1/jobs/{id}`.
- `public.jobs` is reserved for that future pipeline. It permits users to read
  only their own rows; only trusted server code can write. No jobs are queued yet.
- The pathway entry point, `backend/app/pathway_optimizer.py`, evaluates transport
  after upstream ML/regression produces zoning; see [the module guide](docs/PATHWAYS.md). GeoPandas,
  Shapely, NetworkX, OSMnx, scikit-learn, and OR-Tools are installed and locked.
- Redis/QStash are not needed for this scaffold. When implementing execution,
  use a durable Postgres queue with atomic claiming, retry and restart handling;
  then add a separate worker deployment. Don't use process memory as a queue.
- v0 is a development workflow, not a runtime dependency. Keep generated UI in
  `frontend`; keep computation in Python.

Live Supabase connectivity, SQL policies, and cloud deployment require your account
setup. Local health checks do not certify that those services are connected.

## Prayas pathway module

Run the synthetic demo from `backend/`:

```bash
python -m app.pathways examples/pathways/city.json
```

The module takes fixed zones with population/land use and service metadata, existing
roads, candidate pathways, and an OD matrix. Candidate selection is explicit.
It evaluates A*/Dijkstra routing, BPR congestion, cost/environment tradeoffs, and
population-weighted access to essential services.

See [the pathway guide](docs/PATHWAYS.md) for the zoning-to-worker contract,
configuration, constraints, tests, and the future ACO/GA network-design boundary.

## City zoning generator

`backend/city_plan_computing` trains the upstream zoning model from the committed
urban grid dataset. It reads `:GridCell` and `:CONNECTED_TO` records from Neo4j's
`urban` database, then produces fixed land-use zones for the pathway module.
It has its own ML dependencies in `requirements.txt`; it remains separate from
the API runtime. See `urban_city_dataset/data/processed/graph/import.sh` to import
the data. Set `NEO4J_PASSWORD` and, optionally, `URBAN_CITY_ID` before running
`python gen_main.py` from the city_plan_computing directory.

## Data credits

The committed urban city-grid and city-level datasets are derived from the
following public sources. They support planning prototypes and must be checked
against local authoritative data before operational use. The current city-level
run covers Tokyo, Singapore, Copenhagen, Amsterdam, Barcelona, Zurich,
Stockholm, London, Paris, and New York City.

- [GHSL](https://human-settlement.emergency.copernicus.eu/) (European Commission
  Joint Research Centre): 2025 urban-centre boundaries and GHS-POP R2023A 2025
  population estimates. Cite Rivero et al., *GHS-UCDB R2024A - GHS Urban
  Centre Database 2025*, DOI
  [10.2905/1a338be6-7eaf-480c-9664-3a8ade88cbcd](https://doi.org/10.2905/1a338be6-7eaf-480c-9664-3a8ade88cbcd).
- [Overture Maps](https://docs.overturemaps.org/getting-data/duckdb/): building
  footprints and land-use features, using the configured `2026-08-19.0` release,
  for land-use classification and building-density calculations. See Overture's
  [attribution guidance](https://docs.overturemaps.org/attribution/).
- [OpenStreetMap](https://www.openstreetmap.org/) contributors, queried through
  [Overpass](https://wiki.openstreetmap.org/wiki/Overpass_API): supplementary
  hospitals, schools, parks, transit, and other POIs. OSM data is available under
  the [ODbL 1.0](https://opendatacommons.org/licenses/odbl/); retain the credit
  “© OpenStreetMap contributors.”
- [Eurostat City Statistics / Urban Audit](https://ec.europa.eu/eurostat/cache/metadata/en/urb_esms.htm):
  separate European administrative-city context data. These observations are
  not merged into GHSL-boundary features.
- [Copernicus DEM GLO-30](https://registry.opendata.aws/copernicus-dem/):
  ESA/Copernicus Programme elevation values sampled for each grid cell. Follow
  the [Copernicus DEM licence](https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM).

Overture features may carry different contributing-provider licences; do not
describe all Overture features as having one common licence. GHSL indicator
definitions retain upstream acknowledgements for Copernicus, Sentinel/Landsat,
USGS, UN-Habitat, and other contributors where applicable.

Suggested acknowledgement: “This work uses data from the European Commission
Joint Research Centre GHSL, Overture Maps Foundation, OpenStreetMap contributors,
Eurostat, and the ESA/Copernicus Programme.”

The dataset-specific source URLs, retrieval metadata, field derivations, and
geographic scope are documented in
[the city dataset guide](urban_city_dataset/README.md) and
[the India grid data notes](urban_city_dataset/data/processed/city_grids/INDIA_DATA.md).

## 2D-to-3D planning assets

The optional `backend/app/three_d` worker turns a trusted design-reference image
into an OBJ or GLB asset through TripoSR. It stays separate from the normal API
runtime, because its model and GPU dependencies are substantial. See
[the 2D-to-3D guide](docs/THREE_D.md) for setup, the worker command, the
planning-data boundary, and the path to the future job pipeline.
