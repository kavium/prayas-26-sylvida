"""Allow ``python -m app.integrations.triposr`` as a short CLI alias."""

from app.integrations.triposr.cli import main

if __name__ == "__main__":
    raise SystemExit(main())
