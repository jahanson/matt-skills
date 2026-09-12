import { join } from "node:path";
import { linkSkills } from "./link-skills.ts";

Deno.test("links selected skills in both destinations and replaces conflicts on rerun", async () => {
  const fixture = await Deno.makeTempDir();
  try {
    const repo = join(fixture, "repo");
    const home = join(fixture, "home");
    for (
      const bucket of [
        "engineering",
        "in-progress",
        "misc",
        "deprecated",
        "node_modules",
      ]
    ) {
      const skill = join(repo, "skills", bucket, bucket + "-skill");
      await Deno.mkdir(skill, { recursive: true });
      await Deno.writeTextFile(join(skill, "SKILL.md"), "fixture");
    }
    const conflict = join(home, ".claude", "skills", "engineering-skill");
    await Deno.mkdir(conflict, { recursive: true });
    await Deno.writeTextFile(join(conflict, "old.txt"), "old");
    const messages: string[] = [];
    for (let run = 0; run < 2; run++) {
      if (
        await linkSkills(repo, home, (message) => messages.push(message)) !== 0
      ) {
        throw new Error("Expected successful linking");
      }
      for (const harness of [".claude", ".agents"]) {
        const dest = join(home, harness, "skills");
        const names: string[] = [];
        for await (const entry of Deno.readDir(dest)) names.push(entry.name);
        if (names.sort().join(",") !== "engineering-skill,in-progress-skill") {
          throw new Error(`Unexpected links: ${names}`);
        }
        for (const bucket of ["engineering", "in-progress"]) {
          const target = join(dest, bucket + "-skill");
          if (!(await Deno.lstat(target)).isSymlink) {
            throw new Error("Expected symlink");
          }
          if (
            await Deno.realPath(target) !==
              await Deno.realPath(
                join(repo, "skills", bucket, bucket + "-skill"),
              )
          ) {
            throw new Error("Wrong symlink source");
          }
        }
      }
    }
    if (messages.length !== 8) {
      throw new Error("Expected one output line per linked skill");
    }
    await Deno.remove(join(home, ".claude", "skills"), { recursive: true });
    await Deno.symlink(join(repo, "skills"), join(home, ".claude", "skills"), {
      type: "dir",
    });
    const errors: string[] = [];
    if (
      await linkSkills(repo, home, () => {
        throw new Error("Must not link through repo alias");
      }, (message) => errors.push(message)) !== 1
    ) {
      throw new Error("Expected alias guard failure");
    }
    if (errors.length !== 2) {
      throw new Error("Expected guard diagnostic and recovery instruction");
    }
  } finally {
    await Deno.remove(fixture, { recursive: true });
  }
});
