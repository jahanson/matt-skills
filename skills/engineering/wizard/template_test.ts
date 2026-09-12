import {
  Interrupted,
  LineReader,
  type Runner,
  upsertEnv,
  Wizard,
} from "./template.ts";

function inputReader(text: string, terminal = false) {
  const encoded = new TextEncoder().encode(text);
  const modes: boolean[] = [];
  let offset = 0;
  const reader = new LineReader({
    isTerminal: () => terminal,
    setRaw: (mode) => {
      modes.push(mode);
    },
    read: (buffer) => {
      // A one-byte destination loses Unicode on the Windows console path.
      if (buffer.length < 4) {
        throw new Error("Console buffer cannot hold a UTF-8 character");
      }
      if (offset === encoded.length) return Promise.resolve(null);
      const count = Math.min(buffer.length, encoded.length - offset);
      buffer.set(encoded.subarray(offset, offset + count));
      offset += count;
      return Promise.resolve(count);
    },
  });
  return { reader, modes };
}

Deno.test("buffered prompts retain Unicode and subsequent pasted lines", async () => {
  const { reader } = inputReader("  héllo  \nsecret\nlast\r\n");
  equal(await reader.readLine(), "héllo");
  equal(await reader.readLine(true), "secret");
  equal(await reader.readLine(), "last\r");
  equal(await reader.readLine(), "");
});

Deno.test("hidden Unicode input supports backspace and restores terminal mode", async () => {
  const { reader, modes } = inputReader("héllx\x7fo\r", true);
  equal(await reader.readLine(true), "héllo");
  equal(modes, [true, false]);
  const unicode = inputReader("h😀\x7fé\r", true);
  equal(await unicode.reader.readLine(true), "hé");
});

Deno.test("hidden input restores terminal mode when interrupted", async () => {
  const { reader, modes } = inputReader("hidden\x03", true);
  let interrupted = false;
  try {
    await reader.readLine(true);
  } catch (error) {
    interrupted = error instanceof Interrupted;
  }
  equal(interrupted, true);
  equal(modes, [true, false]);
});

function equal(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

Deno.test("upsert matches grep line filtering and printf append bytes", () => {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  for (
    const [input, expected] of [
      ["", "KEY=new\n"],
      ["KEY=one\nOTHER=kept\nKEY=two\n", "OTHER=kept\nKEY=new\n"],
      [
        "# comment\r\nKEY=old\r\nOTHER=value\r\n",
        "# comment\r\nOTHER=value\r\nKEY=new\n",
      ],
      ["OTHER=no-final-newline", "OTHER=no-final-newline\nKEY=new\n"],
      ["\nKEY=old\n\n", "\n\nKEY=new\n"],
    ]
  ) {
    equal(
      decoder.decode(upsertEnv(encoder.encode(input), "KEY", "new")),
      expected,
    );
  }
});

Deno.test("existing last value and empty input preserve raw dotenv values", async () => {
  const envFile = await Deno.makeTempFile();
  try {
    await Deno.writeTextFile(envFile, 'KEY=first\nKEY="last $value"\r\n');
    let output = "";
    const reads: boolean[] = [];
    const wizard = await Wizard.create({
      envFile,
      terminal: false,
      write: (text) => output += text,
      read: (secret) => {
        reads.push(secret);
        return Promise.resolve("");
      },
    });
    equal(await wizard.ask("KEY", "Public:"), '"last $value"\r');
    equal(await wizard.askSecret("KEY", "Secret:"), '"last $value"\r');
    equal(reads, [false, true]);
    equal(
      output,
      "  Public: [Enter keeps current]   Secret: [Enter keeps current] \n",
    );
    await wizard.writeEnv("KEY", "literal $&\\value");
    equal(await Deno.readTextFile(envFile), "KEY=literal $&\\value\n");
    equal(wizard.writtenEnv, ["KEY"]);
  } finally {
    await Deno.remove(envFile);
  }
});

Deno.test("GitHub secrets use stdin and failures retain shell summary wording", async () => {
  const calls: unknown[] = [];
  let authenticated = true;
  let output = "";
  const run: Runner = (command, args, input) => {
    calls.push([command, args, input]);
    return Promise.resolve({ code: authenticated ? 0 : 1, stdout: "" });
  };
  const wizard = await Wizard.create({
    envFile: ".env",
    terminal: false,
    run,
    write: (text) => output += text,
  });
  await wizard.setSecret("TOKEN", "secret\nvalue");
  await wizard.setVar("PUBLIC", "value with spaces");
  equal(calls, [
    ["gh", ["auth", "status"], undefined],
    ["gh", ["secret", "set", "TOKEN"], "secret\nvalue"],
    ["gh", ["auth", "status"], undefined],
    [
      "gh",
      ["variable", "set", "PUBLIC", "--body", "value with spaces"],
      undefined,
    ],
  ]);
  authenticated = false;
  await wizard.setSecret("OTHER", "must not be sent");
  await wizard.setVar("OTHER_VAR", "unused");
  await wizard.finish();
  equal(wizard.writtenSecret, ["TOKEN"]);
  equal(wizard.skipped, [
    "GitHub secret OTHER (set it manually: gh secret set OTHER)",
    "GitHub variable OTHER_VAR",
  ]);
  equal(output.includes("secret\nvalue"), false);
  equal(
    output.includes(
      "  - GitHub secret OTHER (set it manually: gh secret set OTHER)\n",
    ),
    true,
  );
});

Deno.test("browser precedence stops at first installed opener even when it fails", async () => {
  const calls: string[] = [];
  let output = "";
  const wizard = await Wizard.create({
    envFile: ".env",
    terminal: false,
    write: (text) => output += text,
    run: (command) => {
      calls.push(command);
      return Promise.resolve(
        command === "explorer.exe" ? { code: 1, stdout: "" } : undefined,
      );
    },
  });
  await wizard.openUrl("https://example.com/a?x=1&y=2");
  equal(calls, ["wslview", "explorer.exe"]);
  equal(
    output,
    "  ↗ opening https://example.com/a?x=1&y=2\n  ⚠ couldn't open a browser, so visit it manually: https://example.com/a?x=1&y=2\n",
  );
});

Deno.test("no opener preserves suppressed warning and nonterminal output never calls tput", async () => {
  let output = "";
  const calls: string[] = [];
  const wizard = await Wizard.create({
    envFile: ".env",
    terminal: false,
    write: (text) => output += text,
    run: (command) => {
      calls.push(command);
      return Promise.resolve(undefined);
    },
    read: () => Promise.resolve("yes"),
  });
  wizard.totalStages = 1;
  await wizard.stage("Example");
  await wizard.openUrl("https://example.com");
  equal(await wizard.confirm("Continue?"), true);
  equal(calls, ["wslview", "explorer.exe", "xdg-open", "open"]);
  equal(
    output,
    "\n▸ Stage 1/1 · Example\n  ↗ opening https://example.com\n  ? Continue? [y/N] ",
  );
});
