# Project

## Intent

Example: a CAN node for a 3.3 V host: one CanNode module (MCP2515 and TJA1051T/3), a 7-pin SPI header, INT on its own pin, a 3-pin bus header and a termination jumper.

## Blocks

- CanNode: x1: library module; ports V5, V3V3, GND, SCK, MOSI, MISO, CS, INT, CANH, CANL, TERM (routed)
- Headers: J1 V5 V3V3 GND SCK MOSI MISO CS; J2 INT; J3 CANH CANL GND; JP1 TERM to CANL (routed)

## Decisions

- 2026-11-17 MCP2515 pins: https://ww1.microchip.com/downloads/en/DeviceDoc/MCP2515-Stand-Alone-CAN-Controller-with-SPI-20001801J.pdf page 1 and page 4 Table 1-1. TXnRTS have 100k internal pull-ups and are left open with CLKOUT, RX0BF and RX1BF (flagged not connected).
- 2026-11-17 TJA1051T/3 pins: https://www.nxp.com/docs/en/data-sheet/TJA1051.pdf page 4 Table 3; VIO (pin 5) to 3.3 V, VCC to 5 V, S to GND selects Normal mode (page 5).
- 2026-11-17 Load capacitors: crystal CL 18 pF (Abracon ABL datasheet page 1). C = 2 x (CL - Cstray) = 2 x (18 - 5) = 26 pF, nearest E12 value 27 pF.

## Open

- CanNode is NOT verified: check it, then copperflow modules verify CanNode --by <name>
- MCP2515-I-SO and TJA1051T-3 are NOT verified: pins from the datasheets (MCP2515 page 4 Table 1-1, TJA1051 page 4 Table 3); the land patterns are generated soic18w and soic8, not taken from the makers' drawings
- Crystal ABL-8.000MHZ-B2 (Abracon ABL, CL 18 pF): check the ordering suffix for 18 pF load in Abracon's ordering table; the load capacitors assume about 5 pF of stray capacitance
- Close JP1 only on the two nodes at the ends of the bus
- No LCSC numbers on the ICs and the crystal: not found with certainty

