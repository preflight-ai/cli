import fs from "fs";
import path from "path";
import chalk from "chalk";
import fg from "fast-glob";
import prompts from "prompts";
import ora from "ora";
import { getStagedFiles, getDiffForFiles } from "./git";
import { analyzeWithGroq, ReviewIssue } from "./groq";
import { applyAutoFixes, printAutoFixSummary, canAutoFix } from "./autofix";
import { pickContextFiles, expandContextByImports } from "./contextResolver";

type AnalyzeOptions = {
  mode: "staged" | "all";
  format: "pretty" | "json";
  outputFile?: string;
  autoFix?: boolean;
  dryRun?: boolean;
  full?: boolean;
};

type PreflConfig = {
  ignore?: { globs?: string[]; languages?: string[] };
  model?: string;
  review?: {
    blockSeverities?: Array<"critical" | "warning" | "info">;
    showSeverities?: Array<"critical" | "warning" | "info">;
    context?: { baseLimit?: number; importExpansionLimit?: number };
  };
};

function readConfig(): PreflConfig {
  const cfgPath = path.join(process.cwd(), "prefl.json");
  if (!fs.existsSync(cfgPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(cfgPath, "utf8")) as PreflConfig;
  } catch {
    return {};
  }
}

export async function runAnalyze(options: AnalyzeOptions): Promise<void> {
  const cfg = readConfig();
  const model =
    cfg.model || process.env.PREFL_MODEL || "moonshotai/kimi-k2-instruct-0905";

  const spinner = ora({
    text: "🔍 Collecting files...",
    color: "cyan",
  }).start();

  const scanFullProject = options.full;

  const files = scanFullProject
    ? listAllProjectFiles(cfg.ignore?.globs ?? [])
    : options.mode === "staged"
    ? await getStagedFiles()
    : listAllProjectFiles(cfg.ignore?.globs ?? []);

  const filtered = applyIgnore(files, cfg.ignore?.globs ?? []);

  if (filtered.length === 0) {
    spinner.fail(chalk.yellow("No files to analyze."));
    return;
  }

  spinner.text = scanFullProject
    ? `📁 Scanning ${filtered.length} files in entire project...`
    : `📁 Found ${filtered.length} file(s) - Building diff...`;

  const diff = scanFullProject
    ? buildSyntheticDiff(filtered)
    : options.mode === "staged"
    ? await getDiffForFiles(filtered)
    : buildSyntheticDiff(filtered);

  spinner.text = "🔗 Expanding context (imports & dependencies)...";

  const baseLimit = cfg.review?.context?.baseLimit ?? 10;
  const importExpansionLimit = cfg.review?.context?.importExpansionLimit ?? 20;
  const baseContext = pickContextFiles(filtered, baseLimit);
  const expanded = expandContextByImports(baseContext, importExpansionLimit);
  const contextFiles = expanded;

  spinner.text = `🤖 Analyzing with AI (${contextFiles.length} context files)...`;

  const issues = await analyzeWithGroq({ diff, contextFiles, model });

  const showSeverities = cfg.review?.showSeverities ?? ["critical", "warning"];
  const filteredIssues = issues.filter((i) =>
    showSeverities.includes(i.severity || "warning")
  );

  spinner.succeed(
    chalk.green(`✨ Analysis complete! Found ${filteredIssues.length} issue(s)`)
  );

  outputIssues(filteredIssues, options.format);

  if (options.outputFile) {
    const outFile = options.outputFile || "prefl-output.txt";
    const outPath = path.join(process.cwd(), outFile);
    const content = formatIssuesForFile(filteredIssues, filtered.length);
    fs.writeFileSync(outPath, content, "utf8");
    console.log(chalk.green(`\n💾 Report saved to ${outFile}`));
  }

  if (options.full) {
    const reportPath = path.join(process.cwd(), "prefl-report.md");
    const content = formatFullReport(filteredIssues, filtered.length);
    fs.writeFileSync(reportPath, content, "utf8");
    console.log(
      chalk.green(`\n📄 Full project report saved to prefl-report.md`)
    );
  }
  if (options.autoFix || options.dryRun) {
    const fixableIssues = filteredIssues.filter(canAutoFix);
    if (fixableIssues.length > 0) {
      console.log(
        chalk.bold.cyan(
          `\n🔧 Found ${fixableIssues.length} auto-fixable issue(s)\n`
        )
      );

      let shouldApply = options.autoFix;
      if (options.autoFix && !options.dryRun) {
        const response = await prompts({
          type: "confirm",
          name: "confirm",
          message: `Apply ${fixableIssues.length} auto-fix(es)? (backup will be created)`,
          initial: true,
        });
        shouldApply = response.confirm;
      }

      if (shouldApply || options.dryRun) {
        const results = await applyAutoFixes(fixableIssues, {
          dryRun: options.dryRun || !shouldApply,
          backup: true,
        });
        printAutoFixSummary(results);

        if (options.dryRun) {
          console.log(
            chalk.yellow(
              "💡 Dry run complete. Use --auto-fix to apply changes.\n"
            )
          );
        }
      }
    } else {
      console.log(chalk.yellow("\n⚠️  No auto-fixable issues found.\n"));
    }
  }

  const blockers = new Set(cfg.review?.blockSeverities ?? ["critical"]);
  if (issues.some((i) => i.severity && blockers.has(i.severity))) {
    process.exitCode = 1;
  }
}

