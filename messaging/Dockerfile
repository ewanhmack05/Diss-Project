# messaging on Linux. From the repo root:
#   docker build -t diss-messaging messaging
# Needs a Postgres, Keycloak and annotation-store - see the root
# docker-compose.yml for the settings it takes.

FROM mcr.microsoft.com/dotnet/sdk:10.0-noble AS build
WORKDIR /src
COPY Messaging.csproj .
RUN dotnet restore
COPY . .
RUN dotnet publish Messaging.csproj -c Release --no-restore -o /app

FROM mcr.microsoft.com/dotnet/aspnet:10.0-noble
# The Postgres driver looks for Kerberos on start up and logs an error
# every time if it isn't there, even though nothing here uses it.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgssapi-krb5-2 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app .
# Creates the tables, or brings them up to date, when it starts.
ENV Database__MigrateOnStartup=true
# The .NET image listens on 8080 already.
EXPOSE 8080
ENTRYPOINT ["dotnet", "Messaging.dll"]
