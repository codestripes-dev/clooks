# Pin Bun version to avoid CI flakiness from breaking changes in new releases.
# Update this version intentionally when upgrading Bun.
FROM oven/bun:1.2

# git is needed by unit tests (git.test.ts expects a git repo).
# Install early so this layer is cached across source changes.
RUN apt-get update -qq && apt-get install -y -qq git > /dev/null && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files and install dev deps (for bun:test)
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Copy source and config needed for build.
# The generated types file (src/generated/clooks-types.d.ts.txt) is committed,
# so we skip scripts/generate-types.ts (which needs npx, unavailable in bun image).
COPY src/ src/
COPY schemas/ schemas/
COPY tsconfig.json ./
RUN ./node_modules/.bin/tsc --noEmit && mkdir -p dist && bun build --compile --outfile dist/clooks src/cli.ts

# Copy test fixtures and E2E tests
COPY test/ test/

# git.test.ts needs a repo with at least one commit (for branch detection)
RUN git init && git config user.email "test@test" && git config user.name "test" && git commit --allow-empty -m "init"

# Run unit tests as root (fast feedback, no permission concerns)
RUN bun test src/

# Create non-root user for E2E tests so filesystem permission tests work
# (root ignores chmod restrictions, which defeats read-only directory tests)
RUN useradd -m -s /bin/bash testuser && chown -R testuser:testuser /app

USER testuser

# Signal to E2E tests that they're running inside the Docker container
ENV CLOOKS_E2E_DOCKER=true

# Run E2E tests against the compiled binary
RUN bun test test/e2e/
