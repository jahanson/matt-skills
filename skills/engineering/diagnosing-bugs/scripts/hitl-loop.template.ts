// Human-in-the-loop reproduction loop.
// Copy this file, edit the steps below, and run it.
// The agent runs the script; the user follows prompts in their terminal.
//
// Usage:
//   deno run hitl-loop.template.ts
//   deno run --allow-run=chcp.com hitl-loop.template.ts  (Windows terminal)
//
// Two helpers:
//   await step("instruction")       shows instruction, waits for Enter
//   await capture("question")       shows question, returns answer bytes
//
// Captured values are printed as KEY=VALUE for the agent to parse.
// Capture observations, and leave signing in to the user as a step.

interface Reader {
  read(buffer: Uint8Array): Promise<number | null>;
}

interface Writer {
  write(buffer: Uint8Array): Promise<number>;
}

const encoder = new TextEncoder();

async function write(
  writer: Writer,
  value: string | Uint8Array,
): Promise<void> {
  const bytes = typeof value === "string" ? encoder.encode(value) : value;
  for (let offset = 0; offset < bytes.length;) {
    offset += await writer.write(bytes.subarray(offset));
  }
}

// Match Bash read -r: ignore NUL bytes, trim space/tab IFS, and require LF.
// Keep bytes intact so malformed UTF-8 and piped CRLF also round-trip.
function lineReader(
  input: Reader,
  windowsTerminal: boolean,
): () => Promise<Uint8Array | null> {
  const buffer = new Uint8Array(4096);
  let position = 0;
  let length = 0;
  return async () => {
    const line: number[] = [];
    while (true) {
      if (position === length) {
        const count = await input.read(buffer);
        if (count === null) return null;
        position = 0;
        length = count;
        if (count === 0) continue;
      }
      const byte = buffer[position++];
      if (byte === 10) {
        let start = 0;
        let end = line.length;
        if (windowsTerminal && line[end - 1] === 13) end--;
        while (start < end && (line[start] === 32 || line[start] === 9)) {
          start++;
        }
        while (end > start && (line[end - 1] === 32 || line[end - 1] === 9)) {
          end--;
        }
        return new Uint8Array(line.slice(start, end));
      }
      if (byte !== 0) line.push(byte);
    }
  };
}

function consoleUtf8(): () => void {
  function chcp(args: string[]) {
    const result = new Deno.Command("chcp.com", {
      args,
      stdin: "inherit",
      stdout: "piped",
      stderr: "piped",
    }).outputSync();
    if (!result.success) {
      throw new Error("Could not configure the Windows console code page");
    }
    return new TextDecoder().decode(result.stdout);
  }
  const previous = chcp([]).match(/\d+/)?.[0];
  if (!previous) {
    throw new Error("Could not read the Windows console code page");
  }
  if (previous === "65001") return () => {};
  chcp(["65001"]);
  let restored = false;
  function restore() {
    if (restored) return;
    chcp([previous!]);
    restored = true;
  }
  function interrupt() {
    restore();
    Deno.exit(130);
  }
  try {
    Deno.addSignalListener("SIGINT", interrupt);
  } catch (cause) {
    restore();
    throw cause;
  }
  return () => {
    restore();
    Deno.removeSignalListener("SIGINT", interrupt);
  };
}

export async function run(
  input: Reader = Deno.stdin,
  output: Writer = Deno.stdout,
  error: Writer = Deno.stderr,
  terminal = Deno.stdin.isTerminal(),
  windowsTerminal = terminal && Deno.build.os === "windows",
): Promise<number> {
  const restoreConsole = windowsTerminal && input === Deno.stdin
    ? consoleUtf8()
    : () => {};
  const readLine = lineReader(input, windowsTerminal);
  const eof = Symbol("end of input");

  async function answer(
    instruction: string,
    prompt: string,
  ): Promise<Uint8Array> {
    await write(output, `\n>>> ${instruction}\n`);
    if (terminal) await write(error, prompt);
    const value = await readLine();
    if (value === null) throw eof;
    return value;
  }

  async function step(instruction: string): Promise<void> {
    await answer(instruction, "    [Enter when done] ");
  }

  function capture(question: string): Promise<Uint8Array> {
    return answer(question, "    > ");
  }

  try {
    // --- edit below ---------------------------------------------------------

    await step("Open the app at http://localhost:3000 and sign in.");

    const errored = await capture(
      "Click the 'Export' button. Did it throw an error? (y/n)",
    );

    const errorMsg = await capture("Paste the error message (or 'none'):");

    // --- edit above ---------------------------------------------------------

    await write(output, "\n--- Captured ---\nERRORED=");
    await write(output, errored);
    await write(output, "\nERROR_MSG=");
    await write(output, errorMsg);
    await write(output, "\n");
    return 0;
  } catch (cause) {
    if (cause === eof) return 1;
    throw cause;
  } finally {
    restoreConsole();
  }
}

if (import.meta.main) Deno.exitCode = await run();
