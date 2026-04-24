# Ballistics

A PWA hit-chance calculator for a homebrew TTRPG that uses a multiplicative
percentile resolution mechanic (usable with other TTRPGs too). It turns the
physics-grounded design in `chat.md` into a single screen: pick skill, weapon,
range, shot type, movement, and situational multipliers, and the app shows the
Final Chance and lets you roll d100 against it. An optional panel samples where
the bullet actually lands relative to your point of aim.

## Run locally

```sh
python3 -m http.server 8000
# then open http://localhost:8000/
```

Plain static files — no build step. The service worker caches the app shell so
it works offline after the first load. On iOS/Android you can "Add to Home
Screen" to install it as a standalone app.

## Files

- `index.html` — single-page UI
- `styles.css` — mobile-first layout
- `calc.js` — MOA / range-factor / angular-velocity math
- `dice.js` — d100 + deviation samplers (3d6 or normal)
- `presets.js` — baked-in weapons + custom-weapon list
- `storage.js` — localStorage wrappers (with in-memory fallback)
- `app.js` — DOM wiring, state, rendering
- `sw.js` / `manifest.webmanifest` / `icons/` — PWA shell

## Design source

All formulas and multiplier ranges come from `chat.md`. See that file for the
rationale behind every number in the app.
# ballistics-ttrpg
