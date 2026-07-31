# chanko_bd_project

A browser game in plain HTML, CSS, and JavaScript. No build step.

**Live:** https://martinrtodorov-lgtm.github.io/chanko_bd_project/

## Running locally

A local server is required — opening `index.html` directly via `file://` breaks
ES modules and image loading.

```
npx http-server . -p 8080 -c-1
```

Then open http://localhost:8080

Alternatively, use the VS Code **Live Server** extension and click "Go Live".

## Layout

```
index.html          entry point
css/styles.css      all styling
js/main.js          entry module
assets/maps/        map art
assets/ui/          interface art (start screen, buttons, frames)
assets/portraits/   character portraits
```

## Asset naming

All lowercase, hyphen-separated, lowercase extensions. GitHub Pages serves from a
case-sensitive filesystem while Windows does not, so `Map-Main.PNG` will work
locally and 404 in production.

- maps: `map-<name>.png`
- ui: `screen-<name>.png`, `ui-<name>.png`
- portraits: `portrait-<character>.png`
