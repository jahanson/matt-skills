const shellScript = new URL("./block-dangerous-git.sh", import.meta.url);
const denoScript = new URL("./block-dangerous-git.ts", import.meta.url);
const shellPath = decodeURIComponent(shellScript.pathname).replace(
  /^\/([A-Za-z]:\/)/,
  "$1",
);

async function invoke(
  executable: string,
  args: string[],
  input: string,
  env?: Record<string, string>,
) {
  const child = new Deno.Command(executable, {
    args,
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
    env,
  }).spawn();
  const writer = child.stdin.getWriter();
  await writer.write(new TextEncoder().encode(input));
  await writer.close();
  return await child.output();
}

Deno.test("missing jq preserves fail-open exit with a diagnostic", async () => {
  const output = await invoke(
    Deno.execPath(),
    ["run", "--quiet", "--allow-run=jq", denoScript.href],
    '{"tool_input":{"command":"git push"}}',
    { PATH: "" },
  );
  if (
    output.code !== 0 || output.stdout.length !== 0 ||
    !new TextDecoder().decode(output.stderr).includes("jq: command not found")
  ) {
    throw new Error("Missing jq must report the missing command and exit zero");
  }
});

const commands = [
  "git status",
  "git push origin main",
  "git reset --hard HEAD",
  "git clean -fd",
  "git clean -f",
  "git branch -D old",
  "git checkout .",
  "git restore .",
  "push --force",
  "reset --hard",
  'echo "git push"',
  "git   push",
  "GIT PUSH",
  "git checkout x",
  "git restore x",
  "git reset --hard\ngit push",
  "git push\n\n",
  "-n",
];

const fixtures = [
  ...commands.map((command) => JSON.stringify({ tool_input: { command } })),
  "",
  "{}",
  "null",
  '{"tool_input":{"command":null}}',
  '{"tool_input":{"command":123}}',
  '{"tool_input":{"command":["git push"]}}',
  '{"tool_input":{"command":{"nested":"git push"}}}',
  '{"tool_input":{"command":"git push"}}\n{}',
  '{"tool_input":{"command":"git push"}}\n{',
  "{",
  "[]",
  "-n",
];

for (const [index, input] of fixtures.entries()) {
  Deno.test(`guardrail matches Bash output and exit for fixture ${index}`, async () => {
    const expected = await invoke("bash", [shellPath], input);
    const actual = await invoke(
      Deno.execPath(),
      ["run", "--quiet", "--allow-run=jq", denoScript.href],
      input,
    );
    for (const field of ["code", "stdout", "stderr"] as const) {
      const wanted = JSON.stringify(
        field === "code"
          ? expected.code
          : new TextDecoder().decode(expected[field]),
      );
      const received = JSON.stringify(
        field === "code"
          ? actual.code
          : new TextDecoder().decode(actual[field]),
      );
      if (wanted !== received) {
        throw new Error(
          `${field} differs for ${
            JSON.stringify(input)
          }: expected ${wanted}, got ${received}`,
        );
      }
    }
  });
}
