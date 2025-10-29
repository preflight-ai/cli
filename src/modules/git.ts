import { execa } from "execa";

export async function getStagedFiles(): Promise<string[]> {
  const { stdout } = await execa("git", ["diff", "--cached", "--name-only"]);
  return stdout.split("\n").filter(Boolean);
}

export async function getDiffForFiles(files: string[]): Promise<string> {
  if (files.length === 0) return "";
  const { stdout } = await execa("git", [
    "diff",
    "--cached",
    "--unified=3",
    "--",
    ...files,
  ]);
  return stdout;
}


