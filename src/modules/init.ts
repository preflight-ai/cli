import fs from "fs";
import path from "path";
import prompts from "prompts";
import chalk from "chalk";
import { installHook } from "./hook";

const PREFL_CONFIG = "prefl.json";
const ENV_FILE = ".env";

type PreflConfig = {
  ignore?: {
    globs?: string[];
    languages?: string[];
  };
  model?: string;
  review?: {
    blockSeverities?: Array<"critical" | "warning" | "info">;
    showSeverities?: Array<"critical" | "warning" | "info">;
    context?: { baseLimit?: number; importExpansionLimit?: number };
  };
};

export async function runInit(force: boolean): Promise<void> {
  const cwd = process.cwd();
  const configPath = path.join(cwd, PREFL_CONFIG);
  const envPath = path.join(cwd, ENV_FILE);
  const gitignorePath = path.join(cwd, ".gitignore");

  const responses = await prompts([
    {
      type: "text",
      name: "apiKey",
      message: "Enter your Groq API key (or leave blank to set later):",
    },
  ]);

  if (fs.existsSync(configPath) && !force) {
    console.log(
      chalk.yellow(`Found existing ${PREFL_CONFIG}. Use --force to overwrite.`)
    );
  } else {
    const defaultConfig: PreflConfig = {
      ignore: {
        globs: ["node_modules/**", "dist/**", ".git/**"],
        languages: [],
      },
      review: {
        blockSeverities: ["critical"],
        showSeverities: ["critical", "warning"],
        context: { baseLimit: 10, importExpansionLimit: 20 },
      },
    };
    fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2));
    console.log(chalk.green(`Created ${PREFL_CONFIG}`));
  }

  // Create .env if missing
  if (!fs.existsSync(envPath)) {
    fs.writeFileSync(
      envPath,
      "GROQ_API_KEY=" + (responses.apiKey ?? "") + "\n"
    );
    console.log(chalk.green("Created .env"));
  }

  // Ensure .env is gitignored
  let gitignore = "";
  if (fs.existsSync(gitignorePath)) {
    gitignore = fs.readFileSync(gitignorePath, "utf8");
  }
  if (!gitignore.split(/\r?\n/).some((l) => l.trim() === ".env")) {
    fs.appendFileSync(
      gitignorePath,
      (gitignore.endsWith("\n") || gitignore === "" ? "" : "\n") + ".env\n"
    );
    console.log(chalk.green("Updated .gitignore with .env"));
  }

  console.log(
    chalk.cyan(
      "Prefl initialized. You can run `prefl analyze --staged` to analyze staged changes."
    )
  );

  // Attempt to install pre-commit hook automatically (non-destructive unless --force used)
  try {
    await installHook(false);
  } catch {}
}
