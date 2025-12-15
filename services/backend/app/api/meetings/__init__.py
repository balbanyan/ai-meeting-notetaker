from fastapi import APIRouter
from .join import router as join_router
from .status import router as status_router
from .external import router as external_router
from .frontend import router as frontend_router

router = APIRouter()
router.include_router(join_router)
router.include_router(status_router)
router.include_router(external_router)
router.include_router(frontend_router)

