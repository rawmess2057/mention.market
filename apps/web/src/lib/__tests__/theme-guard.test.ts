import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { PALETTE } from "../theme";

const SRC = path.resolve(__dirname, "../..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === "__tests__" ? [] : sourceFiles(full);
    return /\.(tsx?)$/.test(name) ? [full] : [];
  });
}

/** The retired light "Parchment & Ink" palette. */
const LEGACY = /(?<![\w-])(?:bg|text|border(?:-[trblxy])?|ring|from|via|to|fill|stroke|divide)-(?:cream|navy|gray-mid|gray-warm|gray-cool|red-brand|ink-\d+|blue(?:-[a-z]+)?|green(?:-[a-z]+)?|white(?!\/)|(?:amber|slate|zinc|orange|purple|indigo|pink|violet|teal|emerald|rose|sky|lime|yellow|cyan|gray|neutral|stone|red)-\d+)(?![\w-])/;
const HEX = /["'`(\s]#[0-9a-fA-F]{6}\b/;
/** Places a literal is unavoidable (the browser chrome color). */
const ALLOW_HEX = new Set(["app/layout.tsx"]);

describe("dark theme guard", () => {
  const files = sourceFiles(SRC);

  it("uses only semantic color tokens", () => {
    const offenders: string[] = [];
    for (const file of files) {
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          const hit = line.match(LEGACY);
          if (hit) offenders.push(`${path.relative(SRC, file)}:${i + 1} ${hit[0]}`);
        });
    }
    expect(offenders).toEqual([]);
  });

  it("has no raw hex colors outside lib/theme.ts", () => {
    const offenders = files
      .filter((f) => !f.endsWith(path.join("lib", "theme.ts")) && !ALLOW_HEX.has(path.relative(SRC, f)))
      .filter((f) => HEX.test(readFileSync(f, "utf8")))
      .map((f) => path.relative(SRC, f));
    expect(offenders).toEqual([]);
  });

  it("lib/theme.ts mirrors the CSS tokens", () => {
    const css = readFileSync(path.join(SRC, "app/globals.css"), "utf8");
    for (const [name, rgb] of Object.entries(PALETTE)) {
      const m = css.match(new RegExp(`--${name}:\\s*(\\d+) (\\d+) (\\d+);`));
      expect(m, `--${name} missing from globals.css`).not.toBeNull();
      expect(m!.slice(1).map(Number), `--${name}`).toEqual([...rgb]);
    }
  });
});

describe("cn (tailwind-merge with our theme)", () => {
  it("keeps custom font sizes next to colors", async () => {
    const { cn } = await import("../format");
    expect(cn("text-micro text-fg")).toBe("text-micro text-fg");
    expect(cn("text-label", "text-fg-muted")).toBe("text-label text-fg-muted");
    expect(cn("text-micro", "text-sm")).toBe("text-sm");
    expect(cn("shadow-card text-fg", "shadow-cta")).toBe("text-fg shadow-cta");
  });
});
