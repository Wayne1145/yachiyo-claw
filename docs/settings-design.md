# Settings layout

Settings use the same Flow Glass materials and circular corner scale as the Android
shell. This refactor keeps provider, feature and storage behavior with their existing
owners while sharing navigation and page layout.

## Navigation

`SettingsNavigation` combines the core catalog, enabled feature contributions and
approved plugin contributions. Its four groups are appearance/interaction,
models/connections, Agent/extensions and app/data. Search matches translated labels,
descriptions and selected keywords. Search text survives opening a page and returning.
Disabled features and unapproved plugin contributions remain hidden.

Android and browser settings use the main router. Existing settings links are
forwarded from the old modal entry point; the separate modal route table is gone.
Wide browser pages have a compact sidebar, while mobile uses a single column.
The Android return stack stores locations, not live historical Outlets: only the
current settings page is mounted, avoiding duplicate forms and background effects.

## Page structure

- `SettingsPage` owns the heading and content width. Android's navigation bar names
  the current page, so the repeated page heading is visually hidden there.
- `SettingsSection` groups related fields in a shared R-corner surface. Fields,
  buttons, switches and section spacing use shared styles in `settings.css`.
- Appearance starts with system/light/dark choices and a font preview, then the
  theme library. Theme importing is a disclosure below the everyday controls.
- Speech recognition and synthesis, character details/prompt/models, and data
  backup/restoration have distinct sections. Explicit save actions give feedback;
  speech credentials cannot be edited or saved before their asynchronous load ends.
- Feature dependency warnings, MCP deletion and memory clearing use the same rounded
  confirmation surface. Dismissing or leaving a page cancels the pending operation.
- Font-size dragging updates a local preview; releasing the slider commits the
  global setting so the page does not relayout under the pointer while dragging.

Large scrolling surfaces use lightweight translucent fills. Blur remains in shell
chrome instead of being repeated on every row. Section layout uses CSS Grid so
spacing works on WebView 83, which predates flex-gap support. Input and button
dimensions include padding and borders to avoid narrow-screen overflow.
The settings scroll edge uses a painted gradient instead of a masked backdrop,
avoiding a black compositing band observed on the Android 11 WebView. Navigation
titles are replaced directly rather than waiting for `Animation.finished`, which
is absent on that WebView and left invisible historical titles mounted.

## Validation

Regression tests cover feature/plugin visibility, navigation/search retention,
single-page mounting, return history with search parameters, and asynchronous speech
credential loading/retry/save. Device checks cover actual routing, page radii,
horizontal overflow, controls above the bottom navigation, and keyboard resizing.
Detailed local test reports and screenshots are kept under the ignored `.cache/`
directory; they contain development-only state and are not release assets.
