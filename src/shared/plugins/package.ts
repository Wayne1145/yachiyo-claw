/**
 * Installable-plugin package format (Tier B).
 *
 * A plugin is a ZIP (not a bare JS file, not tar.gz): `jszip@3.10.1` is already pinned and used in two
 * production paths, the TS side has no tar unpacker, and a per-file sha256 manifest needs a container.
 * The executable code is a single self-contained `entry` file — the host does NOT resolve `import` /
 * `require`. Making the host a module resolver would turn "what is a module and where does it load
 * from" into an attack surface; plugin authors bundle to one entry file instead.
 *
 * ```
 * my-plugin.zip
 *   yachiyo-plugin.json     # manifest, required
 *   main.js                 # entry script, required for non-declarative plugins
 *   ui/*.json               # optional, declarative UI definitions
 *   assets/*                # optional, icons and static resources
 *   README.md               # optional
 * ```
 *
 * This module names the layout. Parsing, unpacking, verification, and versioned installation live in
 * the adjacent plugin platform modules.
 */
export const PLUGIN_PACKAGE_FORMAT = 'zip' as const
export const PLUGIN_MANIFEST_FILENAME = 'yachiyo-plugin.json' as const

/** Upper bounds enforced by the verifier/installer; declared here so the format has one source of truth. */
export const PLUGIN_PACKAGE_LIMITS = {
  maxArchiveBytes: 40 * 1024 * 1024,
  maxFiles: 512,
  maxEntryBytes: 2 * 1024 * 1024, // a bundled single-file entry
  maxTotalUnpackedBytes: 32 * 1024 * 1024,
} as const
