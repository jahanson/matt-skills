# Deno script alternatives

Each shell script has a TypeScript version beside it. The shell entrypoints remain
available. Use Deno 2.9 or newer and run the TypeScript files explicitly, including
on Windows. The templates are self-contained and can be copied to another project.

From the repository root:

| Script | Command |
| --- | --- |
| List skills | `deno run --allow-read --allow-run=sort scripts/list-skills.ts` |
| Link skills | `deno run --allow-read --allow-write --allow-env=HOME,USERPROFILE scripts/link-skills.ts` |
| Debugging prompts | `deno run --allow-run=chcp.com skills/engineering/diagnosing-bugs/scripts/hitl-loop.template.ts` |
| Git hook | `deno run --no-prompt --allow-run=jq skills/misc/git-guardrails-claude-code/scripts/block-dangerous-git.ts` |

For a copied wizard, edit the stages first, then run:

```text
deno run --allow-env=ENV_FILE --allow-read=. --allow-write=. --allow-run=chcp.com,tput,wslview,explorer.exe,xdg-open,open,gh wizard.ts
```

The wizard uses `.env` in the current directory unless `ENV_FILE` selects another
file. If it selects a file outside that directory, grant read/write permission to
its parent directory instead. Subprocess permissions cover the browser opener,
optional `tput` styling, and optional `gh` operations. Secret values go to `gh`
through stdin. Author the stages with the async `Wizard` methods shown in
`skills/engineering/wizard/template.ts`.

## Compatibility

- Listing still uses POSIX-compatible `sort` to preserve the original locale's
  ordering. On Windows, put GNU `sort` (for example, from Git for Windows) before
  Windows System32 `sort.exe` on `PATH`.
- Linking uses directory symlinks. Windows needs Developer Mode or symlink
  privileges. `HOME` takes precedence; Windows falls back to `USERPROFILE`.
  Existing conflicting files/directories are replaced, duplicate skill names
  retain traversal-order behavior, and stale links are retained, as in Bash.
- The hook retains `jq` to preserve JSON stream parsing, non-string values, and
  parser diagnostics. Its regex patterns and their order are unchanged.
  Missing `jq` still exits successfully, as in the original hook.
- Prompts preserve Bash's whitespace trimming, blank answers, and EOF behavior.
  Piped carriage returns remain part of the answer. Native Windows terminal
  Enter is handled as a line ending.
- Interactive Windows prompts use the built-in `chcp.com` command to select
  UTF-8 temporarily and restore the console's previous encoding afterward.
  The debugging template needs that run grant only for a Windows terminal;
  piped input and non-Windows runs need no permission flags.
- Platform/runtime failure diagnostics can differ from Bash and its utilities.
  Missing-command diagnostics omit Bash source locations, and the hook strips
  NUL bytes without Bash's command-substitution warning. These diagnostics are
  not claimed to be byte-identical.

## Verification

Run `deno task ok` for formatting, lint, type checking, and tests. No npm packages
are imported by these scripts; the Deno configuration does not maintain a second
lockfile for the existing npm release tools.

Tests require Bash, POSIX utilities, and `jq` on `PATH` to compare against the
original scripts. Native Windows tests cover linking and prompt helpers as well
as hook comparisons. `scripts/shell-parity_test.ts` additionally runs on Linux,
comparing stdout, stderr, status, links, `.env` bytes, and fake browser/GitHub
calls. Every filesystem fixture is temporary. The tests do not install skills
into the real home directory, open real browsers, or set real GitHub secrets.

Terminal checks verified Windows Unicode input, hidden entry, backspace, and
normal console-encoding restoration. Linux pseudo-terminal comparisons also
verified Ctrl-C and terminal-mode restoration. Native Windows Ctrl-C cleanup is
implemented but remains unverified: the console test harness did not deliver
the shortcut to either Bash or Deno, and direct signal injection was inconclusive.
