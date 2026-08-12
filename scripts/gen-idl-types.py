#!/usr/bin/env python3
"""Generate TypeScript types from Anchor IDL JSON files."""

import json
import os
import sys
from pathlib import Path

IDL_DIR = Path(__file__).parent.parent / "app" / "web" / "app" / "idl"
OUT_DIR = Path(__file__).parent.parent / "app" / "web" / "lib" / "idl-types"

# Map IDL filename -> program name for the type namespace
PROGRAMS = {
    "nv_usdc_vault": "NvUsdcVault",
    "escrow": "Escrow",
    "position_tracker": "PositionTracker",
    "staking_manager": "StakingManager",
    "burn_engine": "BurnEngine",
    "token_nvsc": "TokenNvsc",
    "liquidation_vault": "LiquidationVault",
    "prediction_market": "PredictionMarket",
    "noviscia_clearing": "NovisciaClearing",
    "protocol_lp_vault": "ProtocolLpVault",
    "yield_distributor": "YieldDistributor",
}

IDL_TYPE_MAP = {
    "bool": "boolean",
    "u8": "number",
    "i8": "number",
    "u16": "number",
    "i16": "number",
    "u32": "number",
    "i32": "number",
    "u64": "bigint",
    "i64": "bigint",
    "u128": "bigint",
    "i128": "bigint",
    "f32": "number",
    "f64": "number",
    "string": "string",
    "pubkey": "string",
    "publicKey": "string",
    "bytes": "Uint8Array",
    "void": "void",
}


def ts_type(type_def, types_map=None):
    """Convert an IDL type definition to a TypeScript type string."""
    if isinstance(type_def, str):
        return IDL_TYPE_MAP.get(type_def, type_def)

    if isinstance(type_def, dict):
        kind = type_def.get("kind", type_def.get("type", ""))

        # Option<T>
        if kind == "option" or (isinstance(type_def, dict) and type_def.get("type") == "option"):
            inner = type_def.get("inner", type_def.get("type", {}).get("inner"))
            if inner:
                return f"{ts_type(inner, types_map)} | null"
            return "any"

        # Vec<T>
        if kind == "vec" or (isinstance(type_def, dict) and type_def.get("type") == "vec"):
            inner = type_def.get("inner", type_def.get("type", {}).get("inner"))
            if inner:
                return f"Array<{ts_type(inner, types_map)}>"
            return "Array<any>"

        # Array<T, N>
        if kind == "array":
            inner = type_def.get("inner", type_def.get("type", {}).get("inner"))
            return f"Array<{ts_type(inner, types_map)}>" if inner else "Array<any>"

        # Defined type reference
        if kind == "defined":
            name = type_def.get("name", "unknown")
            return name

        # Tuple
        if kind == "tuple":
            inners = type_def.get("inners", [])
            parts = [ts_type(i, types_map) for i in inners]
            return f"[{', '.join(parts)}]"

        # Check for {"type": "option", "inner": ...} format
        if "type" in type_def and isinstance(type_def["type"], str):
            return IDL_TYPE_MAP.get(type_def["type"], type_def["type"])

        if "type" in type_def and isinstance(type_def["type"], dict):
            return ts_type(type_def["type"], types_map)

    return "any"


def pascal(name):
    """Convert snake_case to PascalCase, preserving acronyms."""
    parts = name.split("_")
    return "".join(w[:1].upper() + w[1:] if len(w) > 1 else w.upper() for w in parts)


def camel(name):
    """Convert snake_case to camelCase."""
    parts = name.split("_")
    return parts[0] + "".join(w[:1].upper() + w[1:] if len(w) > 1 else w.upper() for w in parts[1:])


def gen_ts_fields(fields, types_map, indent=2):
    """Generate TypeScript interface fields from IDL fields."""
    lines = []
    for f in fields:
        fname = f["name"]
        camel_name = camel(fname)
        ftype = ts_type(f["type"], types_map)
        prefix = " " * indent
        if camel_name != fname:
            lines.append(f'{prefix}/** Raw: {fname} */')
        lines.append(f'{prefix}{camel_name}: {ftype};')
    return "\n".join(lines)


