# Verification of MCP2515 stand-alone CAN controller with SPI

Status: not verified
Content: ce631ee2c399 (changes when part.yaml changes)

Check each item against the datasheet and write the page next to it. When everything is
checked, run in a terminal: copperflow parts verify MCP2515 --by "<your name>" --against "<datasheet, revision, page>"

- [ ] Pin 1 is TXCAN (output)
- [ ] Pin 2 is SOF_CLKOUT (output)
- [ ] Pin 3 is TX0RTS (input)
- [ ] Pin 4 is TX1RTS (input)
- [ ] Pin 5 is TX2RTS (input)
- [ ] Pin 6 is OSC2 (output)
- [ ] Pin 7 is OSC1 (input)
- [ ] Pin 8 is VSS (ground)
- [ ] Pin 9 is RX0BF (bidirectional)
- [ ] Pin 10 is RX1BF (bidirectional)
- [ ] Pin 11 is INT (output)
- [ ] Pin 12 is SCK (input)
- [ ] Pin 13 is SI (input)
- [ ] Pin 14 is SO (output)
- [ ] Pin 15 is CS (input)
- [ ] Pin 16 is RESET (input)
- [ ] Pin 17 is VDD (power in)
- [ ] Pin 18 is RXCAN (input)
- [ ] Footprint soic18w matches the package drawing

## Notes

- [ ] Compare the pads with the land pattern in the maker's datasheet; this package's outline was not taken from the drawing.
