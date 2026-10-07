# The tiler on Linux, with slide 003 built in - the one slide that's
# deployed (see docs/azure.md). From the repo root:
#   docker build -t diss-tiler tiler
#   docker run --rm -p 5095:8080 diss-tiler

FROM mcr.microsoft.com/dotnet/sdk:10.0-noble AS build
WORKDIR /src
COPY Tiler.csproj .
RUN dotnet restore -r linux-x64
COPY Program.cs appsettings.json ./
COPY Slides/ Slides/
RUN dotnet publish -c Release -r linux-x64 --self-contained false --no-restore -o /app

FROM mcr.microsoft.com/dotnet/aspnet:10.0-noble
# OpenSlide from the distro, rather than the Windows DLLs the NuGet
# package ships - Slides/OpenSlideNative.cs points OpenSlideSharp at it.
# Ubuntu 24.04 has OpenSlide 3.4, the version OpenSlideSharp was written for.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libopenslide0 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
# The slide before the app, so a code change doesn't copy ~3 GB again.
COPY data/003.mrxs data/
COPY data/003/ data/003/
COPY --from=build /app .
# The .NET image listens on 8080 already.
EXPOSE 8080
ENTRYPOINT ["dotnet", "Tiler.dll"]
