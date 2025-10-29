import fs from "fs";
import path from "path";
import chalk from "chalk";

export async function installHook(force: boolean): Promise<void> {
  const gitDir = path.join(process.cwd(), ".git");
  const hooksDir = path.join(gitDir, "hooks");
  const hookPath = path.join(hooksDir, "pre-commit");

  if (!fs.existsSync(gitDir)) {
    console.log(
      chalk.red("Not a git repository. Init git before installing hook.")
    );
    return;
  }
  if (!fs.existsSync(hooksDir)) fs.mkdirSync(hooksDir, { recursive: true });
  if (fs.existsSync(hookPath) && !force) {
    console.log(
      chalk.yellow("pre-commit hook already exists. Use --force to overwrite.")
    );
    return;
  }
  const script = `#!/bin/sh
# Prefl AI pre-commit hook
set -e

# Prefer globally installed prefl; fallback to npx
if command -v prefl >/dev/null 2>&1; then
  prefl analyze --staged
else
  npx --yes prefl analyze --staged
fi
status=$?
if [ $status -ne 0 ]; then
  echo "\n🚫 Commit blocked: critical issues found by Prefl."
  exit $status
fi
`;
  fs.writeFileSync(hookPath, script, { mode: 0o755 });
  console.log(chalk.green("Installed pre-commit hook."));
}
