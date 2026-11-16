# bench: an agent building boards, measured

The bench answers one question: when the tools or the skill change, does an agent build boards more easily? It has a
few board briefs (`briefs/*.md`, each a request a person could type), a runner that has an agent build each brief
headless through this checkout's MCP server, and a table of numbers per run measured from the project the agent left
behind, not from what the agent said.

## Running it

```
npm run build
node bench/run.mjs [--brief can-node] [--model haiku] [--runs 1] [--out bench/results] [--timeout-min 20]
```

Without `--brief` every brief runs. `--model` takes what the `claude` program accepts (`haiku`, `sonnet`, `opus`).
Each run gets an empty project folder; results land in `bench/results/<date-time>/` (ignored by git):

- `<brief>-<model>-<n>/project/`: what the agent built;
- `transcript.jsonl`: the raw stream of the run; `stderr.txt`; `mcp.json`; `command.txt` (the exact command line);
- `result.json`: every count below and more (calls per tool, guide topics, board size, check and export output);
- `<circuit>-pcb.png`: a picture of the board;
- `summary.md`: one row per run, then the refused calls grouped by tool.

The runner starts the agent as

```
claude -p --model <model> --output-format stream-json --verbose --mcp-config <run>/mcp.json --strict-mcp-config
  --tools "" --allowedTools mcp__copperflow --permission-mode dontAsk --setting-sources project
  --disable-slash-commands --no-chrome --no-session-persistence
```

with the brief on standard input and the empty project folder as its working directory: only the copperflow server,
no built-in tools (nothing that writes files or runs commands), every copperflow tool allowed and anything else
refused without a prompt, no user settings, skills or slash commands. The user's own instruction files (CLAUDE.md)
can still reach the agent: the program offers no option that drops them and keeps the normal sign-in. The tools,
servers, skills and plugins the run was given are kept in `result.json` under `transcript.init`.

## Columns

| column | meaning |
|---|---|
| ended | `finished`, `timed out`, or `error: …` as the stream or the exit reported it |
| minutes | wall time of the agent |
| tool calls | every tool call in the transcript |
| refused | tool results marked as errors |
| parts, instances | parts in all circuits (as `project_status` counts them) and sheet instances (`summary`) |
| unrouted | connections not yet routed, all circuits |
| errors, warnings | copperflow's own checks, all circuits |
| fab files | whether the agent itself left `*-fab.zip` in the project (`result.json` also says whether a measuring `export` wrote files) |
| tokens in/out | input tokens (cache reads and writes included) and output tokens as the stream reported them |

`n/a` means not measured: no circuit, or a stream that stopped before its result.

## Cost and noise

The runner uses the person's own Claude plan through the `claude` program; every run spends from it, and a board can
take tens of tool calls. One run says little: the same brief and model differ from run to run, so compare several runs
before and after a change, and compare medians rather than single rows.
