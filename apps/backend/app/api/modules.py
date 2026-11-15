"""Modules endpoint — exposes which modules are loaded.

The frontend calls this at boot to know which UI route chunks to render.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends

from app.api.deps import get_current_user
from app.core.modules import registry
from app.models import User
from app.schemas import ModuleInfo

router = APIRouter(prefix="/modules", tags=["modules"])


@router.get("", response_model=list[ModuleInfo])
async def list_modules(
    _: User = Depends(get_current_user),
) -> list[ModuleInfo]:
    """List all loaded modules with their per-tenant enabled state."""
    loaded = registry.all_metadata()
    return [
        ModuleInfo(
            name=mod["name"],
            version=mod["version"],
            description=mod.get("description", ""),
        )
        for mod in loaded
    ]
