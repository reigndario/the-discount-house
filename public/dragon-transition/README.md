# TDH Dragon Welcome Integration

This package is a vanilla JS/CSS/canvas welcome sequence. It has no runtime framework dependency. The current hosted mockup uses the same files that downstream sites should embed.

## Files

Use the generated `dist/dragon-transition` folder:

- `index.html` is the full demo page.
- `styles.css` contains the scene, modal, and demo UI styles.
- `script.js` contains the scene runtime and public API.
- `assets/` contains all image and audio assets.

Run `npm run build` to refresh `dist/dragon-transition` from the source files.

## Minimal Host Markup

The script expects these elements to exist before `script.js` loads:

```html
<canvas id="ambient-bg" data-tdh-ambient-canvas aria-hidden="true"></canvas>

<div id="vibe-switch" class="vibe-switch" data-tdh-vibe-switch role="button" tabindex="0">
  <span class="vibe-switch__frame" data-tdh-vibe-frame>
    <canvas id="tdh-bg" data-tdh-scene-canvas aria-hidden="true"></canvas>
  </span>
</div>

<button data-tdh-private-action type="button">PRIVATE ACTION</button>
```

The complete welcome flow starts automatically by default: fullscreen mixed scene, wallet prompt, lore prompt, then dragon choice.

## Runtime Config

Set config before loading `script.js`:

```html
<script>
  window.TDH_BUILD_ID = "my-release-id";
  window.TDH_CACHE_FLAG = `${window.TDH_BUILD_ID}-${Date.now().toString(36)}`;
  window.TDH_WELCOME_CONFIG = {
    assetBaseUrl: "/dragon-transition/assets/",
    autoStart: true,
    initialFullscreen: true,
    initialLore: true,
    cacheBust: true,
    eventPrefix: "tdh"
  };
</script>
```

## Public API

After `script.js` loads:

```js
const dragon = window.TDHWelcome;

dragon.openWelcome();
dragon.openFullscreen({ instant: true });
dragon.closeFullscreen();
dragon.choose("blue");
dragon.setMode("mixed");
dragon.privateAction();
dragon.blast();
dragon.destroy();
```

`window.TDHTransition` remains available for lower-level animation debugging and timing adjustments.

## Events

Listen on `window`:

```js
const off = TDHWelcome.on("choice", (event) => {
  console.log(event.detail.chosenSide);
});
```

Available events include:

- `tdh:ready`
- `tdh:welcome-start`
- `tdh:lore-prompt-open`
- `tdh:lore-prompt-close`
- `tdh:lore-choice-open`
- `tdh:lore-details-open`
- `tdh:lore-details-close`
- `tdh:choice`
- `tdh:transition-start`
- `tdh:transition-end`
- `tdh:mode-change`
- `tdh:fullscreen-open`
- `tdh:fullscreen-close`
- `tdh:private-burst-start`
- `tdh:destroy`

## CSS Scope

The scene and modal styles are intentionally reusable, while the lorem ipsum dashboard is demo-only. Downstream sites should either reuse the full page as a welcome route or copy only the required scene markup plus the modal-related styles. The stable integration hooks are the `data-tdh-*` attributes and `TDHWelcome` API.
