"""Environment-backed settings for the separate TripoSR process."""

from __future__ import annotations

import os
import shutil
import sys
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

from app.integrations.triposr.errors import TripoSRConfigurationError


def _environment_bool(value: str, *, name: str) -> bool:
    normalized = value.strip().lower()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False
    raise TripoSRConfigurationError(f"{name} must be true or false")


@dataclass(frozen=True, slots=True)
class TripoSRConfig:
    """Configuration used to invoke an official local TripoSR checkout.

    The executable should belong to TripoSR's own virtual environment. This
    keeps PyTorch, CUDA, and model dependencies out of the FastAPI environment.
    """

    repository_path: Path
    python_executable: str = sys.executable
    model_name: str = "stabilityai/TripoSR"
    device: str = "cuda:0"
    chunk_size: int = 8192
    mesh_resolution: int = 256
    foreground_ratio: float = 0.85
    remove_background: bool = True
    timeout_seconds: float = 900.0

    @classmethod
    def from_env(cls, environ: Mapping[str, str] | None = None) -> TripoSRConfig:
        """Build settings from ``TRIPOSR_*`` environment variables."""
        values = os.environ if environ is None else environ
        repository = values.get("TRIPOSR_REPOSITORY_PATH", "").strip()
        if not repository:
            raise TripoSRConfigurationError(
                "TRIPOSR_REPOSITORY_PATH must point to an official TripoSR checkout"
            )
        try:
            config = cls(
                repository_path=Path(repository).expanduser().resolve(),
                python_executable=values.get("TRIPOSR_PYTHON_EXECUTABLE", sys.executable),
                model_name=values.get("TRIPOSR_MODEL", "stabilityai/TripoSR"),
                device=values.get("TRIPOSR_DEVICE", "cuda:0"),
                chunk_size=int(values.get("TRIPOSR_CHUNK_SIZE", "8192")),
                mesh_resolution=int(values.get("TRIPOSR_MC_RESOLUTION", "256")),
                foreground_ratio=float(values.get("TRIPOSR_FOREGROUND_RATIO", "0.85")),
                remove_background=_environment_bool(
                    values.get("TRIPOSR_REMOVE_BACKGROUND", "true"),
                    name="TRIPOSR_REMOVE_BACKGROUND",
                ),
                timeout_seconds=float(values.get("TRIPOSR_TIMEOUT_SECONDS", "900")),
            )
        except ValueError as error:
            raise TripoSRConfigurationError(
                "TripoSR numeric environment settings contain an invalid value"
            ) from error
        config.validate()
        return config

    @property
    def runner_path(self) -> Path:
        """Return the official CLI entry point used by the adapter."""
        return self.repository_path / "run.py"

    def validate(self) -> None:
        """Reject missing runtimes and impractical inference parameters."""
        if not self.runner_path.is_file():
            raise TripoSRConfigurationError(
                f"TripoSR run.py was not found under {self.repository_path}"
            )
        if not self._python_exists():
            raise TripoSRConfigurationError(
                f"TripoSR Python executable was not found: {self.python_executable}"
            )
        if not self.model_name.strip() or not self.device.strip():
            raise TripoSRConfigurationError("TripoSR model and device cannot be empty")
        if self.chunk_size < 0:
            raise TripoSRConfigurationError("TRIPOSR_CHUNK_SIZE cannot be negative")
        if not 16 <= self.mesh_resolution <= 512:
            raise TripoSRConfigurationError("TRIPOSR_MC_RESOLUTION must be between 16 and 512")
        if not 0 < self.foreground_ratio <= 1:
            raise TripoSRConfigurationError(
                "TRIPOSR_FOREGROUND_RATIO must be greater than 0 and at most 1"
            )
        if self.timeout_seconds <= 0:
            raise TripoSRConfigurationError("TRIPOSR_TIMEOUT_SECONDS must be positive")

    def _python_exists(self) -> bool:
        executable = Path(self.python_executable).expanduser()
        if executable.is_absolute() or executable.parent != Path("."):
            return executable.is_file()
        return shutil.which(self.python_executable) is not None
