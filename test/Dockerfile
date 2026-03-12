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

# Copy package files and install dev deps (for bun:test)
COPY --chown=testuser:testuser package.json bun.lock ./
RUN bun install --frozen-lockfile

# Copy source and config needed for build.
# The generated types file (src/generated/clooks-types.d.ts.txt) is committed,
# so we skip scripts/generate-types.ts (which needs npx, unavailable in bun image).
COPY --chown=testuser:testuser src/ src/
COPY --chown=testuser:testuser schemas/ schemas/
COPY --chown=testuser:testuser tsconfig.json ./

# Build as testuser so dist/clooks is owned by them (sandbox needs chmod on it).
USER testuser
RUN ./node_modules/.bin/tsc --noEmit && mkdir -p dist && bun build --compile --outfile dist/clooks src/cli.ts

# Copy test fixtures and E2E tests (back to root for COPY, then switch back)
USER root
COPY --chown=testuser:testuser test/ test/

# git.test.ts needs a repo with at least one commit (for branch detection)
USER testuser
RUN git init && git config user.email "test@test" && git config user.name "test" && git commit --allow-empty -m "init"

# Signal to E2E tests that they're running inside the Docker container
ENV CLOOKS_E2E_DOCKER=true

# Tests run via `docker run`, not during build. See test:e2e in package.json.
ENV CLAUDECODE=1
CMD ["bun", "test", "test/e2e/"]
