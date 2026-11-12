# Bundled plugins

Packaged plugins live here as `<id>.lockedin/` directories:

```
plugins/
  example.scene-window.lockedin/
    manifest.json
    plugin.js
```

Build one from a source plugin:

```sh
bun run plugin:build src/ui/plugins/examples/scene-window
```

The app scans this folder (and a `plugins/` folder beside the executable) at
startup. Use Settings → Plugins → Plugin manager to enable or disable each one.
