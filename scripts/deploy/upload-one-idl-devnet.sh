#!/usr/bin/env bash
# Upload a single Anchor program's IDL to devnet such that it ALWAYS succeeds.
#
# Why this is needed: anchor-cli 0.31.1 `idl upgrade` is just write-buffer +
# set-buffer and NEVER grows the canonical IDL account. When a new IDL is
# larger than the existing account, `IdlSetBuffer` fails with
# RequireGteViolated (0x9ca). The program's own `Resize` instruction is blocked
# on non-empty accounts (IdlAccountNotEmpty), so the only way to grow is
# close + re-init (`idl init` pre-sizes the account to 2x the compressed IDL).
#
# Strategy per program:
#   no canonical IDL account  -> anchor idl init
#   account big enough        -> write-buffer (exact-size oracle) + set-buffer
#   account too small         -> close canonical + anchor idl init
#   always                    -> close the temporary buffer (rent refund)
#
# If the local IDL has not been built yet, it is generated first via
# `anchor idl build` (so the pass never silently skips a program).
#
# Usage:
#   upload-one-idl-devnet.sh <program-name>
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
export PATH="${HOME}/.avm/bin:${PATH}"
unset npm_config_devdir

AVM_ANCHOR="${HOME}/.avm/bin/anchor"
if [[ ! -x "$AVM_ANCHOR" ]]; then
  echo "Install Anchor 0.31.1: avm install 0.31.1 && avm use 0.31.1" >&2
  exit 1
fi

case "${1:?usage: upload-one-idl-devnet.sh <program-name>}" in
  burn_engine)        IDL_PKG=burn_engine;        IDL_FILE=burn_engine.json;        PROGRAM_ID=nFgJEQSrKEi7FdAKC6vz5HsQ6f9QjQLBuQcQqQy45id ;;
  escrow)             IDL_PKG=escrow;             IDL_FILE=escrow.json;             PROGRAM_ID=CTmCryJca9cFyMRaGdzrhyZeEnjdGLD8ZkEqNcNbvh2D ;;
  lending_integrator) IDL_PKG=lending_integrator; IDL_FILE=noviscia_lending.json;   PROGRAM_ID=Ea5TXHxsVcnKwMAcAsQkpPN88xr8ndBRpNGDkREWrbSZ ;;
  nv_usdc_vault)      IDL_PKG=nv_usdc_vault;      IDL_FILE=nv_usdc_vault.json;      PROGRAM_ID=CN92hAtnZxbMxPdho8tugi9GDK86UpGwmnbEvk5yzAWC ;;
  position_tracker)   IDL_PKG=position_tracker;   IDL_FILE=position_tracker.json;   PROGRAM_ID=3zGRWKZq4V3npHbH9Lati46BwgmstTjynWZFFMxarQgY ;;
  staking_manager)    IDL_PKG=staking_manager;    IDL_FILE=staking_manager.json;    PROGRAM_ID=4VDQjH73DiE3zYt66ukyWY7KMMJrxHUZfjkxRHTPDG75 ;;
  token_nvsc)         IDL_PKG=token_nvsc;         IDL_FILE=token_nvsc.json;         PROGRAM_ID=HSaBJHaGa4Hiv1uBYPHQC4ijmnh8237a5LzM8Lyuz1YT ;;
  yield_distributor)  IDL_PKG=yield_distributor;  IDL_FILE=yield_distributor.json;  PROGRAM_ID=CrN1o75FGwcSo6ted7eKxw2kYgkaXDVeWmUaTZCTsLtw ;;
  prediction_market)  IDL_PKG=prediction_market;  IDL_FILE=prediction_market.json;  PROGRAM_ID=3BTcArdsxKhzF2Msjm3JLy343v6ZvQjPusq3V2zRNbpv ;;
  noviscia_clearing)  IDL_PKG=noviscia_clearing;  IDL_FILE=noviscia_clearing.json;  PROGRAM_ID=3BTcArdsxKhzF2Msjm3JLy343v6ZvQjPusq3V2zRNbpv ;;
  liquidation_vault)  IDL_PKG=liquidation_vault;  IDL_FILE=liquidation_vault.json;  PROGRAM_ID=C5mvuPTN7KHQ1NsXSUcD2tEae9fL1pLrNkZD67jRRuf1 ;;
  bug_bounty)         IDL_PKG=bug_bounty;         IDL_FILE=bug_bounty.json;         PROGRAM_ID=A8Uk9WuHumfiuuZAHt4y3t3sXmT3cpXVXaFMhpDinjSK ;;
  protocol_lp_vault)  IDL_PKG=protocol_lp_vault;  IDL_FILE=protocol_lp_vault.json;  PROGRAM_ID=BJVr4bWdNkaUNff3Se6Wob2edPoc64dAaW3Gkgtf4AgT ;;
  netting_engine)     IDL_PKG=netting_engine;     IDL_FILE=netting_engine.json;     PROGRAM_ID=68s4vuWUXAaEFF1EM1RUQpw7SFdYZSV3opvtDqoBCs56 ;;
  *) echo "Unknown program name: $1" >&2; exit 1 ;;
