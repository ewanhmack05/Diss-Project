# Diss Project

Dissertation project on real-time collaboration around whole-slide image
annotation. Scoped down for a single-slide as proof of concept.

```
image-viewer/    React + TypeScript + OpenLayers frontend. See image-viewer/README.md
tiler/           .NET tile server for .mrxs whole-slide images. See tiler/README.md
annotation-store/  Not built yet - persistence backend for annotations.
```

## Running everything

```bash
npm --prefix image-viewer install
npm --prefix image-viewer run dev          # http://localhost:5173

dotnet run --project tiler --urls http://localhost:5095
```

Each service has its own README with more detail
