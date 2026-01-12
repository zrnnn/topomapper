# Topomapper (dev)

Interactive topographic map generator built with SvelteKit and MapLibre GL JS.

## Requirements

- Node.js 18+ (tested with 24)

## Development

```sh
npm install
npm run dev -- --host 127.0.0.1 --port 5173
```

## Build (static)

```sh
npm run build
```

The static output is written to `build/` (GitHub Pages friendly). The app uses a base path of `/topomapper` in production builds.

## Preview production build

```sh
npm run preview -- --host 127.0.0.1 --port 4173
```

## GitHub Pages

- Base path is `/topomapper` when `NODE_ENV=production`; adjust `paths.base` in `svelte.config.js` if the repo name changes.
- Deploy via the workflow `.github/workflows/pages.yml` (builds and publishes `build/` to GitHub Pages).
- A `.nojekyll` file in `static/` prevents GitHub Pages from ignoring underscore-prefixed files.

## Manual GitHub Pages publish (fallback)

1. Run `npm run build`
2. Publish the `build/` folder

If the repo name changes, update `paths.base` in `svelte.config.js`.

## Notes

- Main UI lives in `src/routes/+page.svelte`.
- Core app logic is in `src/lib/topomapper.js`.
- Global styles are in `src/app.css`.
- Static assets (logo/icon) are in `static/assets`.
- Contour styling includes a "Bold Every Nth" slider (0-20, default 10). Set to 0 to disable emphasis; the selected interval doubles the stroke width of the matching contour lines.
