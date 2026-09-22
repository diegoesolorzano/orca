// Fork build override (diegoesolorzano/orca): upstream's mac target builds both
// x64 and arm64 (release dmg/zip, config/electron-builder.config.cjs). The fork
// only ships arm64 (Apple Silicon), and the x64 slice needs native variants
// (@parcel/watcher-darwin-x64, sherpa-onnx-darwin-x64) we deliberately do not
// install. Narrowing every mac target entry to arm64 makes electron-builder
// never attempt x64, so a plain `pnpm install` build succeeds. Everything else
// (signing, hooks, entitlements) is inherited unchanged.
const base = require('./electron-builder.config.cjs')

module.exports = {
  ...base,
  mac: {
    ...base.mac,
    target: (base.mac?.target ?? []).map((entry) =>
      typeof entry === 'string' ? { target: entry, arch: ['arm64'] } : { ...entry, arch: ['arm64'] }
    )
  }
}
