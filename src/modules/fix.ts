import fs from "fs";
import path from "path";
import chalk from "chalk";
import { execa } from "execa";
import { getStagedFiles, getDiffForFiles } from "./git";
import { generateFixDiff } from "./groq";
import { pickContextFiles, expandContextByImports } from "./contextResolver";

type FixOptions = {
  mode: "staged" | "all";
  apply: boolean;
  dryRun: boolean;
  format: "diff" | "json";
};

function listAllProjectFiles(): string[] {
  const fg = require("fast-glob");
  return fg.sync(["**/*"], {
    ignore: ["node_modules/**", ".git/**", "dist/**"],
    cwd: process.cwd(),
    dot: true,
    onlyFiles: true,
    followSymbolicLinks: true,
  });
}

function buildSyntheticDiff(files: string[]): string {
  let out = "";
  for (const f of files) {
    try {
      const content = fs.readFileSync(f, "utf8");
      out += `diff --git a/${f} b/${f}\n`;
      out += `--- a/${f}\n`;
      out += `+++ b/${f}\n`;
      for (const line of content.split("\n")) {
        out += `+${line}\n`;
      }
    } catch {}
  }
  return out;
}

function readConfig(): { model?: string } {
  const cfgPath = path.join(process.cwd(), "prefl.json");
  if (!fs.existsSync(cfgPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(cfgPath, "utf8"));
  } catch {
    return {};
  }
}

export async function runFix(options: FixOptions): Promise<void> {
  const cfg = readConfig();
  const model =
    cfg.model || process.env.PREFL_MODEL || "moonshotai/kimi-k2-instruct-0905";

  const files =
    options.mode === "staged" ? await getStagedFiles() : listAllProjectFiles();
  if (files.length === 0) {
    console.log(chalk.yellow("No files to fix."));
    return;
  }

  const diff =
    options.mode === "staged"
      ? await getDiffForFiles(files)
      : buildSyntheticDiff(files);

  const baseLimit = parseInt(process.env.PREFL_BASE_CONTEXT_LIMIT || "10", 10);
  const importLimit = parseInt(
    process.env.PREFL_IMPORT_EXPANSION_LIMIT || "20",
    10
  );
  const baseContext = pickContextFiles(files, baseLimit);
  const contextFiles = expandContextByImports(baseContext, importLimit);

  // Directly generate fix patch (caching disabled)
  const patch = await generateFixDiff({ diff, contextFiles, model });

  if (options.format === "json") {
    console.log(JSON.stringify({ patch }, null, 2));
  } else {
    process.stdout.write(patch);
  }

  // Always drop a copy to .prefl
  const outDir = path.join(process.cwd(), ".prefl");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `fix.patch`);
  fs.writeFileSync(outFile, patch);
  console.log(
    chalk.gray(`Patch written to ${path.relative(process.cwd(), outFile)}`)
  );

  if (options.dryRun) {
    try {
      await execa("git", ["apply", "--check", outFile], { stdio: "inherit" });
      console.log(chalk.green("Patch is applicable (dry run)."));
    } catch {
      console.log(chalk.red("Patch does not apply cleanly."));
    }
  }

  if (options.apply) {
    try {
      await execa("git", ["apply", outFile], { stdio: "inherit" });
      console.log(chalk.green("Patch applied."));
    } catch (e) {
      console.log(chalk.red("Failed to apply patch. Try --dry-run first."));
    }
  }
}
