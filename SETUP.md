# Setup

One-time environment setup for a new machine. For running the project day
to day, see the root [README.md](README.md) and each service's own README.

## .NET 10 SDK

```powershell
winget install --id Microsoft.DotNet.SDK.10 -e
```

Trust the local HTTPS dev certificate (needed for `https://` URLs during
`dotnet run`):

```powershell
dotnet dev-certs https --trust
```

This pops a Windows confirmation dialog - click Yes.

Optional but useful for `annotation-store`'s EF Core migrations:

```powershell
dotnet tool install --global dotnet-ef
```

## Node.js

Install from [nodejs.org](https://nodejs.org/) (or via `winget install
OpenJS.NodeJS.LTS`). `image-viewer` uses Vite/React - `npm install` inside
`image-viewer/` pulls in everything else (Vite, TypeScript, oxlint, vitest).

## PostgreSQL

```powershell
winget install --id PostgreSQL.PostgreSQL.17 -e
```

Installs the server as a Windows service (`postgresql-x64-17`, starts
automatically) plus `psql` and pgAdmin 4. The installer sets the `postgres`
superuser's password interactively - if you let it default, it's
`postgres`.

Then set up `annotation-store`'s connection string - see
`annotation-store/README.md`'s "Pointing it at your database" section
(copy `.env.example` to `.env`, fill in the password you set above). The
`annotationtest` database itself doesn't need to be created manually - it's
created automatically the first time `annotation-store` runs.

**pgAdmin connection:** host `localhost`, port `5432`, user `postgres`,
whatever password you set. The `annotationtest` database won't appear
until after `annotation-store`'s first run.

## Git LFS

The whole-slide image files under `tiler/data/` (`.mrxs`/`.dat`/`.ini`) are
too large for plain git and are LFS-tracked.

```powershell
winget install --id GitHub.GitLFS -e
git lfs install
```

Install **before** cloning. If you've already cloned without it, run `git
lfs pull` afterwards to fetch the real files instead of the small pointer
stubs you'll otherwise have.

## VS Code extensions

| Extension | Why |
|---|---|
| `ms-dotnettools.csdevkit` (+ `ms-dotnettools.csharp`) | C# language support, debugging, test explorer for `tiler`/`annotation-store` |
| `vitest.explorer` | Run/debug `image-viewer`'s vitest suite inline |
| `oxc.oxc-vscode` | `image-viewer` lints with oxlint, not eslint - this is its editor integration |
| `ms-ossdata.vscode-pgsql` | Microsoft's official Postgres extension - browse/query `annotationtest` in-editor |
| `mikestead.dotenv` | Syntax highlighting for `.env`/`.env.example` |
| `editorconfig.editorconfig` | Respects the repo's `.editorconfig`, if one is added |
| `eamodio.gitlens` | Inline blame/history |

Install one at a time with `code --install-extension <id>`, or all at once:

```powershell
code --install-extension ms-dotnettools.csdevkit
code --install-extension ms-dotnettools.csharp
code --install-extension vitest.explorer
code --install-extension oxc.oxc-vscode
code --install-extension ms-ossdata.vscode-pgsql
code --install-extension mikestead.dotenv
code --install-extension editorconfig.editorconfig
code --install-extension eamodio.gitlens
```
