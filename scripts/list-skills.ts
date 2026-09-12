#!/usr/bin/env -S deno run --allow-read --allow-run=sort

import { fileURLToPath } from "node:url";
import { join } from "node:path";

/** Enumerate like find: include every entry type, but never follow symlinks. */
export async function findSkills(
  root: string,
  reportError: (path: string, error: unknown) => void,
): Promise<string[]> {
  const matches: string[] = [];
  async function visit(directory: string, relative: string): Promise<void> {
    try {
      for await (const entry of Deno.readDir(directory)) {
        const path = relative ? `${relative}/${entry.name}` : entry.name;
        if (
          entry.name === "SKILL.md" &&
          !path.split("/").slice(0, -1).includes("node_modules")
        ) {
          matches.push(path);
        }
        // find filters node_modules results; it still visits those directories.
        if (entry.isDirectory && !entry.isSymlink) {
          await visit(join(directory, entry.name), path);
        }
      }
    } catch (error) {
      reportError(relative ? `./${relative}` : ".", error);
    }
  }
  await visit(root, "");
  return matches;
}

export async function main(): Promise<number> {
  const root = fileURLToPath(new URL("../", import.meta.url));
  let failed = false;
  const matches = await findSkills(root, (path, error) => {
    failed = true;
    console.error(
      `find: '${path}': ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  });
  // Keep the original sort utility's inherited locale and line handling.
  // A POSIX-compatible sort must be on PATH, including on Windows.
  const child = new Deno.Command("sort", {
    cwd: root,
    stdin: "piped",
    stdout: "inherit",
    stderr: "inherit",
  }).spawn();
  const writer = child.stdin.getWriter();
  try {
    if (matches.length) {
      // sed operates on lines, including embedded newlines in file names.
      const input = matches.map((path) => `./${path}\n`).join("").replace(
        /^\.\//gm,
        "",
      );
      await writer.write(new TextEncoder().encode(input));
    }
    await writer.close();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    failed = true;
  } finally {
    writer.releaseLock();
  }
  const status = await child.status;
  return status.code || (failed ? 1 : 0);
}

if (import.meta.main) {
  try {
    Deno.exit(await main());
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    Deno.exit(1);
  }
}
