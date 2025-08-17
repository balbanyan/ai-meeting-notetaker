.PHONY: help dev build clean test

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

dev: ## Start development environment
	docker compose -f infra/docker-compose.yml up -d
	@echo "Infrastructure started. Run services individually:"
	@echo "  Backend:    cd services/backend && pip install -e . && uvicorn app.main:app --reload"
	@echo "  Frontend:   cd services/frontend && npm install && npm run dev"
	@echo "  Bot Runner: cd services/bot-runner && npm install && npm run dev"

build: ## Build all Docker images
	docker compose -f infra/docker-compose.yml build

clean: ## Clean up containers and volumes
	docker compose -f infra/docker-compose.yml down -v

test: ## Run tests
	cd services/backend && python -m pytest
	cd services/frontend && npm test

logs: ## Show logs
	docker compose -f infra/docker-compose.yml logs -f
