"""Module registry — the spine of the modular base.

A "module" in rubbish is a self-contained package under
``app.modules.<name>`` that contributes routers, models, alembic
migrations, admin hooks, and UI chunks to the running application.

This file defines:

1. ``ModuleManifest`` — the dataclass each module fills out at import time.
2. ``ModuleRegistry`` — the singleton that holds all loaded manifests.
3. ``registry`` — the global registry instance.
4. ``load_all()`` — called at app startup, imports each name from
   ``app.modules.ENABLED_MODULES`` and registers its manifest.

The list of enabled modules lives in ``app/modules/__init__.py`` as a
plain Python list. Adding a module = add its name to that list. No
entry-point scanning, no plugin marketplace — see ARCHITECTURE.md
"Chose not to do".
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING

from app.core.logging import get_logger

if TYPE_CHECKING:
    from fastapi import APIRouter

logger = get_logger("rubbish.modules")


@dataclass(frozen=True)
class ModuleManifest:
    """Static metadata about an enabled module.

    Loaded once at app startup; immutable for the process lifetime.
    """

    name: str
    version: str
    description: str = ""
    dependencies: frozenset[str] = field(default_factory=frozenset)
    router: APIRouter | None = None
    admin_pages: tuple[str, ...] = ()


class ModuleRegistry:
    """Singleton holding all loaded module manifests.

    Accessed via the global ``registry`` instance. The app startup
    (``load_all``) populates it; everything else reads from it.
    """

    def __init__(self) -> None:
        self._modules: dict[str, ModuleManifest] = {}

    def register(self, manifest: ModuleManifest) -> None:
        if manifest.name in self._modules:
            raise RuntimeError(f"module {manifest.name!r} already registered")
        # Verify dependencies are satisfied at registration time.
        missing = manifest.dependencies - self._modules.keys()
        if missing:
            raise RuntimeError(
                f"module {manifest.name!r} requires unregistered dependencies: {sorted(missing)}"
            )
        self._modules[manifest.name] = manifest
        logger.info("module_registered", name=manifest.name, version=manifest.version)

    def all_routers(self) -> list[tuple[str, APIRouter]]:
        return [(name, m.router) for name, m in self._modules.items() if m.router is not None]

    def all_metadata(self) -> list[dict[str, str]]:
        return [
            {"name": m.name, "version": m.version, "description": m.description}
            for m in self._modules.values()
        ]

    def __len__(self) -> int:
        return len(self._modules)


registry = ModuleRegistry()


def load_all() -> None:
    """Import every enabled module from ``app.modules.ENABLED_MODULES``.

    Each module's ``__init__.py`` constructs a ``ModuleManifest`` and calls
    ``registry.register(...)`` at import time. We just import the package;
    the registration happens as a side effect.
    """
    from app.modules import ENABLED_MODULES

    logger.info("loading_modules", count=len(ENABLED_MODULES), names=list(ENABLED_MODULES))
    for name in ENABLED_MODULES:
        __import__(f"app.modules.{name}", fromlist=["__name__"])
