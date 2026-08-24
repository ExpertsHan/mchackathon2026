SHELL := /bin/sh

BACKEND_VENV := backend/.venv
BACKEND_PY := $(BACKEND_VENV)/bin/python
BACKEND_PIP := $(BACKEND_VENV)/bin/pip

.PHONY: install dev stop init seed ingest reset smoke test backend-test frontend-check lint typecheck build dev-backend dev-frontend assets clean-docker

install:
	python3 -m venv $(BACKEND_VENV)
	$(BACKEND_PIP) install --upgrade pip
	$(BACKEND_PIP) install -e './backend[dev]'
	cd frontend && npm install

dev:
	docker compose up --build

stop:
	docker compose down

init:
	docker compose up -d postgres
	docker compose run --rm backend python -m app.scripts.init_db

seed:
	docker compose run --rm backend python -m app.scripts.seed

ingest:
	docker compose run --rm backend python -m app.scripts.ingest_knowledge

reset:
	curl --fail --silent --show-error --request POST http://localhost:8000/api/demo/reset
	@echo

smoke:
	python3 scripts/smoke_demo.py

assets:
	python3 scripts/verify_demo_assets.py

backend-test:
	cd backend && .venv/bin/pytest

frontend-check:
	cd frontend && npm run lint && npm run typecheck && npm run build

test: assets backend-test frontend-check

lint:
	cd backend && .venv/bin/ruff check app tests
	cd frontend && npm run lint

typecheck:
	cd frontend && npm run typecheck

build:
	cd frontend && npm run build
	docker compose config --quiet

dev-backend:
	cd backend && .venv/bin/uvicorn app.main:app --reload --port 8000

dev-frontend:
	cd frontend && npm run dev

# Explicitly destructive: removes only this Compose project's containers and named volumes.
clean-docker:
	docker compose down --volumes
