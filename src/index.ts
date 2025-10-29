#!/usr/bin/env node
import { Command } from "commander";
import dotenv from "dotenv";
import { runInit } from "./modules/init";
import { runAnalyze } from "./modules/analyze";
import { installHook } from "./modules/hook";
import { runFix } from "./modules/fix";
import pkg from "../package.json";

dotenv.config();

const program = new Command();
program
  .name("prefl")
  .description(
    "Prefl AI CLI - analyze staged changes with Groq for code review"
  )
  .version(pkg.version as string);

program
  .command("init")
  .description("Initialize Prefl in this repository")
  .option("-f, --force", "Overwrite existing config if present", false)
  .action(async (opts: { force?: boolean }) => {
    await runInit(Boolean(opts?.force));
  });

program
  .command("analyze")
  .description("Analyze staged changes")
  .option("--staged", "Analyze only staged changes", true)
  .option("--all", "Analyze entire repository (respects ignores)", false)
  .option("--format <fmt>", "Output format: pretty|json", "pretty")
  .option("--output <file>", "Save results to file (default: prefl.txt)", "")
  .option("--auto-fix", "Automatically fix safe issues", false)
  .option("--dry-run", "Preview auto-fixes without applying", false)
  .option(
    "--full",
    "Generate detailed educational report (prefl-report.md)",
    false
  )
  .action(
    async (opts: {
      staged?: boolean;
      all?: boolean;
      format?: "pretty" | "json";
      output?: string;
      autoFix?: boolean;
      dryRun?: boolean;
      full?: boolean;
    }) => {
      await runAnalyze({
        mode: opts?.all ? "all" : "staged",
        format: (opts?.format as "pretty" | "json") ?? "pretty",
        outputFile: opts?.output || undefined,
        autoFix: Boolean(opts?.autoFix),
        dryRun: Boolean(opts?.dryRun),
        full: Boolean(opts?.full),
      });
    }
  );

program
  .command("install-hook")
  .description("Install a pre-commit git hook to run analyzer")
  .option("--force", "Overwrite existing hook", false)
  .action(async (opts: { force?: boolean }) => {
    await installHook(Boolean(opts?.force));
  });

program
  .command("fix")
  .description("Generate an AI-suggested patch for the current changes")
  .option("--staged", "Use staged changes as input", true)
  .option("--all", "Use entire repository as input", false)
  .option("--apply", "Apply the patch via git apply", false)
  .option("--dry-run", "Run git apply --check to validate patch", false)
  .option("--format <fmt>", "Output format: diff|json", "diff")
  .action(
    async (opts: {
      staged?: boolean;
      all?: boolean;
      apply?: boolean;
      dryRun?: boolean;
      format?: "diff" | "json";
    }) => {
      await runFix({
        mode: opts?.all ? "all" : "staged",
        apply: Boolean(opts?.apply),
        dryRun: Boolean(opts?.dryRun),
        format: (opts?.format as any) ?? "diff",
      });
    }
  );

program.parseAsync(process.argv);
