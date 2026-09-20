"""Provider-neutral image-to-3D contract and official TripoSR adapter."""

from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
import time
from collections.abc import Callable, Sequence
from pathlib import Path
from typing import Protocol

from app.integrations.triposr.config import TripoSRConfig
from app.integrations.triposr.errors import AssetGenerationError
from app.integrations.triposr.models import AssetRequest, AssetResult

CommandRunner = Callable[..., subprocess.CompletedProcess[str]]


class ThreeDAssetProvider(Protocol):
    """Replaceable boundary for TripoSR, TRELLIS, or hosted model providers."""

    @property
    def name(self) -> str:
        """Return the stable provider identifier stored in GeoJSON."""

    def generate(self, request: AssetRequest) -> AssetResult:
        """Generate one GLB at ``request.output_path``."""


class TripoSRProvider:
    """Run the official TripoSR CLI in its dedicated Python environment."""

    name = "triposr"

    def __init__(
        self,
        config: TripoSRConfig,
        *,
        runner: CommandRunner = subprocess.run,
    ) -> None:
        self._config = config
        self._runner = runner

    def build_command(self, request: AssetRequest, output_directory: Path) -> list[str]:
        """Build the argument list supported by the official ``run.py`` CLI."""
        command = [
            self._config.python_executable,
            str(self._config.runner_path.resolve()),
            str(request.image_path),
            "--output-dir",
            str(output_directory),
            "--device",
            self._config.device,
            "--pretrained-model-name-or-path",
            self._config.model_name,
            "--chunk-size",
            str(self._config.chunk_size),
            "--mc-resolution",
            str(self._config.mesh_resolution),
            "--foreground-ratio",
            str(self._config.foreground_ratio),
            "--model-save-format",
            "glb",
        ]
        if not self._config.remove_background:
            command.append("--no-remove-bg")
        return command

    def generate(self, request: AssetRequest) -> AssetResult:
        """Generate and normalize the official runner's ``0/mesh.glb`` output."""
        request.validate()
        self._config.validate()
        request.asset_directory.mkdir(parents=True, exist_ok=True)
        started_at = time.monotonic()

        try:
            with tempfile.TemporaryDirectory(
                prefix=f".{request.feature_id}-", dir=request.asset_directory
            ) as temporary:
                temporary_path = Path(temporary)
                command = self.build_command(request, temporary_path)
                self._run(command)
                generated_mesh = temporary_path / "0" / "mesh.glb"
                if not generated_mesh.is_file():
                    raise AssetGenerationError(
                        "TripoSR completed without creating the expected 0/mesh.glb"
                    )
                temporary_target = request.output_path.with_suffix(".glb.partial")
                shutil.copyfile(generated_mesh, temporary_target)
                os.replace(temporary_target, request.output_path)
        except subprocess.TimeoutExpired as error:
            raise AssetGenerationError(
                f"TripoSR exceeded the {self._config.timeout_seconds:g}-second timeout"
            ) from error
        except FileNotFoundError as error:
            raise AssetGenerationError(f"Could not start TripoSR: {error}") from error

        return AssetResult(
            feature_id=request.feature_id,
            mesh_path=request.output_path,
            provider=self.name,
            elapsed_seconds=time.monotonic() - started_at,
        )

    def _run(self, command: Sequence[str]) -> None:
        try:
            self._runner(
                list(command),
                cwd=self._config.repository_path,
                check=True,
                capture_output=True,
                text=True,
                timeout=self._config.timeout_seconds,
            )
        except subprocess.CalledProcessError as error:
            details = (error.stderr or error.stdout or "No worker output").strip()
            if len(details) > 800:
                details = details[-800:]
            raise AssetGenerationError(f"TripoSR worker failed: {details}") from error
