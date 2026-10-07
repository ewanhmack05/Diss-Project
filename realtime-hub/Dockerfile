# The realtime hub on Linux. From the repo root:
#   docker build -t diss-realtime-hub realtime-hub
# Rooms live in memory, so only ever run one copy. Needs annotation-store
# and Keycloak - see the root docker-compose.yml for the settings it takes.

FROM mcr.microsoft.com/dotnet/sdk:10.0-noble AS build
WORKDIR /src
COPY RealtimeHub.csproj .
RUN dotnet restore
COPY . .
RUN dotnet publish RealtimeHub.csproj -c Release --no-restore -o /app

FROM mcr.microsoft.com/dotnet/aspnet:10.0-noble
WORKDIR /app
COPY --from=build /app .
# The .NET image listens on 8080 already.
EXPOSE 8080
ENTRYPOINT ["dotnet", "RealtimeHub.dll"]
