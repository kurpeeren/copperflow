# copperflow

Design circuits in code while a human and an AI agent edit the same files.

copperflow sits on top of [tscircuit](https://github.com/tscircuit/tscircuit). Circuits are
TSX files. You and your agent work on them together:

- the agent changes the circuit through an MCP server, and every change is one undo step;
- you lock the parts you have placed, and the agent cannot move or change them;
- you leave marks such as "route ground here", and the agent reads them;
- edits are written back as minimal text changes, so the rest of your code stays as you wrote it.

Everything runs locally. There is no chat inside copperflow: use the agent you already use,
for example Claude Code, through MCP.

> **Status: 0.1, early.** The core, the MCP server and the CLI work. The visual editor,
> the parts library and the project hierarchy are next; see [docs/design.md](docs/design.md).

## Quick start

Requires Node.js 22 or newer. copperflow is not on npm yet, so install it from source:

```bash
git clone https://github.com/kurpeeren/copperflow.git
cd copperflow
npm install
npm run build
npm link
```

Try it on the example board:

```bash
copperflow summary --root examples/usb-c-ldo index.circuit.tsx
```

To build boards, and for `copperflow check`, you also need the tscircuit CLI:
`npm install -g tscircuit`. Set `COPPERFLOW_TSCI` if it is not on your PATH.

### Connect Claude Code

From your circuit project:

```bash
claude mcp add copperflow -- copperflow mcp
```

Then copy the skill so the agent knows the workflow:

```bash
mkdir -p .claude/skills
cp -r /path/to/copperflow/skills/copperflow .claude/skills/
```

Any other MCP client can run `copperflow mcp` over stdio from the project folder
(or pass `--root <dir>`).

## How it works

**The editable subset.** copperflow only writes back to code it can read without running it:
a part needs a string-literal `name`, and a prop is editable when its value is a literal such
as `pcbX={4.5}` or `resistance="10k"`. Parts inside `.map()` or with spread props, and
expressions such as `pcbX={x + 2}`, are shown as read-only. Nothing else is restricted.

**Locks and marks.** They live next to the circuit in `board.circuit.annotations.json`, so
tscircuit never sees them and git keeps them. Only you lock and unlock. The agent's tools
refuse to touch locked parts, and every summary reports a locked part that was changed some
other way.

**History.** Every change made through copperflow is stored in `.copperflow/history/` with
who made it. `copperflow undo` reverts the newest change; the agent can undo only its own.
The agent sees what you undid and does not repeat it.

## MCP tools

| Tool | What it does |
|------|--------------|
| `list_circuits` | Lists the `*.circuit.tsx` files in the project |
| `circuit_summary` | Parts, props, traces, locks, marks and lock violations of one file |
| `set_props` | Sets literal props: position, rotation, value, footprint |
| `remove_part` | Removes a part and its traces |
| `add_trace` / `remove_trace` | Connects or disconnects two ports or nets |
| `check_circuit` | Builds the board with tscircuit and lists errors and warnings, such as overlapping parts |
| `recent_changes` | Recent changes by you and the agent, including undos |
| `undo_change` | Undoes one of the agent's own changes |

There is no unlock tool on purpose.

## CLI

```text
copperflow mcp                              start the MCP server on stdio
copperflow summary <file>                   print a circuit summary
copperflow check <file>                     build with tscircuit and list errors and warnings
copperflow lock <file> <part...>            lock parts so the agent cannot change them
copperflow unlock <file> <part...>          unlock parts
copperflow mark <file> <text> [--pcb x,y | --sch x,y]
                                            leave a note for the agent
copperflow unmark <file> <id>               remove a note
copperflow history [--limit n]              list recent changes
copperflow undo [id]                        undo the newest change, or the given one
```

## Roadmap

- **0.2** Visual editor in the browser: drag, rotate, lock, delete and reconnect wires, draw marks.
- **0.3** Parts library (one folder per part) and datasheet-to-part import; BOM and datasheet package.
- **0.4** Project hierarchy for large boards: a project map, blocks with interfaces, generated summaries, project rules.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE). "copperflow" refers to this
project; the license does not grant rights to the name.
