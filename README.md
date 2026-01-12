# Topomapper (dev)

Interactive topographic map generator built with SvelteKit and MapLibre GL JS.

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

## Notes

- Main UI lives in `src/routes/+page.svelte`.
- Core app logic is in `src/lib/topomapper.js`.
- Global styles are in `src/app.css`.
- Static assets (logo/icon) are in `static/assets`.