esac

IDL="${ROOT}/target/idl/${IDL_FILE}"
if [[ ! -f "$IDL" ]]; then
  echo "→ ${1}: IDL not built (${IDL}) — building with \`anchor idl build\` ..."
  if ! "$AVM_ANCHOR" idl build -p "$IDL_PKG" -o "$IDL" 2>&1; then
    echo "  anchor idl build failed for ${1}; skipping." >&2
    exit 0
  fi
fi

# Stamp the program id into the IDL (mirrors the previous `idl init/upgrade` flow).
node -e "
  const fs=require('fs');
  const p='${IDL}';
  const j=JSON.parse(fs.readFileSync(p));
  j.address='${PROGRAM_ID}';
  fs.writeFileSync(p, JSON.stringify(j, null, 2));
"

echo "→ ${1} (${PROGRAM_ID})"

# Canonical IDL account total data length, or NONE when it does not exist.
# Retried on transient RPC failures (devnet throttling).
SPACE="$(node -e '
  const { PublicKey } = require("@solana/web3.js");
  const https = require("https");
  (async () => {
    const pid = new PublicKey(process.argv[1]);
    const [signer] = PublicKey.findProgramAddressSync([], pid);
    const idlAddr = (await PublicKey.createWithSeed(signer, "anchor:idl", pid)).toBase58();
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getAccountInfo", params: [idlAddr, { encoding: "base64" }] });
    let result = "";
    for (let attempt = 1; attempt <= 3; attempt++) {
      const ok = await new Promise((resolve) => {
        const req = https.request("https://api.devnet.solana.com", { method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } }, (res) => {
          let d = "";
          res.on("data", (c) => (d += c));
          res.on("end", () => {
            try {
              const acc = JSON.parse(d).result?.value;
              result = acc ? String(Buffer.from(acc.data[0], "base64").length) : "NONE";
              resolve(true);
            } catch (e) { resolve(false); }
          });
        });
        req.on("error", () => resolve(false));
        req.write(body);
        req.end();
      });
      if (ok) break;
      if (attempt < 3) await new Promise((r) => setTimeout(r, 800));
    }
    if (!result) process.exit(1);
    process.stdout.write(result);
  })();
' "$PROGRAM_ID")"

if [[ -z "$SPACE" ]]; then
  echo "  failed to query canonical IDL account for ${PROGRAM_ID}" >&2
  exit 1
fi

if [[ "$SPACE" == "NONE" ]]; then
  echo "  no canonical IDL account → anchor idl init"
  "$AVM_ANCHOR" idl init --filepath "$IDL" "$PROGRAM_ID" --provider.cluster devnet
  exit 0
fi

# Create the buffer: the CLI reports its exact compressed length, which is the
# size `IdlSetBuffer` requires the canonical account to be able to hold.
OUT="$("$AVM_ANCHOR" idl write-buffer --filepath "$IDL" "$PROGRAM_ID" --provider.cluster devnet 2>&1)"
echo "$OUT"
LEN="$(printf '%s\n' "$OUT" | grep -oE 'Idl data length: [0-9]+' | tail -1 | grep -oE '[0-9]+')" || LEN=""
BUF="$(printf '%s\n' "$OUT" | grep -oE 'Idl buffer created: [A-Za-z0-9]+' | tail -1 | awk '{print $4}')" || BUF=""
if [[ -z "$LEN" || -z "$BUF" ]]; then
  echo "  could not parse write-buffer output (LEN='$LEN' BUF='$BUF')" >&2
  exit 1
fi

CAPACITY=$(( SPACE - 44 ))
if (( LEN <= CAPACITY )); then
  echo "  buffer ${LEN}B fits canonical account (${CAPACITY}B) → set-buffer"
  "$AVM_ANCHOR" idl set-buffer --buffer "$BUF" "$PROGRAM_ID" --provider.cluster devnet
else
  echo "  buffer ${LEN}B > canonical account capacity (${CAPACITY}B) → close + re-init"
  "$AVM_ANCHOR" idl close "$PROGRAM_ID" --provider.cluster devnet
  "$AVM_ANCHOR" idl init --filepath "$IDL" "$PROGRAM_ID" --provider.cluster devnet
fi

"$AVM_ANCHOR" idl close "$PROGRAM_ID" --idl-address "$BUF" --provider.cluster devnet
echo "✓ ${1} IDL live on devnet (${LEN}B compressed)"
