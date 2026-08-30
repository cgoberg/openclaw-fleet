#!/usr/bin/env bash
# Build release artifacts and SHA256SUMS into release/<version>/ (gitignored).
# Local-only: does not tag, publish, push, or leave the checkout.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="$(node -p "require('${REPO_ROOT}/plugin/package.json').version")"
OUT_DIR="${REPO_ROOT}/release/v${VERSION}"

echo "==> Building Rust binary (release)"
cargo build --release --manifest-path "${REPO_ROOT}/binary/Cargo.toml"

echo "==> Building plugin"
(cd "${REPO_ROOT}/plugin" && npm ci && npm run build)

mkdir -p "${OUT_DIR}"

echo "==> Packing plugin tarball"
(cd "${REPO_ROOT}/plugin" && npm pack --pack-destination "${OUT_DIR}" >/dev/null)
mv "${OUT_DIR}/openclaw-fleet-${VERSION}.tgz" \
   "${OUT_DIR}/openclaw-fleet-plugin-v${VERSION}.tgz"

echo "==> Staging binary"
cp "${REPO_ROOT}/binary/target/release/openclaw-fleet" \
   "${OUT_DIR}/openclaw-fleet-linux-x86_64-v${VERSION}"

echo "==> Writing checksums"
(
  cd "${OUT_DIR}"
  sha256sum "openclaw-fleet-plugin-v${VERSION}.tgz" \
            "openclaw-fleet-linux-x86_64-v${VERSION}" > SHA256SUMS.txt
)

echo "==> Artifacts in ${OUT_DIR}:"
ls -la "${OUT_DIR}"
cat "${OUT_DIR}/SHA256SUMS.txt"
