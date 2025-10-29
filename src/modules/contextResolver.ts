import fs from "fs";
import path from "path";

export function pickContextFiles(
  files: string[],
  limit: number
): { path: string; content: string }[] {
  const out: { path: string; content: string }[] = [];
  for (const f of files.slice(0, limit)) {
    try {
      const content = fs.readFileSync(f, "utf8");
      out.push({ path: f, content: content.slice(0, 20000) });
    } catch {
    }
  }
  return out;
}

export function expandContextByImports(
  seed: { path: string; content: string }[],
  maxFiles: number
): { path: string; content: string }[] {
  const out: { path: string; content: string }[] = [...seed];
  const seen = new Set(seed.map((s) => s.path));
  const queue = [...seed];
  while (queue.length && out.length < maxFiles) {
    const item = queue.shift()!;
    const imports = parseRelativeImports(item.content);
    for (const imp of imports) {
      const resolved = resolveImportPath(item.path, imp);
      if (!resolved) continue;
      if (seen.has(resolved)) continue;
      try {
        const content = fs.readFileSync(resolved, "utf8");
        const entry = { path: resolved, content: content.slice(0, 20000) };
        out.push(entry);
        queue.push(entry);
        seen.add(resolved);
        if (out.length >= maxFiles) break;
      } catch {
      }
    }
  }
  return out;
}

export function parseRelativeImports(src: string): string[] {
  const regexes = [
    /import\s+[^'"\n]+from\s+['"](\.[^'"\n]+)['"]/g,
    /require\(\s*['"](\.[^'"\n]+)['"]\s*\)/g,
    /export\s+\*\s+from\s+['"](\.[^'"\n]+)['"]/g,
    /from\s+\.\S+\s+import/g,
    /import\s+\.\S+/g,
    /import\s+['"](\.[^'"\n]+)['"]/g,
    /import\s+(\w+\.)+\w+/g,
    /#include\s+['"](\.[^'"\n]+)['"]/g,
    /require_once\s+['"](\.[^'"\n]+)['"]/g,
    /include\s+['"](\.[^'"\n]+)['"]/g,
    /require_relative\s+['"](\.[^'"\n]+)['"]/g,
    /use\s+crate::/g,
    /mod\s+\w+/g,
  ];
  const found: string[] = [];
  for (const rx of regexes) {
    let m: RegExpExecArray | null;
    while ((m = rx.exec(src))) {
      if (m[1]) found.push(m[1]);
    }
  }
  return Array.from(new Set(found));
}

export function resolveImportPath(fromFile: string, rel: string): string | undefined {
  const baseDir = path.dirname(
    path.isAbsolute(fromFile) ? fromFile : path.join(process.cwd(), fromFile)
  );

  const extensions = [
    "",
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".py",
    ".pyi",
    ".go",
    ".java",
    ".kt",
    ".kts",
    ".c",
    ".cpp",
    ".cc",
    ".cxx",
    ".h",
    ".hpp",
    ".php",
    ".rb",
    ".rs",
    ".swift",
    ".cs",
    ".vue",
    ".svelte",
    ".dart",
    ".scala",
    ".lua",
    ".r",
    ".R",
  ];

  const indexFiles = [
    "index.ts",
    "index.tsx",
    "index.js",
    "index.jsx",
    "__init__.py",
    "mod.rs",
  ];

  const candidates: string[] = [];

  for (const ext of extensions) {
    candidates.push(path.join(baseDir, rel + ext));
  }

  for (const idx of indexFiles) {
    candidates.push(path.join(baseDir, rel, idx));
  }

  for (const c of candidates) {
    if (fs.existsSync(c)) return path.relative(process.cwd(), c);
  }

  return undefined;
}


