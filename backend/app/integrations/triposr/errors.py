"""Exceptions raised by the Prayas TripoSR integration."""


class TripoSRIntegrationError(RuntimeError):
    """Base exception for configuration, input, and generation failures."""


class TripoSRConfigurationError(TripoSRIntegrationError):
    """Raised when the separate TripoSR worker is not configured correctly."""


class InvalidGeoJSONError(TripoSRIntegrationError):
    """Raised when an input cannot be consumed as a GeoJSON FeatureCollection."""


class AssetGenerationError(TripoSRIntegrationError):
    """Raised when a provider cannot produce a requested 3D asset."""


class MassingGenerationError(TripoSRIntegrationError):
    """Raised when no valid polygon massing can be generated."""
