import { run } from "./hitl-loop.template.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function execute(
  bytes: Uint8Array,
  terminal = false,
  chunk = 4096,
  windowsTerminal = false,
) {
  let position = 0;
  const stdout: number[] = [];
  const stderr: number[] = [];
  const sink = (target: number[]) => ({
    write(value: Uint8Array): Promise<number> {
      // Exercise short writes as well as chunked reads.
      const count = Math.min(3, value.length);
      target.push(...value.subarray(0, count));
      return Promise.resolve(count);
    },
  });
  const status = await run(
    {
      read(buffer: Uint8Array): Promise<number | null> {
        if (position === bytes.length) return Promise.resolve(null);
        const count = Math.min(chunk, buffer.length, bytes.length - position);
        buffer.set(bytes.subarray(position, position + count));
        position += count;
        return Promise.resolve(count);
      },
    },
    sink(stdout),
    sink(stderr),
    terminal,
    windowsTerminal,
  );
  return {
    status,
    stdout: new Uint8Array(stdout),
    stderr: decoder.decode(new Uint8Array(stderr)),
  };
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("Unicode console answers preserve Bash trimming and EOF behavior", async () => {
  const result = await execute(
    encoder.encode("\r\n \ty\0 \t\r\n café ☃ \r\n"),
    true,
    4096,
    true,
  );
  assert(result.status === 0, "console answers succeed");
  assert(
    decoder.decode(result.stdout).endsWith("ERRORED=y\nERROR_MSG=café ☃\n"),
    "console Unicode round-trips and IFS whitespace trims",
  );
  const eof = await execute(new Uint8Array(), true, 4096, true);
  assert(eof.status === 1, "console EOF fails");
  assert(
    !decoder.decode(eof.stdout).includes("--- Captured ---"),
    "no EOF summary",
  );
});

Deno.test("captures preserve Bash whitespace, backslashes, NUL and byte behavior", async () => {
  const prefix = encoder.encode("\n \ty\\es\0 \t\n  error=");
  const bytes = new Uint8Array([...prefix, 255, 13, 10]);
  const expected = new Uint8Array([
    ...encoder.encode("ERRORED=y\\es\nERROR_MSG=error="),
    255,
    13,
    10,
  ]);
  for (const chunk of [1, 4096]) {
    const result = await execute(bytes, false, chunk);
    const tail = result.stdout.slice(-expected.length);
    assert(result.status === 0, "complete lines succeed");
    assert(
      tail.every((value, index) => value === expected[index]),
      "answers round-trip exactly",
    );
    assert(result.stderr === "", "piped input has no read prompts");
  }
});

Deno.test("EOF at each read suppresses the summary, including an unterminated answer", async () => {
  for (const value of ["", "\n", "\ny\n", "\ny\npartial"]) {
    const result = await execute(encoder.encode(value));
    assert(result.status === 1, "EOF fails");
    assert(
      !decoder.decode(result.stdout).includes("--- Captured ---"),
      "no partial summary",
    );
  }
});

Deno.test("blank terminal answers succeed and prompts use stderr", async () => {
  const result = await execute(encoder.encode("\n\n\n"), true);
  assert(result.status === 0, "blank lines succeed");
  assert(
    result.stderr === "    [Enter when done]     >     > ",
    "prompts match Bash",
  );
  assert(
    decoder.decode(result.stdout).endsWith("ERRORED=\nERROR_MSG=\n"),
    "blank records retained",
  );
});
