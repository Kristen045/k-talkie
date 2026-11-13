"""Start here. Run with:  uvicorn main:app --reload"""
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app.db import init_db
from app.routes import router

BASE = Path(__file__).resolve().parent

app = FastAPI(title="K-Talkie")
init_db()                                   # create the database tables if they don't exist
app.mount("/static", StaticFiles(directory=BASE / "static"), name="static")
app.include_router(router)
