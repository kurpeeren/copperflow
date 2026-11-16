# Planning a board: questions, sources, blocks, sub-agents

Read this before the first circuit file of a new board. The plan comes before parts and nets: what
the person wants, how such a circuit is usually built, the board as a tree of blocks with named
ports, and who designs each block. A
block that is used eight times is designed once and placed eight times; that is what keeps a
large board small enough to think about.

## 1. Ask everything first

Ask in one message, numbered and grouped as below, so the person can answer by number. Leave out
what the brief already answers. Give each question the answer you would take by default, so that
"defaults" is a complete reply. A question the person leaves open goes into PROJECT.md's `Open`
with the default you assumed; do not come back later with a question you could have asked here.

1. **Purpose.** What the board does, where it is used, how many will be made.
2. **Counts.** How many of everything that repeats: inputs, outputs, channels, relays, sensors,
   LEDs, motor drivers. Ask for a number, not "a few": each repeated function becomes one block
   placed that many times, and the count sets the connectors and the pins of the controller.
3. **Power.** Each source and its voltage range, the largest current, battery or not, the
   protection wanted (reverse polarity, fuse, ESD on outside pins), the rails the parts need.
4. **Outside connections.** For each one: its signals, the connector (type and pitch, or "any
   header"), the board edge it sits on, what is at the other end of the cable.
5. **Parts.** Part numbers the person insists on (the controller, a radio, a sensor) and which
   are free to choose; the smallest package (0402, 0603, hand soldered or assembled by the fab);
   whether parts must come from one supplier's catalogue.
6. **Signals that set rules.** Bus speeds (USB, CAN bit rate, SPI clock), analog accuracy,
   currents in power paths, isolation, lengths that matter.
7. **The board.** Size or shape limits, layers (two unless said), mounting holes, height limits,
   the enclosure. When the board must fit something, ask for a DXF of its outline in the project folder.
8. **Bring-up.** Programming or debug connector, test points, status LEDs, buttons.
9. **Conditions.** Temperature range, automotive or industrial supply, what a standard requires.
10. **Later.** What the person wants to decide later.

## 2. Look it up

Nobody designs a circuit from nothing, and neither should you: before the blocks, find how this
kind of circuit is usually built. Search with your own web access; copperflow fetches nothing.

- **What to look for**, for the board and then for each function in it: the datasheet of every
  chip in question with its typical application circuit; the makers' application notes and
  reference designs (an evaluation board's schematic is the best source there is); open hardware
  projects that do the same job; and pictures of schematics and boards, which you open when your
  client can show you images.
- **How far to trust it.** A maker's document is a source. A forum post, a blog or a picture is a
  lead: take the idea, then check every value and every pin against the datasheet. Never copy pin
  numbers from a picture.
- **What to bring back** for each function: the usual way to build it and why, the parts it
  takes, the values that have to be worked out for this board, and what goes wrong when a part is
  left out. Three or four good sources are enough; stop when they agree.
- **Write the sources down** as you use them: `note_decision`
  `{ text: "Source: <link> (what it is): what was taken from it" }`, so the person can check
  where a circuit came from. A design under an open hardware licence carries that licence's
  terms: tell the person before you build on one.
- Without web access say so, ask the person for the datasheets and any reference they have, and
  put in `Open` what you could not check. Do not draw a chip's circuit from memory.

An example. "A relay driver module: 12 V supply, switched by 0 V and by 3.3 V or 5 V logic." The
search finds the low-side switch the sources agree on: a transistor or a logic-level MOSFET under
the coil, a diode across the coil for the spike at turn-off, a resistor to the input sized so
that 3.3 V still switches the coil's current fully, a pull-down so that an open input is off, and
often an LED or an optocoupler. From the relay's datasheet come the coil's voltage and current;
from the transistor's, the gain or the threshold that sizes the resistor. Those become the
block's parts, and what the search raised (how many relays, what they switch, isolated or not)
goes back to the person if step 1 did not settle it.

## 3. The block tree

Split the board into blocks before choosing a single part. Look at `list_modules` first: a module
on the person's shelf that does a block's job is used, not designed again ([modules.md](modules.md)).

- A block does one job and has **ports**: the nets that cross its edge. Name every port and say
  what it carries: `VIN 7 to 24 V in`, `V3_3 3.3 V 300 mA out`, `IN 0 to 24 V from the field`,
  `OUT 3.3 V logic to the controller`. Names are letters, digits and `_`, not starting with a digit.
- A function that repeats is **one block and a count**: `Input x8`. Nothing inside it may depend
  on which of the eight it is; what differs between them arrives through a port.
- A block of more than about fifteen parts is two blocks.
- Power first: write the supply tree (which block feeds which rail, with currents) before the
  signal blocks, so every block's supply port has a source.
- The top level holds only what joins blocks: connectors shared by several blocks and the nets
  between ports. Each of those nets is named once, here: `IN1` to `IN8` from the terminal to the
  input blocks, `DI1` to `DI8` from the input blocks to the controller.
- A small board (about fifteen parts, nothing repeated) is one flat circuit: its blocks are named
  in the plan and written at the top level. Every larger board is written as sheets, one per
  block, also for a block used once.

Write the plan with `set_project`, each block's `does` carrying its job, its count and its ports:

```
set_project {
  intent: "Eight 24 V digital inputs read by an STM32G030 and reported over RS-485; 24 V in, 3.3 V rail.",
  blocks: [
    { name: "Power", does: "24 V to 3.3 V 300 mA buck; ports VIN, V3_3, GND", status: "planned" },
    { name: "Input", does: "x8: 24 V input with divider, clamp and RC filter; ports IN, OUT, V3_3, GND", status: "planned" },
    { name: "Controller", does: "STM32G030 with decoupling and SWD header; ports V3_3, GND, DI1 to DI8, TX, RX, DE", status: "planned" },
    { name: "Bus", does: "RS-485 transceiver with termination jumper; ports V3_3, GND, TX, RX, DE, A, B", status: "planned" }
  ],
  open: ["assumed: 0603 parts, assembled by the fab", "approval of the plan", "blocks, then the board"]
}
```

Then show the person the block list, the supply tree and what you assumed, and ask whether to go
on. Wait for a yes and `note_decision` it. Changing the split is cheap now and costly later.

## 4. One sub-agent per block

When your client can start sub-agents, give each block to one, several at a time. A repeated
block goes to one sub-agent, once. Without sub-agents, do the same yourself, one block after
another, in the same shape: finish a block before you start the next.

The brief is all a sub-agent knows. Give it:

- the board in one or two lines (from the Intent);
- the block: its job, every port with what it carries, and the limits from the answers (packages,
  supplier, parts the person fixed);
- the sources step 2 found for this block, to read and to look further from in the same way;
- the tools: `guide` for how to work, `list_parts`, `part_info`, `create_part` and
  `attach_datasheet` for parts. **It writes no circuit file**: no `new_circuit`, `edit_circuit`,
  `place_part` or `connect_nets`. Only you write the circuit, once, in step 5;
- what to send back, below.

A sub-agent sends back the block as one sheet in the shape `new_circuit` takes, and a few lines:

```
Input: {
  does: "24 V digital input: divider, clamp, RC filter",
  parts: [ { name: "R1", kind: "resistor", value: "10k", footprint: "0603" },
           { name: "R2", kind: "resistor", value: "1.5k", footprint: "0603" },
           { name: "C1", kind: "capacitor", value: "100nF", footprint: "0603" },
           { name: "R3", kind: "resistor", value: "1k", footprint: "0603" } ],
  nets: { IN: ["R1.pin1"], DIV: ["R1.pin2", "R2.pin1", "R3.pin1"],
          OUT: ["R3.pin2", "C1.pin1"], GND: ["R2.pin2", "C1.pin2"] },
  ports: [ { name: "IN", type: "input", carries: "0 to 24 V from the field" },
           { name: "OUT", type: "output", carries: "0 to 3.1 V logic, filtered" },
           { name: "GND", type: "ground" } ] }
parts created: none
decisions: 10k over 1.5k gives 3.1 V at 24 V in; the 1k and 100 nF filter at 1.6 kHz
sources: none beyond the divider and filter formulas
questions: V3_3 is not needed by this block; drop the port?
```

- Each port goes back with its type and what it carries, `{ name: "IN", type: "input", carries:
  "0 to 24 V from the field" }`, and the sheet with its `does`; `describe_sheet` writes them into a
  sheet that has none.
- Designators are local and start at 1 in every block (R1, C1, U1); each use gets its own on the
  board (R101, R201).
- Every port is a net of the block, and no net leaves the block except through a port.
- Parts are chosen in the order of SKILL.md step 2. A chip that is not in the library is created
  with `create_part` from its datasheet, which the sub-agent finds and reads with its own web
  access; `attach_datasheet` records the link and the page. It reports each created part and
  that it is not verified.

## 5. Put the blocks together

1. Check each block against the plan: its ports are the plan's ports, every `part:` id is in
   `list_parts`, and its nets name only its own parts. Settle the sub-agents' questions, with the
   person where the answer is theirs, and update the plan when a port changes.
2. Write the board with **one** `new_circuit`: the blocks as `sheets`, one entry in `instances`
   for each use, and at the top level only the shared connectors and their nets. A port is
   connected to a top-level net in `connections`:

   ```
   new_circuit {
     file: "io.circuit.tsx", place: false,
     sheets: { Input: { … }, Power: { … }, Controller: { … }, Bus: { … } },
     instances: [
       { sheet: "Power", name: "PS1", connections: { VIN: "V24", V3_3: "V3_3", GND: "GND" } },
       { sheet: "Input", name: "CH1", connections: { IN: "IN1", OUT: "DI1", GND: "GND" } },
       { sheet: "Input", name: "CH2", connections: { IN: "IN2", OUT: "DI2", GND: "GND" } },
       … one line for each of the eight …
       { sheet: "Controller", name: "MCU1", connections: { V3_3: "V3_3", GND: "GND", DI1: "DI1", DI2: "DI2", … } }
     ],
     parts: [ { name: "J1", kind: "pinheader", props: { pinCount: 10 } } ],
     nets: { V24: ["J1.pin1"], GND: ["J1.pin2"], IN1: ["J1.pin3"], IN2: ["J1.pin4"], … }
   }
   ```

   An instance name and a net name are different words (`CH1`, not `IN1`).
3. `check_circuit` once. An error inside a block is the block's: correct the sheet and write the
   board again with `replace: true`, so every use gets the correction.
4. `set_project` with each block's status `designed`, then go on with SKILL.md at "Ask the
   person before the PCB". On the board, blocks first (`autoplace` and `autoroute` with
   `{ file, instance }`, `render` to look), then the whole board and the tracks between blocks:
   the order and the answers are in [copper.md](copper.md), "Placing and routing".

One more input later is one more instance (`edit_circuit` with `add_instance`), not eight more
parts.
