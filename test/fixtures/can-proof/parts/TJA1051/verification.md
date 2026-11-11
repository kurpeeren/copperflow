# Verification of TJA1051 high-speed CAN transceiver with VIO

Status: not verified
Content: 4232c0d60fc7 (changes when part.yaml changes)

Check each item against the datasheet and write the page next to it. When everything is
checked, run in a terminal: copperflow parts verify TJA1051 --by "<your name>" --against "<datasheet, revision, page>"

- [ ] Pin 1 is TXD (input)
- [ ] Pin 2 is GND (ground)
- [ ] Pin 3 is VCC (power in)
- [ ] Pin 4 is RXD (output)
- [ ] Pin 5 is VIO (power in)
- [ ] Pin 6 is CANL (bidirectional)
- [ ] Pin 7 is CANH (bidirectional)
- [ ] Pin 8 is S (input)
- [ ] Footprint soic8 matches the package drawing
