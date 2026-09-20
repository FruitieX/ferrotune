#!/usr/bin/env node
// Convert ts-rs generated TypeScript contracts into Kotlin @Serializable
// DTOs for android/core/network.
//
// The TypeScript files are the wire-shape source of truth (field names,
// nullability, arrays). The Rust sources are indexed only to recover numeric
// precision that TypeScript loses (i32 vs i64 vs f64), since ts-rs renders all
// of them as `number`.
//
// Usage: node android/scripts/generate-kotlin-bindings.mjs
// Run from the repository root.

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const TS_DIR = "client/src/lib/api/generated";
const RUST_SRC_DIR = "src";
const OUT_DIR =
  "android/core/network/src/main/java/com/ferrotune/core/network/generated";
const PACKAGE = "com.ferrotune.core.network.generated";

const warnings = [];

function warn(message) {
  warnings.push(message);
}

// ---------------------------------------------------------------------------
// Rust index: struct name -> { fields: Map<wireName, rustType> }
// ---------------------------------------------------------------------------

function walkFiles(dir, predicate, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(full, predicate, out);
    } else if (predicate(full)) {
      out.push(full);
    }
  }
  return out;
}

function splitTopLevel(text, separator = ",") {
  const parts = [];
  let depth = 0;
  let current = "";
  for (const ch of text) {
    if ("<([{".includes(ch)) depth++;
    if (">)]}".includes(ch)) depth--;
    if (ch === separator && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current);
  return parts;
}

function toCamelCase(name) {
  return name.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
}

function toPascalCase(name) {
  const camel = toCamelCase(name);
  return camel.charAt(0).toUpperCase() + camel.slice(1);
}

function applyRenameAll(name, renameAll) {
  switch (renameAll) {
    case "camelCase":
      return toCamelCase(name);
    case "PascalCase":
      return toPascalCase(name);
    case "lowercase":
      return name.toLowerCase();
    case "UPPERCASE":
      return name.toUpperCase();
    case "SCREAMING_SNAKE_CASE":
      return name.toUpperCase();
    default:
      return name;
  }
}

function buildRustIndex() {
  const structs = new Map();
  const structPattern =
    /((?:#\[[^\]]*\]\s*)*)pub struct (\w+)(?:<[^>]*>)?\s*\{([\s\S]*?)\n\}/g;

  for (const file of walkFiles(RUST_SRC_DIR, (f) => f.endsWith(".rs"))) {
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(structPattern)) {
      const attributes = match[1];
      const structName = match[2];
      const body = match[3];
      const isExported = /ts\(|TS\b/.test(attributes);
      const renameAllMatch = attributes.match(
        /(?:serde|ts)\([^)]*rename_all\s*=\s*"(\w+)"/
      );
      const renameAll = renameAllMatch ? renameAllMatch[1] : null;

      const fields = new Map();
      for (const rawField of splitTopLevel(body)) {
        const fieldAttributes = [
          ...rawField.matchAll(/#\[([^\]]*)\]/g),
        ].map((m) => m[1]);
        const fieldMatch = rawField
          .replace(/#\[[^\]]*\]/g, "")
          .replace(/\/\/[^\n]*/g, "")
          .match(/(?:pub\s+)?(\w+)\s*:\s*([\s\S]+)$/);
        if (!fieldMatch) continue;
        const rustName = fieldMatch[1];
        const rustType = fieldMatch[2].replace(/\s+/g, " ").trim();
        const flatten = fieldAttributes.some((attribute) =>
          /(?:serde|ts)\([^)]*\bflatten\b/.test(attribute)
        );
        let wireName = renameAll ? applyRenameAll(rustName, renameAll) : rustName;
        for (const attribute of fieldAttributes) {
          const renameMatch = attribute.match(
            /(?:serde|ts)\([^)]*rename\s*=\s*"([^"]+)"/
          );
          if (renameMatch) wireName = renameMatch[1];
        }
        fields.set(wireName, { type: rustType, flatten });
      }

      const existing = structs.get(structName);
      if (!existing || (isExported && !existing.exported)) {
        structs.set(structName, { exported: isExported, fields });
      }
    }
  }
  if (process.env.FERROTUNE_DEBUG_INDEX) {
    const debug = structs.get(process.env.FERROTUNE_DEBUG_INDEX);
    console.error(
      `${process.env.FERROTUNE_DEBUG_INDEX} exported=${debug?.exported}:`,
      debug ? JSON.stringify([...debug.fields], null, 1) : "missing"
    );
  }
  return structs;
}

function resolveRustField(rustIndex, structName, wireName, seen = new Set()) {
  if (seen.has(structName)) return null;
  seen.add(structName);
  const struct = rustIndex.get(structName);
  if (!struct) return null;
  const direct = struct.fields.get(wireName);
  if (direct) return direct.type;
  for (const field of struct.fields.values()) {
    if (!field.flatten) continue;
    const flattened = field.type
      .replace(/^Option<([\s\S]+)>$/, "$1")
      .replace(/\s+/g, "");
    const resolved = resolveRustField(rustIndex, flattened, wireName, seen);
    if (resolved) return resolved;
  }
  return null;
}

// ---------------------------------------------------------------------------
// TypeScript parsing
// ---------------------------------------------------------------------------

function stripComments(source) {
  return source
    .replace(/\/\*\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
}

function parseTsFile(file) {
  const source = stripComments(fs.readFileSync(file, "utf8"));
  const match = source.match(/export type (\w+) = ([\s\S]*?);\s*$/);
  if (!match) return null;
  const name = match[1];
  const rhs = match[2].trim();

  if (rhs.startsWith("{")) {
    const body = rhs.slice(1, rhs.lastIndexOf("}"));
    const fields = [];
    for (const rawField of splitTopLevel(body)) {
      const fieldMatch = rawField
        .replace(/\n/g, " ")
        .match(/^\s*(\w+)(\?)?\s*:\s*([\s\S]+)$/);
      if (!fieldMatch) {
        warn(`${file}: cannot parse field: ${rawField.trim().slice(0, 60)}`);
        continue;
      }
      fields.push({
        name: fieldMatch[1],
        optional: Boolean(fieldMatch[2]),
        tsType: fieldMatch[3].trim(),
      });
    }
    return { name, kind: "object", fields };
  }

  if (rhs.startsWith('"')) {
    const values = [...rhs.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    const leftover = rhs.replace(/"[^"]+"|\s+|\|/g, "");
    if (leftover !== "") {
      warn(`${file}: string union has non-string members, skipping enum`);
      return null;
    }
    return { name, kind: "enum", values };
  }

  warn(`${file}: unsupported type shape: ${rhs.slice(0, 60)}`);
  return null;
}

// ---------------------------------------------------------------------------
// Type mapping
// ---------------------------------------------------------------------------

function isNullable(tsType) {
  return /\|\s*(null|undefined)\b/.test(tsType);
}

function stripNullable(tsType) {
  return tsType
    .split("|")
    .map((part) => part.trim())
    .filter((part) => part !== "null" && part !== "undefined")
    .join(" | ");
}

function unwrapRustType(rustType, wrapper) {
  if (!rustType) return null;
  const match = rustType.replace(/\s+/g, "").match(
    new RegExp(`^${wrapper}<([\\s\\S]+)>$`)
  );
  return match ? match[1] : null;
}

function numberType(rustType) {
  if (!rustType) return null;
  const inner = unwrapRustType(rustType, "Option") ?? rustType;
  const normalized = inner.replace(/\s+/g, "");
  if (/\bf32\b|\bf64\b/.test(normalized)) return "Double";
  if (/\bi64\b|\bu64\b|\busize\b|\bisize\b/.test(normalized)) return "Long";
  if (/\bi8\b|\bi16\b|\bi32\b|\bu8\b|\bu16\b|\bu32\b/.test(normalized)) {
    return "Int";
  }
  return null;
}

function mapTsType(tsType, rustType, generatedNames, context) {
  const type = tsType.trim();

  const nullable = isNullable(type);
  const base = stripNullable(type);

  const mapped = mapNonNullable(base, rustType, generatedNames, context);
  return nullable ? `${mapped}?` : mapped;
}

function mapNonNullable(type, rustType, generatedNames, context) {
  const rustInner = unwrapRustType(rustType, "Option") ?? rustType;
  const arrayMatch = type.match(/^Array<([\s\S]+)>$/);
  if (arrayMatch) {
    const elementRust = unwrapRustType(rustInner, "Vec");
    return `List<${mapTsType(arrayMatch[1], elementRust, generatedNames, context)}>`;
  }
  if (type.endsWith("[]")) {
    const elementRust = unwrapRustType(rustInner, "Vec");
    return `List<${mapTsType(
      type.slice(0, -2),
      elementRust,
      generatedNames,
      context
    )}>`;
  }

  const recordMatch = type.match(/^Record<([\s\S]+)>$/);
  if (recordMatch) {
    const parts = splitTopLevel(recordMatch[1]);
    const valueRust = unwrapRustType(rustInner, "HashMap") ?? rustInner;
    return `Map<String, ${mapTsType(
      parts.slice(1).join(","),
      valueRust,
      generatedNames,
      context
    )}>`;
  }

  const mappedType = type.match(/^\{\s*\[key in string\]\?:?\s*([\s\S]+?)\s*\}$/);
  if (mappedType) {
    const valueRust = unwrapRustType(rustInner, "HashMap") ?? rustInner;
    return `Map<String, ${mapTsType(
      mappedType[1],
      valueRust,
      generatedNames,
      context
    )}>`;
  }

  if (type.startsWith("{")) return "JsonElement";

  if (type === "string") return "String";
  if (type === "boolean") return "Boolean";
  if (type === "unknown" || type === "any") return "JsonElement";
  if (type === "number") {
    const resolved = numberType(rustType);
    if (resolved) return resolved;
    warn(
      `${context}: unresolved numeric precision, defaulting to Double (rust: ${rustType ?? "unknown"})`
    );
    return "Double";
  }

  if (type.includes("|")) {
    warn(`${context}: heterogeneous union mapped to JsonElement (${type})`);
    return "JsonElement";
  }

  if (type.startsWith("import(")) return "JsonElement";

  if (/^\w+$/.test(type)) {
    if (generatedNames.has(type)) return type;
    warn(`${context}: unknown type reference ${type}, mapped to JsonElement`);
    return "JsonElement";
  }

  warn(`${context}: unmapped type ${type}, using JsonElement`);
  return "JsonElement";
}

// ---------------------------------------------------------------------------
// Kotlin emission
// ---------------------------------------------------------------------------

function enumEntryName(value) {
  const snake = value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
  const safe = snake === "" ? "VALUE" : snake;
  return /^\d/.test(safe) ? `VALUE_${safe}` : safe;
}

function emitKotlin(types, generatedNames, rustIndex) {
  const files = [];
  for (const type of types) {
    const imports = new Set(["kotlinx.serialization.Serializable"]);
    const lines = [];

    if (type.kind === "enum") {
      imports.add("kotlinx.serialization.SerialName");
      lines.push("@Serializable");
      lines.push(`enum class ${type.name} {`);
      const used = new Set();
      type.values.forEach((value, index) => {
        let entry = enumEntryName(value);
        while (used.has(entry)) entry = `${entry}_${index}`;
        used.add(entry);
        lines.push(`    @SerialName("${value}")`);
        lines.push(`    ${entry},`);
      });
      lines.push("}");
    } else {
      const rustStruct = rustIndex.get(type.name);
      if (!rustStruct) {
        warn(`${type.name}: no matching Rust struct, precision may be guessed`);
      }
      const fields = type.fields.map((field) => {
        const rustType = resolveRustField(rustIndex, type.name, field.name);
        if (!rustType) {
          warn(`${type.name}.${field.name}: no Rust field match`);
        }
        const mapped = mapTsType(
          field.tsType,
          rustType,
          generatedNames,
          `${type.name}.${field.name}`
        );
        const nullable = field.optional || isNullable(field.tsType);
        const fieldType =
          nullable && !mapped.endsWith("?") ? `${mapped}?` : mapped;
        if (fieldType.includes("JsonElement")) imports.add("kotlinx.serialization.json.JsonElement");
        return {
          name: field.name,
          type: fieldType,
          default: nullable ? " = null" : "",
        };
      });

      lines.push("@Serializable");
      lines.push(`data class ${type.name}(`);
      fields.forEach((field) => {
        lines.push(`    val ${field.name}: ${field.type}${field.default},`);
      });
      lines.push(")");
    }

    const header = [
      "// Generated by android/scripts/generate-kotlin-bindings.mjs from",
      "// client/src/lib/api/generated. Do not edit manually; run",
      "// `moon run android:generate-bindings`.",
      "",
      `package ${PACKAGE}`,
      "",
      ...[...imports].sort().map((i) => `import ${i}`),
      "",
      "",
    ];
    files.push({
      name: `${type.name}.kt`,
      content: header.join("\n") + lines.join("\n") + "\n",
    });
  }
  return files;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const rustIndex = buildRustIndex();

  const tsFiles = fs
    .readdirSync(TS_DIR)
    .filter((file) => file.endsWith(".ts") && file !== "index.ts")
    .sort();

  const parsed = [];
  for (const file of tsFiles) {
    const type = parseTsFile(path.join(TS_DIR, file));
    if (type) parsed.push(type);
  }

  const generatedNames = new Set(parsed.map((type) => type.name));
  const kotlinFiles = emitKotlin(parsed, generatedNames, rustIndex);

  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const file of kotlinFiles) {
    fs.writeFileSync(path.join(OUT_DIR, file.name), file.content);
  }

  const unresolved = warnings.filter((w) => !w.includes("no Rust field match"));
  const missingFields = warnings.filter((w) => w.includes("no Rust field match"));

  console.log(
    `Generated ${kotlinFiles.length} Kotlin DTO files in ${OUT_DIR}`
  );
  if (missingFields.length > 0) {
    console.log(
      `Note: ${missingFields.length} fields had no Rust field match (flattened/renamed); numeric precision falls back to Double.`
    );
    for (const message of missingFields.slice(0, 10)) console.log(`  - ${message}`);
  }
  if (unresolved.length > 0) {
    console.log(`Warnings (${unresolved.length}):`);
    for (const message of unresolved) console.log(`  - ${message}`);
  }
}

main();
