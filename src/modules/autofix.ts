import fs from "fs";
import path from "path";
import chalk from "chalk";
import { ReviewIssue } from "./groq";

export type AutoFixResult = {
  file: string;
  fixesApplied: number;
  issues: ReviewIssue[];
};

// Safe patterns that can be auto-fixed without risk
const SAFE_AUTOFIX_PATTERNS: Record<string, (code: string) => string> = {
  // Replace var with const/let
  "var-to-const": (code: string) => {
    return code.replace(/\bvar\s+(\w+)/g, "const $1");
  },

  // Remove console.log statements
  "remove-console": (code: string) => {
    return code.replace(/console\.(log|debug|info)\([^)]*\);?\n?/g, "");
  },

  // Add missing semicolons (JavaScript)
  "add-semicolons": (code: string) => {
    return code.replace(/([^;\s])\n/g, "$1;\n");
  },

  // Fix double quotes to single quotes (if consistent in file)
  "quotes-single": (code: string) => {
    return code.replace(/"([^"\\]*(\\.[^"\\]*)*)"/g, "'$1'");
  },

  // Remove trailing whitespace
  "trim-whitespace": (code: string) => {
    return code.replace(/[ \t]+$/gm, "");
  },

  // Fix == to ===
  "strict-equality": (code: string) => {
    return code.replace(/([^=!])={2}([^=])/g, "$1===$2");
  },
};

export function canAutoFix(issue: ReviewIssue): boolean {
  const safePatterns = [
    /var\s+\w+/i,
    /console\.(log|debug|info)/i,
    /trailing\s+whitespace/i,
    /use\s+const\/let/i,
    /strict\s+equality/i,
    /missing\s+semicolon/i,
  ];

  const problem = issue.problem.toLowerCase();
  return safePatterns.some((pattern) => pattern.test(problem));
}

export async function applyAutoFixes(
  issues: ReviewIssue[],
  options: { dryRun?: boolean; backup?: boolean } = {}
): Promise<AutoFixResult[]> {
  const results: AutoFixResult[] = [];
  const fileIssues = groupByFile(issues);

  for (const [filePath, fileIssueList] of Object.entries(fileIssues)) {
    const autoFixableIssues = fileIssueList.filter(canAutoFix);
    if (autoFixableIssues.length === 0) continue;

    const fullPath = path.join(process.cwd(), filePath);
    if (!fs.existsSync(fullPath)) {
      console.warn(chalk.yellow(`⚠️  File not found: ${filePath}`));
      continue;
    }

    let content = fs.readFileSync(fullPath, "utf8");
    const originalContent = content;

    // Apply fixes
    let fixCount = 0;
    for (const issue of autoFixableIssues) {
      const fixed = applyIssueFix(content, issue);
      if (fixed !== content) {
        content = fixed;
        fixCount++;
      }
    }

    if (fixCount > 0) {
      if (options.backup) {
        const backupPath = fullPath + ".prefl-backup";
        fs.writeFileSync(backupPath, originalContent, "utf8");
      }

      if (!options.dryRun) {
        fs.writeFileSync(fullPath, content, "utf8");
      }

      results.push({
        file: filePath,
        fixesApplied: fixCount,
        issues: autoFixableIssues,
      });
    }
  }

  return results;
}

function applyIssueFix(content: string, issue: ReviewIssue): string {
  // If we have exact fixed code from AI
  if (issue.fixedCode && issue.snippet) {
    return content.replace(issue.snippet, issue.fixedCode);
  }

  // Pattern-based fixes
  const problem = issue.problem.toLowerCase();

  if (/var\s+/.test(problem)) {
    return SAFE_AUTOFIX_PATTERNS["var-to-const"](content);
  }

  if (/console\.(log|debug|info)/.test(problem)) {
    return SAFE_AUTOFIX_PATTERNS["remove-console"](content);
  }

  if (/trailing\s+whitespace/.test(problem)) {
    return SAFE_AUTOFIX_PATTERNS["trim-whitespace"](content);
  }

  if (/strict\s+equality|==\s+to\s+===/.test(problem)) {
    return SAFE_AUTOFIX_PATTERNS["strict-equality"](content);
  }

  return content;
}

function groupByFile(issues: ReviewIssue[]): Record<string, ReviewIssue[]> {
  const grouped: Record<string, ReviewIssue[]> = {};
  for (const issue of issues) {
    if (!grouped[issue.file]) {
      grouped[issue.file] = [];
    }
    grouped[issue.file].push(issue);
  }
  return grouped;
}

export function printAutoFixSummary(results: AutoFixResult[]): void {
  if (results.length === 0) {
    console.log(chalk.yellow("\n⚠️  No auto-fixable issues found.\n"));
    return;
  }

  console.log(chalk.bold.green("\n✨ Auto-Fix Results\n"));
  console.log(chalk.gray("─".repeat(60)));

  let totalFixes = 0;
  for (const result of results) {
    totalFixes += result.fixesApplied;
    console.log(
      chalk.green(`✅ ${result.file}`) +
        chalk.gray(` - ${result.fixesApplied} fix(es)`)
    );
    result.issues.forEach((issue, idx) => {
      console.log(
        chalk.gray(`   ${idx + 1}. `) +
          chalk.cyan(issue.problem.substring(0, 60))
      );
    });
  }

  console.log(chalk.gray("─".repeat(60)));
  console.log(
    chalk.bold.green(
      `\n🎉 Total: ${totalFixes} fixes applied across ${results.length} file(s)\n`
    )
  );
}

