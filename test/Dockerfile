# Pin Bun version to avoid CI flakiness from breaking changes in new releases.
# Update this version intentionally when upgrading Bun.
FROM oven/bun:1.3

# git is needed by unit tests (git.test.ts expects a git repo).
# Install early so this layer is cached across source changes.
RUN apt-get update -qq && apt-get install -y -qq git > /dev/null && rm -rf /var/lib/apt/lists/*

# Create non-root user and /app owned by them from the start.
# E2E tests need a non-root user because root ignores chmod restrictions.
RUN useradd -m -s /bin/bash testuser && mkdir -p /app && chown testuser:testuser /app

WORKDIR /app

# Copy package files and install deps as testuser (so node_modules is owned by them)
COPY --chown=testuser:testuser package.json bun.lock ./
USER testuser
RUN bun install --frozen-lockfile

# Copy entrypoint script
USER root
COPY --chown=testuser:testuser test/docker-entrypoint.sh ./test/docker-entrypoint.sh
RUN chmod +x test/docker-entrypoint.sh

# git.test.ts needs a repo with at least one commit (for branch detection)
USER testuser
RUN git init && git config user.email "test@test" && git config user.name "test" && git commit --allow-empty -m "init"

# Signal to E2E tests that they're running inside the Docker container
ENV CLOOKS_E2E_DOCKER=true
ENV CLAUDECODE=1

# Source and tests are bind-mounted at runtime for fast iteration.
# Only node_modules and git repo are baked into the image.
ENTRYPOINT ["test/docker-entrypoint.sh"]
