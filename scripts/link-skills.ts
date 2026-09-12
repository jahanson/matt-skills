#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env=HOME,USERPROFILE
import { basename, dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";

// Dev-only maintainer utility, not a supported installer.
// Links skills into both harness directories so git pull updates their contents.

async function lstatIfPresent(
  path: string,
): Promise<Deno.FileInfo | undefined> {
  try {
    return await Deno.lstat(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return undefined;
    throw error;
  }
}

/** Link repository skills without changing the caller's working directory. */
export async function linkSkills(
  repo: string,
  home: string,
  log: (message: string) => void = console.log,
  errorLog: (message: string) => void = console.error,
): Promise<number> {
  const sources: string[] = [];
  async function collect(path: string): Promise<void> {
    try {
      for await (const entry of Deno.readDir(path)) {
        const child = join(path, entry.name);
        // Match find's full-path filters, including directory and link matches.
        const excluded = /[\\/](node_modules|deprecated|misc)[\\/]/.test(child);
        if (entry.name === "SKILL.md" && !excluded) {
          sources.push(dirname(child));
        }
        if (entry.isDirectory) await collect(child);
      }
    } catch (error) {
      // The original find runs in process substitution: discovery errors do not
      // abort linking the entries it was able to discover.
      errorLog(
        `find: ${path}: ${error instanceof Error ? error.message : error}`,
      );
    }
  }
  await collect(join(repo, "skills"));

  for (
    const dest of [
      join(home, ".claude", "skills"),
      join(home, ".agents", "skills"),
    ]
  ) {
    if ((await lstatIfPresent(dest))?.isSymlink) {
      const resolved = await Deno.realPath(dest);
      if (resolved === repo || resolved.startsWith(repo + sep)) {
        errorLog(`error: ${dest} is a symlink into this repo (${resolved}).`);
        errorLog(
          `Remove it (rm "${dest}") and re-run; the script will recreate it as a real dir.`,
        );
        return 1;
      }
    }
    await Deno.mkdir(dest, { recursive: true });
    for (const src of sources) {
      const name = basename(src);
      const target = join(dest, name);
      const existing = await lstatIfPresent(target);
      if (existing) {
        // Unlink symlinks themselves, including dangling links. Ordinary
        // conflicting directories are recursively replaced, as in the shell.
        await Deno.remove(target, { recursive: !existing.isSymlink });
      }
      try {
        await Deno.symlink(src, target, { type: "dir" });
      } catch (error) {
        if (
          Deno.build.os === "windows" &&
          error instanceof Deno.errors.PermissionDenied
        ) {
          throw new Error(
            `Cannot create directory symlink ${target}; enable Windows Developer Mode or run with symlink privileges.`,
            { cause: error },
          );
        }
        throw error;
      }
      log(`linked ${name} -> ${src} (${dest})`);
    }
  }
  return 0;
}

export async function main(): Promise<number> {
  try {
    const home = Deno.env.get("HOME") ??
      (Deno.build.os === "windows" ? Deno.env.get("USERPROFILE") : undefined);
    if (home === undefined) throw new Error("HOME: unbound variable");
    const repo = await Deno.realPath(
      join(dirname(fileURLToPath(import.meta.url)), ".."),
    );
    return await linkSkills(repo, home);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

if (import.meta.main) Deno.exit(await main());