function applyIgnore(files: string[], globs: string[]): string[] {
  const normalized = files.map((f) => f.replace(/^\.\//, ""));
  const defaults = ["node_modules/**", ".git/**", "dist/**"];
  const patterns = [
    ...defaults,
    ...(globs || []).map((g) =>
      g.endsWith("/**") || g.includes("*") ? g : `${g}`
    ),
  ];
  const matches = new Set<string>(
    fg.sync(patterns, {
      dot: true,
      onlyFiles: false,
      cwd: process.cwd(),
      markDirectories: true,
    })
  );
  return normalized.filter((f) => !matches.has(f) && !matches.has(`${f}/`));
}

function listAllProjectFiles(_globs: string[]): string[] {
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
      const lines = content.split("\n");
      for (const line of lines) {
        out += `+${line}\n`;
      }
    } catch {}
  }
  return out;
}

function outputIssues(issues: ReviewIssue[], format: "pretty" | "json") {
  if (format === "json") {
    console.log(JSON.stringify(issues, null, 2));
    return;
  }
  if (issues.length === 0) {
    console.log(chalk.green("✨ No issues found! Your code looks great! ✨"));
    return;
  }

  const critical = issues.filter((i) => i.severity === "critical");
  const warnings = issues.filter((i) => i.severity === "warning");
  const info = issues.filter((i) => i.severity === "info");

  console.log(chalk.bold("\n📊 Code Review Results\n"));
  console.log(
    chalk.red(`🚨 Critical: ${critical.length}`) +
      chalk.gray(" | ") +
      chalk.yellow(`⚠️  Warnings: ${warnings.length}`) +
      chalk.gray(" | ") +
      chalk.blue(`ℹ️  Info: ${info.length}`)
  );
  console.log(chalk.gray("─".repeat(60)) + "\n");

  // Output critical first
  if (critical.length > 0) {
    console.log(chalk.red.bold("🚨 CRITICAL ISSUES (Must Fix)\n"));
    critical.forEach((issue, idx) => {
      console.log(chalk.red.bold(`${idx + 1}.`));
      console.log(
        chalk.gray(
          `   File:  ${issue.file}${issue.line ? `:${issue.line}` : ""}`
        )
      );
      console.log(chalk.red(`   Issue: ${issue.problem}`));
      console.log(chalk.green(`   Fix:   ${issue.fix}`));
      if (issue.snippet) {
        console.log(
          chalk.dim(
            `   Code:  ${issue.snippet.substring(0, 100)}${
              issue.snippet.length > 100 ? "..." : ""
            }`
          )
        );
      }
      console.log("");
    });
  }

  if (warnings.length > 0) {
    console.log(chalk.yellow.bold("⚠️  WARNINGS (Recommended Fixes)\n"));
    warnings.forEach((issue, idx) => {
      console.log(chalk.yellow.bold(`${idx + 1}.`));
      console.log(
        chalk.gray(
          `   File:  ${issue.file}${issue.line ? `:${issue.line}` : ""}`
        )
      );
      console.log(chalk.yellow(`   Issue: ${issue.problem}`));
      console.log(chalk.cyan(`   Fix:   ${issue.fix}`));
      if (issue.snippet) {
        console.log(
          chalk.dim(
            `   Code:  ${issue.snippet.substring(0, 100)}${
              issue.snippet.length > 100 ? "..." : ""
            }`
          )
        );
      }
      console.log("");
    });
  }

  if (info.length > 0) {
    console.log(chalk.blue.bold("ℹ️  SUGGESTIONS (Nice to Have)\n"));
    info.forEach((issue, idx) => {
      console.log(chalk.blue.bold(`${idx + 1}.`));
      console.log(
        chalk.gray(
          `   File:  ${issue.file}${issue.line ? `:${issue.line}` : ""}`
        )
      );
      console.log(chalk.blue(`   Issue: ${issue.problem}`));
      console.log(chalk.cyan(`   Fix:   ${issue.fix}`));
      if (issue.snippet) {
        console.log(
          chalk.dim(
            `   Code:  ${issue.snippet.substring(0, 100)}${
              issue.snippet.length > 100 ? "..." : ""
            }`
          )
        );
      }
      console.log("");
    });
  }

  console.log(chalk.gray("─".repeat(60)));
  if (critical.length > 0) {
    console.log(
      chalk.red.bold(
        "\n🛑 Commit blocked due to critical issues. Please fix them first.\n"
      )
    );
  } else {
    console.log(
      chalk.green("\n✅ No critical issues. You're good to commit!\n")
    );
  }
}

