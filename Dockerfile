# SiteStock, as one container.
#
# The browser asks for /api/... as a relative path on every screen, so the API and the
# Angular build have to answer on the same origin. Shipping them as one image is the
# cheapest way to guarantee that: no CORS in production, no build-time API base URL to get
# wrong, and the service worker stays on the origin it was registered against.
#
# Three stages so the runtime image carries neither the .NET SDK nor node_modules.

# ── 1. the web build ─────────────────────────────────────────────────────────
FROM node:22-alpine AS web
WORKDIR /src/web

# Dependencies first: this layer is rebuilt only when the lockfile actually changes,
# which is the difference between a 30-second deploy and a four-minute one.
COPY web/package.json web/package-lock.json ./
RUN npm ci

COPY web/ ./
RUN npm run build -- --configuration production

# ── 2. the api build ─────────────────────────────────────────────────────────
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS api
WORKDIR /src

# Just the project file: restore only needs that, and a glob that matches nothing — there
# is no Directory.Build.props here — fails the COPY outright rather than being skipped.
COPY api/src/SiteStock.Api/SiteStock.Api.csproj ./api/src/SiteStock.Api/
RUN dotnet restore api/src/SiteStock.Api/SiteStock.Api.csproj

COPY api/ ./api/
RUN dotnet publish api/src/SiteStock.Api/SiteStock.Api.csproj \
      -c Release -o /app/publish /p:UseAppHost=false

# The Angular output becomes the API's wwwroot. UseStaticFiles and the SPA fallback in
# Program.cs only switch on when this directory exists.
COPY --from=web /src/web/dist/web/browser /app/publish/wwwroot

# ── 3. what actually runs ────────────────────────────────────────────────────
FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app

# Uploaded challans and certificates. On Render this path is a mounted disk; without one
# the container filesystem is wiped on every deploy and the photos go with it.
RUN mkdir -p /data/documents

# Not root. A web process that is compromised should not also own the filesystem.
RUN useradd --uid 10001 --create-home --shell /usr/sbin/nologin sitestock \
 && chown -R sitestock:sitestock /data
USER sitestock

COPY --from=api --chown=sitestock:sitestock /app/publish ./

ENV ASPNETCORE_ENVIRONMENT=Production \
    DOTNET_RUNNING_IN_CONTAINER=true

# No EXPOSE with a fixed port: Render supplies PORT at run time and Program.cs binds to it.
ENTRYPOINT ["dotnet", "SiteStock.Api.dll"]
