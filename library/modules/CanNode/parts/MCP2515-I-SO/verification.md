# Verification of MCP2515 stand-alone CAN controller with SPI, SOIC-18 wide

Status: not verified
Content: 1cf0d2ad3ec8 (changes when part.yaml changes)

Check each item against the datasheet and write the page next to it. When everything is
checked, run in a terminal: copperflow parts verify MCP2515-I-SO --by "<your name>" --against "<datasheet, revision, page>"

- [ ] Pins from MCP2515 datasheet DS20001801J, page(s) 1 (18-lead SOIC pinout), 4 (Table 1-1 pinout description): compare each pin
- [ ] Pin 1 is TXCAN (output)
- [ ] Pin 2 is RXCAN (input)
- [ ] Pin 3 is CLKOUT (output)
- [ ] Pin 4 is TX0RTS (input)
- [ ] Pin 5 is TX1RTS (input)
- [ ] Pin 6 is TX2RTS (input)
- [ ] Pin 7 is OSC2 (output)
- [ ] Pin 8 is OSC1 (input)
- [ ] Pin 9 is VSS (ground)
- [ ] Pin 10 is RX1BF (output)
- [ ] Pin 11 is RX0BF (output)
- [ ] Pin 12 is INT (output)
- [ ] Pin 13 is SCK (input)
- [ ] Pin 14 is SI (input)
- [ ] Pin 15 is SO (output)
- [ ] Pin 16 is CS (input)
- [ ] Pin 17 is RESET (input)
- [ ] Pin 18 is VDD (power in)
- [ ] Footprint soic18w matches the package drawing
- [ ] Height 2.65 mm, p82, 18-lead SOIC 7.50 mm body, overall height A max 2.65 mm: compare

## Notes

- [ ] Compare the pads with the land pattern in the maker's datasheet; this package's outline was not taken from the drawing.

## Where each item was read

MCP2515 datasheet DS20001801J: https://ww1.microchip.com/downloads/en/DeviceDoc/MCP2515-Stand-Alone-CAN-Controller-with-SPI-20001801J.pdf

- Page 1, Package Types, 18-lead PDIP/SOIC: pins 1 to 18.
- Page 4, Table 1-1 Pinout Description: names, PDIP/SOIC pin numbers and I/O types; TX0RTS to TX2RTS have
  100 k internal pull-ups to VDD.
- The pads are the generated soic18w land pattern (7.5 mm body, 1.27 mm pitch), not taken from Microchip's
  package drawing: compare them with the SO 18-lead drawing at the end of the datasheet.