function getRepoName(): string | undefined {
  try {
    const gitDir = path.join(process.cwd(), ".git");
    if (!fs.existsSync(gitDir)) return undefined;
    return path.basename(process.cwd());
  } catch {
    return undefined;
  }
}

function formatIssuesForFile(
  issues: ReviewIssue[],
  totalFiles: number
): string {
  const lines: string[] = [];
  lines.push("═══════════════════════════════════════════════════");
  lines.push("         PREFL FULL PROJECT REPORT");
  lines.push(`         Generated: ${new Date().toLocaleString()}`);
  lines.push(`         Total Files Scanned: ${totalFiles}`);
  lines.push("═══════════════════════════════════════════════════\n");

  const critical = issues.filter((i) => i.severity === "critical");
  const warnings = issues.filter((i) => i.severity === "warning");
  const info = issues.filter((i) => i.severity === "info");

  lines.push(`SUMMARY:`);
  lines.push(`  🚨 Critical: ${critical.length}`);
  lines.push(`  ⚠️  Warnings: ${warnings.length}`);
  lines.push(`  ℹ️  Info: ${info.length}`);
  lines.push("");

  if (critical.length > 0) {
    lines.push("═══════════════════════════════════════════════════");
    lines.push("🚨 CRITICAL ISSUES (Must Fix Before Commit)");
    lines.push("═══════════════════════════════════════════════════\n");
    critical.forEach((issue, idx) => {
      lines.push(`${idx + 1}.`);
      lines.push(
        `   File:  ${issue.file}${issue.line ? `:${issue.line}` : ""}`
      );
      if (issue.snippet) {
        lines.push(`   Code:  ${issue.snippet}`);
      }
      lines.push(`   Issue: ${issue.problem}`);
      lines.push(`   Fix:   ${issue.fix}`);
      lines.push("");
    });
  }

  if (warnings.length > 0) {
    lines.push("═══════════════════════════════════════════════════");
    lines.push("⚠️  WARNINGS (Recommended Fixes)");
    lines.push("═══════════════════════════════════════════════════\n");
    warnings.forEach((issue, idx) => {
      lines.push(`${idx + 1}.`);
      lines.push(
        `   File:  ${issue.file}${issue.line ? `:${issue.line}` : ""}`
      );
      if (issue.snippet) {
        lines.push(`   Code:  ${issue.snippet}`);
      }
      lines.push(`   Issue: ${issue.problem}`);
      lines.push(`   Fix:   ${issue.fix}`);
      lines.push("");
    });
  }

  if (info.length > 0) {
    lines.push("═══════════════════════════════════════════════════");
    lines.push("ℹ️  SUGGESTIONS (Nice to Have)");
    lines.push("═══════════════════════════════════════════════════\n");
    info.forEach((issue, idx) => {
      lines.push(`${idx + 1}.`);
      lines.push(
        `   File:  ${issue.file}${issue.line ? `:${issue.line}` : ""}`
      );
      if (issue.snippet) {
        lines.push(`   Code:  ${issue.snippet}`);
      }
      lines.push(`   Issue: ${issue.problem}`);
      lines.push(`   Fix:   ${issue.fix}`);
      lines.push("");
    });
  }

  lines.push("═══════════════════════════════════════════════════");
  if (critical.length > 0) {
    lines.push("🛑 ACTION REQUIRED: Fix critical issues before committing");
  } else {
    lines.push("✅ No critical issues found. Ready to commit!");
  }
  lines.push("═══════════════════════════════════════════════════");

  return lines.join("\n");
}

