// Invoke with: deno run --allow-run=jq block-dangerous-git.ts
// jq remains a dependency to preserve its JSON stream and diagnostic behavior.
const patterns = [
  "git push",
  "git reset --hard",
  "git clean -fd",
  "git clean -f",
  "git branch -D",
  String.raw`git checkout \.`,
  String.raw`git restore \.`,
  "push --force",
  "reset --hard",
] as const;

function commandSubstitution(value: string): string {
  return value.replaceAll("\0", "").replace(/\n+$/, "");
}

function echo(value: string): string {
  // Bash's echo treats a sole flag argument specially, even when quoted.
  if (/^-[neE]+$/.test(value)) return value.includes("n") ? "" : "\n";
  return `${value}\n`;
}

export async function main(): Promise<number> {
  const input = commandSubstitution(
    await new Response(Deno.stdin.readable).text(),
  );
  let child: Deno.ChildProcess;
  try {
    child = new Deno.Command("jq", {
      args: ["-r", ".tool_input.command"],
      stdin: "piped",
      stdout: "piped",
      stderr: "inherit",
    }).spawn();
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
    console.error("jq: command not found");
    return 0;
  }
  const writing = (async () => {
    const writer = child.stdin.getWriter();
    try {
      await writer.write(new TextEncoder().encode(echo(input)));
      await writer.close();
    } catch (error) {
      // jq can stop reading early on invalid input, like the shell pipeline.
      if (!(error instanceof Deno.errors.BrokenPipe)) throw error;
    } finally {
      writer.releaseLock();
    }
  })();
  const output = await child.output();
  await writing;
  // The original hook ignores jq's exit code and tests any output it produced.
  // Git Bash strips trailing CRLF from native Windows command substitutions.
  const stdout = new TextDecoder().decode(output.stdout);
  const command = commandSubstitution(
    Deno.build.os === "windows" ? stdout.replace(/(?:\r?\n)+$/, "") : stdout,
  );
  for (const pattern of patterns) {
    if (new RegExp(pattern).test(command)) {
      console.error(
        `BLOCKED: '${command}' matches dangerous pattern '${pattern}'. The user has prevented you from doing this.`,
      );
      return 2;
    }
  }
  return 0;
}

if (import.meta.main) Deno.exit(await main());
