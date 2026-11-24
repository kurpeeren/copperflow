import { VERSION } from "./version.js"

export const HELP = `copperflow ${VERSION}

Usage:
  copperflow mcp                              start the MCP server on stdio
  copperflow studio [--port n] [--idle-minutes n]
                                              open the visual editor at http://127.0.0.1:4777 (or a free port);
                                              with --idle-minutes it stops after n minutes with no tab open
  copperflow studio stop                      stop the Studio of this folder
  copperflow connect claude-desktop           add copperflow to Claude Desktop's MCP servers (restart Claude Desktop after)
  copperflow connect claude-code              print the one command that adds copperflow to Claude Code
  copperflow skill [--global]                 copy the copperflow skills into .claude/skills of this folder
                                              (or of your home folder), for agents that read skills
  copperflow summary <file>                   print a circuit summary
  copperflow check <file>                     list the errors and warnings of copperflow's own rule checks
  copperflow lock <file> <part...>            lock parts so the agent cannot change them
  copperflow unlock <file> <part...>          unlock parts
  copperflow mark <file> <text> [--pcb x,y | --sch x,y]
                                              leave a note for the agent
  copperflow unmark <file> <id>               remove a note
  copperflow parts                            list the parts library
  copperflow parts build                      regenerate part components after editing part.yaml
  copperflow parts verify <id> --by <name> --against <datasheet, page>
                                              mark a part as checked against its datasheet
  copperflow parts import <C-number> [--id <id>] [--replace]
                                              fetch a part by its LCSC number from EasyEDA into parts/,
                                              not verified (needs the internet; see docs/licences.md)
  copperflow modules                          list the shelf of modules (COPPERFLOW_MODULES, default ~/.copperflow/modules)
  copperflow modules verify <name> --by <name>
                                              mark a module (or <library>/<name>) as checked by you
  copperflow modules remove <name>            take a module off the shelf
  copperflow library                          list the libraries of modules: built in, git and folders
  copperflow library add <name> <address or folder> [--ref <branch or tag>]
                                              add a library from git (https://, ssh:// or user@host:path)
                                              or a folder; its modules read NOT verified until you verify them
  copperflow library update [name]            bring git libraries to the newest commit of their ref
  copperflow library remove <name>            forget a library (a clone is deleted, a folder never)
  copperflow packages [words...]              the standard packages and the footprint string for each, with pads and
                                              size; words narrow the list (soic, sot 5, sc70, crystal); exits 1 if none match
  copperflow place <file> <part> <name> [key=value ...]
                                              add a library or built-in part to a circuit
  copperflow bom <file> [--csv]               print the bill of materials
  copperflow package <file> [--out dir]
                                              write BOM, datasheets, part status and pin maps to a folder
  copperflow pins <file> [--part <name>] [--format md|csv|c]
                                              which net is on each pin of the library chips and connectors
  copperflow export <file> [--out dir]        write the fabrication files for JLCPCB: Gerbers, drills,
                                              pick-and-place and BOM in <name>-fab/ and <name>-fab.zip
                                              beside the circuit (or in the project folder --out), with <name>.step
  copperflow step <file> [--out file.step]   write the board and its parts (in colour, as the 3D view draws
                                              them) as a STEP file for CAD, <name>.step beside the circuit
  copperflow easyeda <file> [--out file.json]
                                              write the board as an EasyEDA Standard PCB document to open and
                                              edit there, <name>-easyeda.json beside the circuit
  copperflow glb <file> [--out file.glb] [--mask black] [--finish hasl] [--silk black]
                                              write the board as made and its parts (as simple shapes) as a GLB
                                              file a 3D viewer turns, <name>.glb beside the circuit
  copperflow html <file> [--out file.html] [--mask black] [--finish hasl] [--silk black]
                                              write the design as one web page to hand on: schematic pages, board,
                                              3D and BOM, with the fabrication files and 3D models inside,
                                              <name>.html beside the circuit; opens from disk with no network
  copperflow render <file> [--view pcb|schematic|board|3d] [--page <name>] [--parts U1,C3] [--width n] [--out file.png]
      board: the bare board as made [--side bottom] [--mask black] [--finish hasl] [--silk black] [--background #rrggbb]
      3d: the board as made with its parts as simple shapes [--angle top|bottom|front|iso] and the same look options
                  [--change <id> | --since <id>] [--reference: the reference images under the PCB]
                                              draw the board or a schematic page to a PNG, as the Studio shows it
                                              (<name>-pcb.png or <name>-schematic-<page>.png beside the circuit)
  copperflow simulate <file> --set V12=12 --set CTRL=3.3 [--sheet <name>] [--closed SW1,J2] [--coil K1] [--all]
                                              the DC operating point from ideal sources and simple models: no time,
                                              no frequency, no temperature, no tolerance; chips are not modelled.
                                              With --sheet and no --set it runs the sheet's cases
  copperflow spice <file> [--sheet <name>] [--set net=volts ...] [--out file.cir]
                                              write the same circuit as a SPICE3 netlist for another simulator
  copperflow board <file> --dxf <path> [--layer <name>] [--units mm|inch] [--origin keep] [--replace]
  copperflow board <file> --svg <path> [--origin keep] [--replace]
                                              set the board's outline, holes and keepouts from a DXF drawing
  copperflow graphic <file> <drawing.svg|dxf> --layer top-silkscreen|bottom-silkscreen|top-mask|bottom-mask|top|bottom|inner1|inner2
                  [--at x,y] [--width mm | --scale n] [--rotation deg] [--fill] [--name text] [--net name]
                                              place a drawing (a logo, a mark) from the project on the board, kept
                                              in graphics/; at the board's centre unless --at; --fill fills closed
                                              outlines (a DXF has no fill of its own); on copper --net makes it that
                                              net's copper, else it belongs to no net and every net keeps clear of it
  copperflow import kicad <board.kicad_pcb> [--name <circuit name>] [--replace] [--origin keep]
                                              make a new circuit from a KiCad board: its outline, parts (as
                                              library parts, not verified), nets, tracks, vias and pours
  copperflow impedance [--single 50] [--pair 90] [--gap 0.2] [--width 0.3]
                                              line widths and gaps for an impedance on the board's stack (rules.yaml);
                                              an estimate: the router does not route pairs together or tune lengths
  copperflow history [--limit n]              list recent changes
  copperflow history <id> | --since <id>      what one change did, or everything after it
  copperflow undo [id]                        undo the newest change, or the given one

Every command accepts --root <dir> (default: the current directory).
check exits with 1 when the circuit has errors; export exits with 1 when the circuit has errors and writes nothing.`

/** The command words the help lists (mcp, studio, ...) plus the help words; the desktop app uses it to tell a command from a folder. */
export function cliCommandNames(): string[] {
  const listed = [...HELP.matchAll(/^ {2}copperflow (\S+)/gm)].map((match) => match[1] as string)
  return [...new Set([...listed, "help", "--help"])]
}
