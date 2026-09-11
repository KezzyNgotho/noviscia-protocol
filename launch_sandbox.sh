#!/usr/bin/env bash
# Backward-compatible delegator — the canonical launcher lives at
# `sandbox-launcher/launch_sandbox.sh` (pitch spec: `client-sdk/sandbox-launcher`).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$HERE/sandbox-launcher/launch_sandbox.sh" "$@"