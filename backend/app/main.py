from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from . import config
from .database import Base, engine
from .routers import analytics, translate


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    yield


app = FastAPI(
    title="OfficeSpeak AI",
    description="Rewrite messages for Slack, email, meetings and reviews while preserving your intent.",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(translate.router)
app.include_router(analytics.router)


@app.get("/health")
def health():
    return {"status": "ok", "provider": config.LLM_PROVIDER, "model": config.ACTIVE_MODEL}


# Single-service deployment: if the built frontend has been copied to
# app/static (the root Dockerfile does this), serve it from the same origin.
# Mounted last, so /api/* and /health always win.
_static = Path(__file__).parent / "static"
if _static.exists():
    app.mount("/", StaticFiles(directory=_static, html=True), name="static")
