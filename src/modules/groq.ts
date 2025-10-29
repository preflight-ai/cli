import dotenv from "dotenv";
import ora from "ora";
import chalk from "chalk";
import crypto from "crypto";

dotenv.config();

export type ReviewIssue = {
  file: string;
  problem: string;
  fix: string;
  severity?: "critical" | "warning" | "info";
  line?: number;
  snippet?: string;
  autoFixable?: boolean;
  fixedCode?: string;
};

type AnalyzeInput = {
  diff: string;
  contextFiles: { path: string; content: string }[];
  model: string;
};

export async function analyzeWithGroq({
  diff,
  contextFiles,
  model,
}: AnalyzeInput): Promise<ReviewIssue[]> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("Missing GROQ_API_KEY in environment. Set it in .env");
  }

  const spinner = ora("Analyzing changes with Groq...").start();
  try {
    const systemPrompt = SYSTEM_PROMPT_TEMPLATE;
    const maxContextFiles = parseInt(
      process.env.PREFL_MAX_CONTEXT_FILES || "10",
      10
    );
    const maxContentSize = parseInt(
      process.env.PREFL_MAX_CONTENT_SIZE || "4000",
      10
    );
    const maxDiffSize = parseInt(
      process.env.PREFL_MAX_DIFF_SIZE || "120000",
      10
    );

    const contextSection = contextFiles
      .slice(0, maxContextFiles)
      .map((f) => `FILE: ${f.path}\n${truncate(f.content, maxContentSize)}`)
      .join("\n\n");
    const userPrompt = USER_PROMPT_TEMPLATE(
      truncate(diff, maxDiffSize),
      contextSection
    );

    const body = {
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.2,
    } as any;

    const response = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      }
    );

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      let errorMsg = `Groq API error (${response.status})`;

      if (response.status === 401) {
        errorMsg = "Invalid GROQ_API_KEY. Check your .env file";
      } else if (response.status === 429) {
        errorMsg = "Rate limit exceeded. Please try again later";
      } else if (response.status === 500) {
        errorMsg = "Groq server error. Service may be temporarily unavailable";
      } else if (text) {
        errorMsg += `: ${text.substring(0, 200)}`;
      }

      throw new Error(errorMsg);
    }
    const data = (await response.json()) as any;
    const content: string = data?.choices?.[0]?.message?.content ?? "[]";
    const issues = safeParseIssues(content);
    spinner.succeed(chalk.green("✨ Analysis completed"));
    return issues.length ? issues : heuristicScan(diff, contextFiles);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    spinner.fail(chalk.red(`Analysis failed: ${errorMsg}`));
    console.log(chalk.yellow("📋 Falling back to heuristic scan..."));
    return heuristicScan(diff, contextFiles);
  }
}

export async function generateFixDiff({
  diff,
  contextFiles,
  model,
}: AnalyzeInput): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("Missing GROQ_API_KEY in environment. Set it in .env");
  }
  const spinner = ora("Generating patch with Groq...").start();
  try {
    const systemPrompt = FIX_SYSTEM_PROMPT;
    const contextSection = contextFiles
      .slice(0, 5)
      .map((f) => `FILE: ${f.path}\n${truncate(f.content, 4000)}`)
      .join("\n\n");
    const userPrompt = FIX_USER_PROMPT(truncate(diff, 120000), contextSection);

    const body = {
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.2,
    } as any;

    const response = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      }
    );
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      let errorMsg = `Groq API error (${response.status})`;

      if (response.status === 401) {
        errorMsg = "Invalid GROQ_API_KEY. Check your .env file";
      } else if (response.status === 429) {
        errorMsg = "Rate limit exceeded. Please try again later";
      } else if (response.status === 500) {
        errorMsg = "Groq server error. Service may be temporarily unavailable";
      } else if (text) {
        errorMsg += `: ${text.substring(0, 200)}`;
      }

      throw new Error(errorMsg);
    }
    const data = (await response.json()) as any;
    const content: string = data?.choices?.[0]?.message?.content ?? "";
    const patch = extractCodeFence(content) || content;
    spinner.succeed("✨ Patch generated");
    return sanitizeUnifiedDiff(patch);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    spinner.fail(chalk.red(`Patch generation failed: ${errorMsg}`));
    throw err;
  }
}