def process_idl(idl_path, namespace):
    """Process a single IDL JSON and return TS type definitions."""
    with open(idl_path) as f:
        idl = json.load(f)

    types_map = {}
    # Build types map from the "types" array
    for t in idl.get("types", []):
        types_map[t["name"]] = pascal(t["name"])

    lines = []
    lines.append(f"// Auto-generated from {idl_path.name} — do not edit manually.")
    lines.append("")

    # Account types (from types array, filtered to those that have a discriminator in accounts)
    account_names = {a["name"] for a in idl.get("accounts", [])}

    for t in idl.get("types", []):
        name = pascal(t["name"])
        type_info = t.get("type", {})
        if type_info.get("kind") == "struct":
            fields = type_info.get("fields", [])
            lines.append(f"export interface {name} {{")
            lines.append(gen_ts_fields(fields, types_map))
            lines.append("}")
            lines.append("")

            # If it's an account, also generate a camelCase field-access type
            if t["name"] in account_names:
                lines.append(f"// Account discriminator name: {t['name']}")
                lines.append("")

    # Enum types
    for t in idl.get("types", []):
        name = pascal(t["name"])
        type_info = t.get("type", {})
        if type_info.get("kind") == "enum":
            variants = type_info.get("variants", [])
            # Simple string union for fieldless variants, object union for ones with fields
            has_fields = any(v.get("fields") for v in variants)
            if has_fields:
                lines.append(f"export type {name} =")
                for v in variants:
                    vname = pascal(v["name"])
                    if v.get("fields"):
                        fields_str = ", ".join(
                            f'{f["name"]}: {ts_type(f["type"], types_map)}'
                            for f in v["fields"]
                        )
                        lines.append(f"  | {{{{ kind: '{v['name']}'; {fields_str} }}}}")
                    else:
                        lines.append(f"  | {{{{ kind: '{v['name']}' }}}}")
                lines.append(";")
            else:
                members = " | ".join(f"'{v['name']}'" for v in variants)
                lines.append(f"export type {name} = {members};")
            lines.append("")

    # Instruction arg types
    for ix in idl.get("instructions", []):
        ix_name = ix["name"]
        args = ix.get("args", [])
        if args:
            type_name = f"{pascal(ix_name)}Args"
            lines.append(f"export interface {type_name} {{")
            lines.append(gen_ts_fields(args, types_map))
            lines.append("}")
            lines.append("")

    # Instruction accounts type (the accounts object)
    for ix in idl.get("instructions", []):
        ix_name = ix["name"]
        accounts = ix.get("accounts", [])
        if accounts:
            type_name = f"{pascal(ix_name)}Accounts"
            lines.append(f"export interface {type_name} {{")
            for acc in accounts:
                acc_name = acc["name"]
                acc_camel = camel(acc_name)
                optional = acc.get("isOptional", False)
                suffix = "?" if optional else ""
                lines.append(f"  {acc_camel}{suffix}: string;")
            lines.append("}")
            lines.append("")

    return "\n".join(lines)


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    # Index file
    index_lines = ["// Auto-generated IDL types — do not edit manually.", ""]

    for idl_file, namespace in PROGRAMS.items():
        idl_path = IDL_DIR / f"{idl_file}.json"
        if not idl_path.exists():
            print(f"  SKIP {idl_file}.json — not found")
            continue

        ts_content = process_idl(idl_path, namespace)
        out_file = OUT_DIR / f"{idl_file}.ts"
        with open(out_file, "w") as f:
            f.write(ts_content)
        print(f"  ✓ {out_file.name} ({len(ts_content)} bytes)")
        index_lines.append(f"export * from './{idl_file}';")

    # Write index.ts
    with open(OUT_DIR / "index.ts", "w") as f:
        f.write("\n".join(index_lines) + "\n")
    print(f"  ✓ index.ts")

    print(f"\nGenerated types in {OUT_DIR}")


if __name__ == "__main__":
    main()
