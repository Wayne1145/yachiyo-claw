# Error Help Center

This plugin adds **Help Center** to the app settings after installation and UI permission approval. It searches known download and plugin-installation error codes, including `download_host_private`.

Build the installable package from the repository root:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/yachiyo-env.ps1 -NoProxy pnpm exec node examples/plugins/error-help-center/build.mjs
```

Install `error-help-center.zip` from Settings > Plugins > From ZIP, then grant the plugin UI capability. The settings entry is contributed by the installed plugin, not hard-coded into the host application.