const HEURISTIC_PATTERNS = {
  jsonParse: /JSON\.parse\(\s*[^)]+\s*\)\.\w+/,
  unhandledPromise: /\.\w+\(\)\.then\(/,
  catchHandler: /catch\(/,
  eval: /eval\(/,
  hardcodedSecret:
    /(password|secret|api[_-]?key|token)[\s]*=[\s]*['"][^'"]+['"]/i,
  innerHTML: /innerHTML[\s]*=/,
  sanitize: /DOMPurify|sanitize/,
  emptySrc: /<img[^>]+src\s*=\s*["']\s*["']/,
  emptyHref: /<a[^>]+href\s*=\s*["']\s*["']/,
  addEventListener: /addEventListener\(/,
  setInterval: /setInterval\(/,
  imgTag: /<img/,
  missingAlt: /<img[^>]+(?!alt=)/,
};

function heuristicScan(
  diff: string,
  _context: { path: string; content: string }[]
): ReviewIssue[] {
  const results: ReviewIssue[] = [];
  const lines = diff.split("\n");
  let currentFile = "";
  let lineNumber = 0;

  for (const line of lines) {
    if (line.startsWith("+++ b/")) {
      currentFile = line.replace("+++ b/", "").trim();
      lineNumber = 0;
      continue;
    }
    if (line.startsWith("@@")) {
      const match = line.match(/\+(\d+)/);
      if (match) lineNumber = parseInt(match[1], 10);
      continue;
    }
    if (line.startsWith("+") && !line.startsWith("+++")) {
      lineNumber++;
      const added = line.slice(1);

      if (
        added.includes("JSON.parse") &&
        HEURISTIC_PATTERNS.jsonParse.test(added)
      ) {
        results.push({
          file: currentFile,
          problem:
            "Unsafe JSON.parse - accessing properties without validation",
          fix: "Validate parsed data before accessing properties",
          severity: "critical",
          line: lineNumber,
          snippet: added.trim(),
        });
      }

      if (
        added.includes(".then(") &&
        HEURISTIC_PATTERNS.unhandledPromise.test(added) &&
        !HEURISTIC_PATTERNS.catchHandler.test(added)
      ) {
        results.push({
          file: currentFile,
          problem: "Unhandled promise rejection - missing .catch()",
          fix: "Add .catch() handler or use try/catch",
          severity: "critical",
          line: lineNumber,
          snippet: added.trim(),
        });
      }

      if (added.includes("eval") && HEURISTIC_PATTERNS.eval.test(added)) {
        results.push({
          file: currentFile,
          problem: "Security: eval() executes arbitrary code",
          fix: "Use JSON.parse() or safer alternatives",
          severity: "critical",
          line: lineNumber,
          snippet: added.trim(),
        });
      }

      if (
        (added.includes("password") ||
          added.includes("secret") ||
          added.includes("key") ||
          added.includes("token")) &&
        HEURISTIC_PATTERNS.hardcodedSecret.test(added)
      ) {
        results.push({
          file: currentFile,
          problem: "Security: Hardcoded secret detected",
          fix: "Move to environment variables (.env)",
          severity: "critical",
          line: lineNumber,
          snippet: added.trim(),
        });
      }

      if (
        added.includes("innerHTML") &&
        HEURISTIC_PATTERNS.innerHTML.test(added) &&
        !HEURISTIC_PATTERNS.sanitize.test(added)
      ) {
        results.push({
          file: currentFile,
          problem: "XSS vulnerability: innerHTML without sanitization",
          fix: "Use textContent or sanitize with DOMPurify",
          severity: "critical",
          line: lineNumber,
          snippet: added.trim(),
        });
      }

      if (
        added.includes("<img") &&
        added.includes('src=""') &&
        HEURISTIC_PATTERNS.emptySrc.test(added)
      ) {
        results.push({
          file: currentFile,
          problem: "Empty img src causes 404 errors",
          fix: "Provide valid src or remove tag",
          severity: "critical",
          line: lineNumber,
          snippet: added.trim(),
        });
      }

      if (
        added.includes("<a") &&
        added.includes('href=""') &&
        HEURISTIC_PATTERNS.emptyHref.test(added)
      ) {
        results.push({
          file: currentFile,
          problem: "Empty href causes page reload",
          fix: "Use valid href or replace with button",
          severity: "critical",
          line: lineNumber,
          snippet: added.trim(),
        });
      }

      if (
        added.includes("addEventListener") &&
        HEURISTIC_PATTERNS.addEventListener.test(added)
      ) {
        results.push({
          file: currentFile,
          problem: "Memory leak: addEventListener without cleanup",
          fix: "Remove listener in cleanup function",
          severity: "warning",
          line: lineNumber,
          snippet: added.trim(),
        });
      }

      if (
        added.includes("setInterval") &&
        HEURISTIC_PATTERNS.setInterval.test(added)
      ) {
        results.push({
          file: currentFile,
          problem: "Memory leak: setInterval without clearInterval",
          fix: "Call clearInterval in cleanup",
          severity: "warning",
          line: lineNumber,
          snippet: added.trim(),
        });
      }

      if (
        added.includes("<img") &&
        HEURISTIC_PATTERNS.imgTag.test(added) &&
        HEURISTIC_PATTERNS.missingAlt.test(added)
      ) {
        results.push({
          file: currentFile,
          problem: "Accessibility: Missing alt attribute",
          fix: "Add alt text for screen readers",
          severity: "warning",
          line: lineNumber,
          snippet: added.trim(),
        });
      }
    }
  }

  return results;
}

function safeParseIssues(text: string): ReviewIssue[] {
  try {
    // Try direct JSON parse
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return normalizeIssues(parsed);
  } catch {}
  // Try to extract JSON block
  const match = text.match(/\[([\s\S]*?)\]/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]);
      if (Array.isArray(parsed)) return normalizeIssues(parsed);
    } catch {}
  }
  return [];
}

function normalizeIssues(arr: any[]): ReviewIssue[] {
  return arr
    .map((it) => ({
      file: String(it.file ?? ""),
      problem: String(it.problem ?? ""),
      fix: String(it.fix ?? ""),
      severity: (it.severity as any) ?? "warning",
    }))
    .filter((it) => it.file && it.problem && it.fix);
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + "\n...<truncated>";
}

function extractCodeFence(text: string): string | undefined {
  const codeBlock = text.match(
    /```diff[\s\S]*?```|```patch[\s\S]*?```|```[\s\S]*?```/
  );
  if (!codeBlock) return undefined;
  const raw = codeBlock[0]
    .replace(/^```(?:diff|patch)?\n?/, "")
    .replace(/```\s*$/, "");
  return raw.trim();
}

function sanitizeUnifiedDiff(patch: string): string {
  // Ensure it looks like a unified diff with at least one diff header
  if (/^diff --git /m.test(patch) || /^\+\+\+\s|^---\s/m.test(patch)) {
    return patch.trim() + "\n";
  }
  // If not, wrap it minimally so git apply can attempt
  return patch.trim() + "\n";
}

const SYSTEM_PROMPT_TEMPLATE = `You are an expert senior code reviewer with deep knowledge of security, performance, accessibility, and best practices across all programming languages.

Your mission: Detect REAL problems that could cause runtime failures, security vulnerabilities, memory leaks, performance bottlenecks, or critical bugs.

CRITICAL ISSUES (severity: "critical") - Block commits:
- Runtime errors: null/undefined access, type mismatches, uncaught exceptions, promise rejections
- Security vulnerabilities: SQL injection, XSS, CSRF, exposed secrets, insecure dependencies, improper auth
- Memory leaks: event listeners not cleaned up, circular references, large object retention
- Data loss risks: missing validation, race conditions, improper async handling
- Breaking API changes without migrations
- Empty or invalid HTML attributes causing errors (e.g., <img src="">, <a href="">)
- Resource loading failures that cause HTTP errors or performance degradation

WARNING ISSUES (severity: "warning") - Alert but allow:
- Accessibility violations: missing alt text on images, missing ARIA labels, keyboard navigation problems, contrast issues
- Performance issues: N+1 queries, unnecessary re-renders, blocking operations in main thread
- Missing edge case handling: empty arrays, null inputs, boundary conditions that could cause issues

DO NOT REPORT AS ISSUES:
- SEO recommendations (page titles, meta tags, descriptions)
- Marketing or content suggestions
- Code style preferences (console.log, var vs const, spacing, naming conventions)
- TypeScript 'any' types or missing types
- Optimization suggestions that don't cause real performance problems
- Documentation or comments
- Best practices that don't affect functionality or accessibility

Return a JSON array. Each issue must have:
{
  "file": "relative/path/to/file.ext",
  "problem": "Clear description of the issue and why it matters",
  "fix": "Specific, actionable solution with code example if helpful",
  "severity": "critical" | "warning" | "info",
  "line": 123,
  "snippet": "code snippet showing the problem"
}

Focus ONLY on REAL functional, security, performance, and accessibility issues. NO SEO or marketing suggestions.`;

function USER_PROMPT_TEMPLATE(diff: string, contextSection: string): string {
  return `DIFF:\n${diff}\n\nCONTEXT (optional files):\n${contextSection}\n\nRespond ONLY with JSON array: [{"file":"path","problem":"...","fix":"...","severity":"critical|warning|info","line":123,"snippet":"..."}]`;
}

export function getPromptHash(): string {
  const signature = `SYSTEM:\n${SYSTEM_PROMPT_TEMPLATE}\nUSER_TEMPLATE_V1`;
  return crypto.createHash("sha256").update(signature).digest("hex");
}

const FIX_SYSTEM_PROMPT = `You generate minimal, correct patches as unified diffs (git-style).
Return ONLY a unified diff suitable for 'git apply'. Do not add commentary.`;

function FIX_USER_PROMPT(diff: string, context: string): string {
  return `Given this diff (staged or synthetic) and optional context files, produce a unified diff that fixes the issues you detect.
DIFF:\n${diff}\n\nCONTEXT:\n${context}\n\nOutput ONLY unified diff.`;
}

export function getFixPromptHash(): string {
  const signature = `SYSTEM_FIX:\n${FIX_SYSTEM_PROMPT}\nUSER_TEMPLATE_FIX_V1`;
  return crypto.createHash("sha256").update(signature).digest("hex");
}
