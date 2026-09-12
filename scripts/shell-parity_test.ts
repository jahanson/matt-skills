import { deepStrictEqual, strictEqual } from "node:assert";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Differential tests run on Linux, where Bash and native directory symlinks
// provide the reference behavior. All writes and external commands use fixtures.
const root = fileURLToPath(new URL("../", import.meta.url));
const linux = Deno.build.os === "linux";
const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function run(
  command: string,
  args: string[],
  cwd: string,
  input = "",
  env: Record<string, string> = {},
) {
  const child = new Deno.Command(command, {
    args,
    cwd,
    env: { LC_ALL: "C", NO_COLOR: "1", ...env },
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const output = child.output();
  try {
    const writer = child.stdin.getWriter();
    await writer.write(encoder.encode(input));
    await writer.close();
  } catch (error) {
    if (!(error instanceof Deno.errors.BrokenPipe)) throw error;
  }
  const result = await output;
  return {
    code: result.code,
    stdout: decoder.decode(result.stdout),
    stderr: decoder.decode(result.stderr),
  };
}

function denoArgs(path: string) {
  return [
    "run",
    "--quiet",
    "--no-config",
    "--no-lock",
    "--node-modules-dir=none",
    "--allow-read",
    "--allow-write",
    "--allow-env",
    "--allow-run",
    path,
    "ignored argument",
  ];
}

async function withFixture(fn: (path: string) => Promise<void>) {
  const path = await Deno.makeTempDir({ prefix: "shell-parity-" });
  try {
    await fn(path);
  } finally {
    await Deno.remove(path, { recursive: true });
  }
}

async function copyPair(fixture: string, relative: string) {
  for (const extension of [".sh", ".ts"]) {
    const target = join(fixture, relative + extension);
    await Deno.mkdir(join(target, ".."), { recursive: true });
    await Deno.copyFile(join(root, relative + extension), target);
  }
}

async function write(path: string, content = "fixture") {
  await Deno.mkdir(join(path, ".."), { recursive: true });
  await Deno.writeTextFile(path, content);
}

Deno.test({
  name: "shell parity: listing preserves filtering, locale order and symlinks",
  ignore: !linux,
  fn: () =>
    withFixture(async (fixture) => {
      await copyPair(fixture, "scripts/list-skills");
      for (
        const path of [
          "skills/engineering/zeta/SKILL.md",
          "skills/engineering/Alpha/SKILL.md",
          "skills/engineering/space name/SKILL.md",
          "skills/engineering/café/SKILL.md",
          "skills/misc/hidden/.inside/SKILL.md",
          "skills/deprecated/old/SKILL.md",
          ".hidden/SKILL.md",
          "node_modules/ignored/SKILL.md",
          "skills/engineering/low/skill.md",
        ]
      ) await write(join(fixture, path));
      await Deno.mkdir(join(fixture, "directory/SKILL.md"), {
        recursive: true,
      });
      await Deno.symlink(
        join(fixture, "skills/engineering/zeta"),
        join(fixture, "alias"),
      );
      await Deno.symlink(
        "missing",
        join(fixture, "skills/engineering/SKILL.md"),
      );
      for (const locale of ["C", "C.UTF-8"]) {
        const env = { LC_ALL: locale };
        const shell = await run(
          "bash",
          [join(fixture, "scripts/list-skills.sh"), "ignored argument"],
          "/",
          "",
          env,
        );
        const deno = await run(
          Deno.execPath(),
          denoArgs(join(fixture, "scripts/list-skills.ts")),
          "/",
          "",
          env,
        );
        deepStrictEqual(deno, shell, locale);
        strictEqual(deno.code, 0);
      }
    }),
});

async function linkSnapshot(home: string) {
  const result: Record<string, string> = {};
  for (const harness of [".claude", ".agents"]) {
    const dest = join(home, harness, "skills");
    for await (const entry of Deno.readDir(dest)) {
      const path = join(dest, entry.name);
      result[harness + "/" + entry.name] = entry.isSymlink
        ? await Deno.readLink(path)
        : await Deno.readTextFile(path);
    }
  }
  return result;
}

Deno.test({
  name: "shell parity: linking, conflicts, duplicates, reruns and alias guard",
  ignore: !linux,
  fn: () =>
    withFixture(async (fixture) => {
      const repo = join(fixture, "repo");
      const home = join(fixture, "home");
      await copyPair(repo, "scripts/link-skills");
      for (
        const path of [
          "engineering/space name",
          "engineering/duplicate",
          "productivity/duplicate",
          "in-progress/beta",
          "misc/skipped",
          "deprecated/retired",
          "engineering/node_modules/skipped",
        ]
      ) await write(join(repo, "skills", path, "SKILL.md"));
      for (const harness of [".claude", ".agents"]) {
        const dest = join(home, harness, "skills");
        await write(join(dest, "space name/old.txt"));
        await write(join(dest, "unrelated"), "keep me");
        await Deno.symlink("missing", join(dest, "beta"));
      }
      const env = { HOME: home };
      const args = [join(repo, "scripts/link-skills.sh")];
      const tsArgs = denoArgs(join(repo, "scripts/link-skills.ts"));
      const shell = await run("bash", args, "/", "", env);
      strictEqual(shell.code, 0, shell.stderr);
      const baseline = await linkSnapshot(home);
      for (let iteration = 0; iteration < 2; iteration++) {
        deepStrictEqual(
          await run(Deno.execPath(), tsArgs, "/", "", env),
          shell,
        );
        deepStrictEqual(await linkSnapshot(home), baseline);
      }
      const dest = join(home, ".claude", "skills");
      await Deno.remove(dest, { recursive: true });
      await Deno.symlink(join(repo, "skills"), dest);
      const blocked = await run("bash", args, "/", "", env);
      strictEqual(blocked.code, 1);
      deepStrictEqual(
        await run(Deno.execPath(), tsArgs, "/", "", env),
        blocked,
      );
    }),
});

Deno.test({
  name: "shell parity: HITL answers, whitespace, CRLF and EOF",
  ignore: !linux,
  fn: () =>
    withFixture(async (fixture) => {
      const relative =
        "skills/engineering/diagnosing-bugs/scripts/hitl-loop.template";
      await copyPair(fixture, relative);
      for (
        const input of [
          "\ny\nnone\n",
          "\n  y \t\n  path\\file = café \t\n",
          "\n\n\n",
          "\r\ny\r\nnone\r\n",
          "\ny\0es\nnu\0ll\n",
          "",
          "\n",
          "\ny\n",
          "\ny\nunterminated",
        ]
      ) {
        const shell = await run(
          "bash",
          [join(fixture, relative + ".sh")],
          fixture,
          input,
        );
        const deno = await run(
          Deno.execPath(),
          denoArgs(join(fixture, relative + ".ts")),
          fixture,
          input,
        );
        deepStrictEqual(deno, shell, JSON.stringify(input));
      }
    }),
});

Deno.test({
  name: "shell parity: wizard prompts, env bytes, defaults and fake commands",
  ignore: !linux,
  fn: () =>
    withFixture(async (fixture) => {
      const relative = "skills/engineering/wizard/template";
      await copyPair(fixture, relative);
      const bin = join(fixture, "bin");
      const log = join(fixture, "commands.log");
      // These are fake commands. The values in fixtures are not credentials.
      await write(
        join(bin, "wslview"),
        '#!/bin/bash\nprintf "open:%s\\n" "$*" >> "$COMMAND_LOG"\nexit "$OPEN_CODE"\n',
      );
      await write(
        join(bin, "gh"),
        '#!/bin/bash\nprintf "gh:%s\\n" "$*" >> "$COMMAND_LOG"\n' +
          'if [[ "$1" = auth ]]; then exit "$AUTH_CODE"; fi\n' +
          'if [[ "$1" = secret ]]; then cat >> "$COMMAND_LOG"; printf "\\n" >> "$COMMAND_LOG"; fi\n' +
          'exit "$SET_CODE"\n',
      );
      await Deno.chmod(join(bin, "wslview"), 0o755);
      await Deno.chmod(join(bin, "gh"), 0o755);
      const envFile = join(fixture, ".env");
      const cases = [
        { input: "\npk_fixture\nsk_fixture\n", existing: "" },
        {
          input: "\n\n\n",
          existing:
            "# keep\r\nSTRIPE_PUBLISHABLE_KEY=old\r\nSTRIPE_PUBLISHABLE_KEY=last\r\nSTRIPE_SECRET_KEY=secret\r\nTAIL=no-newline",
        },
        {
          input: "\n  pk_\\literal=value \t\n  sk_é\\fixture \t\n",
          existing: "",
        },
        { input: "", existing: "" },
        { input: "\npk_fixture\nunterminated", existing: "" },
        { input: "\npk_fixture\r\nsk_fixture\r\n", existing: "" },
        { input: "\npk_fixture\nsk_fixture\n", existing: "", AUTH_CODE: "1" },
        { input: "\npk_fixture\nsk_fixture\n", existing: "", SET_CODE: "1" },
        { input: "\npk_fixture\nsk_fixture\n", existing: "", OPEN_CODE: "1" },
      ];
      for (const scenario of cases) {
        const env = {
          PATH: bin + ":" + Deno.env.get("PATH"),
          ENV_FILE: envFile,
          COMMAND_LOG: log,
          AUTH_CODE: scenario.AUTH_CODE ?? "0",
          SET_CODE: scenario.SET_CODE ?? "0",
          OPEN_CODE: scenario.OPEN_CODE ?? "0",
        };
        await Deno.writeTextFile(envFile, scenario.existing);
        await Deno.writeTextFile(log, "");
        const shell = await run(
          "bash",
          [join(fixture, relative + ".sh")],
          fixture,
          scenario.input,
          env,
        );
        strictEqual(shell.code, 0, shell.stderr);
        const envBytes = await Deno.readFile(envFile);
        const commands = await Deno.readTextFile(log);
        const mode = (await Deno.stat(envFile)).mode;
        await Deno.writeTextFile(envFile, scenario.existing);
        await Deno.writeTextFile(log, "");
        const deno = await run(
          Deno.execPath(),
          denoArgs(join(fixture, relative + ".ts")),
          fixture,
          scenario.input,
          env,
        );
        deepStrictEqual(deno, shell, JSON.stringify(scenario));
        deepStrictEqual(await Deno.readFile(envFile), envBytes);
        strictEqual(await Deno.readTextFile(log), commands);
        strictEqual((await Deno.stat(envFile)).mode, mode);
      }
    }),
});