function formatFullReport(issues: ReviewIssue[], totalFiles: number): string {
  const lines: string[] = [];
  const date = new Date().toLocaleString();

  lines.push("# 📚 Prefl - Full Project Analysis Report\n");
  lines.push(`**Generated:** ${date}`);
  lines.push(`**Files Scanned:** ${totalFiles}\n`);
  lines.push("---\n");

  const critical = issues.filter((i) => i.severity === "critical");
  const warnings = issues.filter((i) => i.severity === "warning");
  const info = issues.filter((i) => i.severity === "info");

  lines.push("## 📊 Overview\n");
  lines.push(`- 🚨 **Critical Issues:** ${critical.length}`);
  lines.push(`- ⚠️ **Warnings:** ${warnings.length}`);
  lines.push(`- ℹ️ **Recommendations:** ${info.length}\n`);
  lines.push("---\n");

  if (critical.length > 0) {
    lines.push("## 🚨 Critical Issues\n");
    lines.push("**These issues must be fixed before committing!**\n");
    critical.forEach((issue, idx) => {
      lines.push(`### ${idx + 1}. ${issue.problem}\n`);
      lines.push(
        `**📁 File:** \`${issue.file}\`${
          issue.line ? ` (line ${issue.line})` : ""
        }\n`
      );
      if (issue.snippet) {
        lines.push("**📝 Code:**");
        lines.push("```");
        lines.push(issue.snippet);
        lines.push("```\n");
      }
      lines.push("**✅ How to Fix:**");
      lines.push(issue.fix + "\n");
      lines.push("---\n");
    });
  }

  if (warnings.length > 0) {
    lines.push("## ⚠️ Warnings\n");
    lines.push("**Recommended to fix:**\n");
    warnings.forEach((issue, idx) => {
      lines.push(`### ${idx + 1}. ${issue.problem}\n`);
      lines.push(
        `**📁 File:** \`${issue.file}\`${
          issue.line ? ` (line ${issue.line})` : ""
        }\n`
      );
      if (issue.snippet) {
        lines.push("**📝 Code:**");
        lines.push("```");
        lines.push(issue.snippet);
        lines.push("```\n");
      }
      lines.push("**💡 Suggestion:**");
      lines.push(issue.fix + "\n");
      lines.push("---\n");
    });
  }

  if (info.length > 0) {
    lines.push("## ℹ️ Recommendations & Improvements\n");
    info.forEach((issue, idx) => {
      lines.push(`### ${idx + 1}. ${issue.problem}\n`);
      lines.push(`**📁 File:** \`${issue.file}\`\n`);
      lines.push("**💡 Suggestion:**");
      lines.push(issue.fix + "\n");
      lines.push("---\n");
    });
  }

  lines.push(
    "\n**Generated by [Prefl AI](https://prefl.run) - Your Dream Code Review Tool ✨**"
  );

  return lines.join("\n");
}
