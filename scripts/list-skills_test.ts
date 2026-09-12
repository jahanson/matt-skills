import { deepStrictEqual } from "node:assert/strict";
import { join } from "node:path";
import { findSkills } from "./list-skills.ts";

Deno.test("findSkills includes hidden paths and directory matches but filters node_modules descendants", async () => {
  const root = await Deno.makeTempDir();
  try {
    for (
      const directory of [
        ".hidden",
        "space ü",
        "node_modules/pkg",
        "nested/node_modules/pkg",
        "SKILL.md",
      ]
    ) {
      await Deno.mkdir(join(root, directory), { recursive: true });
      await Deno.writeTextFile(join(root, directory, "SKILL.md"), "");
    }
    await Deno.writeTextFile(join(root, ".hidden/skill.md"), "");
    const errors: unknown[] = [];
    const matches = await findSkills(
      root,
      (_path, error) => errors.push(error),
    );
    deepStrictEqual(errors, []);
    deepStrictEqual(matches.sort(), [
      ".hidden/SKILL.md",
      "SKILL.md",
      "SKILL.md/SKILL.md",
      "space ü/SKILL.md",
    ]);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("findSkills reports failed traversal and succeeds for an empty directory", async () => {
  const root = await Deno.makeTempDir();
  try {
    const errors: string[] = [];
    deepStrictEqual(
      await findSkills(join(root, "missing"), (path) => errors.push(path)),
      [],
    );
    deepStrictEqual(errors, ["."]);
    deepStrictEqual(
      await findSkills(root, () => {
        throw new Error("unexpected traversal error");
      }),
      [],
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("findSkills includes named symlinks without following directory links", async () => {
  const root = await Deno.makeTempDir();
  try {
    await Deno.mkdir(join(root, "target"));
    await Deno.writeTextFile(join(root, "target/SKILL.md"), "");
    await Deno.symlink(join(root, "target"), join(root, "link"), {
      type: "dir",
    });
    await Deno.symlink(join(root, "target"), join(root, "SKILL.md"), {
      type: "dir",
    });
    const errors: unknown[] = [];
    deepStrictEqual(
      (await findSkills(root, (_path, error) => errors.push(error))).sort(),
      ["SKILL.md", "target/SKILL.md"],
    );
    deepStrictEqual(errors, []);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
