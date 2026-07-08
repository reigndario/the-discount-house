# Zahak Dragon Welcome Integration

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
<canvas id="ambient-bg" data-zahak-ambient-canvas aria-hidden="true"></canvas>

<div id="vibe-switch" class="vibe-switch" data-zahak-vibe-switch role="button" tabindex="0">
  <span class="vibe-switch__frame" data-zahak-vibe-frame>
    <canvas id="zahak-bg" data-zahak-scene-canvas aria-hidden="true"></canvas>
  </span>
</div>

<button data-zahak-private-action type="button">PRIVATE ACTION</button>
```

The complete welcome flow starts automatically by default: fullscreen mixed scene, wallet prompt, lore prompt, then dragon choice.

## Runtime Config

Set config before loading `script.js`:

```html
<script>
  window.ZAHAK_BUILD_ID = "my-release-id";
  window.ZAHAK_CACHE_FLAG = `${window.ZAHAK_BUILD_ID}-${Date.now().toString(36)}`;
  window.ZAHAK_WELCOME_CONFIG = {
    assetBaseUrl: "/dragon-transition/assets/",
    autoStart: true,
    initialFullscreen: true,
    initialLore: true,
    cacheBust: true,
    eventPrefix: "zahak"
  };
</script>
```

## Public API

After `script.js` loads:

```js
const dragon = window.ZahakWelcome;

dragon.openWelcome();
dragon.openFullscreen({ instant: true });
dragon.closeFullscreen();
dragon.choose("blue");
dragon.setMode("mixed");
dragon.privateAction();
dragon.blast();
dragon.destroy();
```

`window.ZahakTransition` remains available for lower-level animation debugging and timing adjustments.

## Events

Listen on `window`:

```js
const off = ZahakWelcome.on("choice", (event) => {
  console.log(event.detail.chosenSide);
});
```

Available events include:

- `zahak:ready`
- `zahak:welcome-start`
- `zahak:lore-prompt-open`
- `zahak:lore-prompt-close`
- `zahak:lore-choice-open`
- `zahak:lore-details-open`
- `zahak:lore-details-close`
- `zahak:choice`
- `zahak:transition-start`
- `zahak:transition-end`
- `zahak:mode-change`
- `zahak:fullscreen-open`
- `zahak:fullscreen-close`
- `zahak:private-burst-start`
- `zahak:destroy`

## CSS Scope

The scene and modal styles are intentionally reusable, while the lorem ipsum dashboard is demo-only. Downstream sites should either reuse the full page as a welcome route or copy only the required scene markup plus the modal-related styles. The stable integration hooks are the `data-zahak-*` attributes and `ZahakWelcome` API.
