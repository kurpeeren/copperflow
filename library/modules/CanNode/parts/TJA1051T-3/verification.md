# Verification of TJA1051T/3 high-speed CAN transceiver with VIO, SO8

Status: not verified
Content: f4e84bf9c2e0 (changes when part.yaml changes)

Check each item against the datasheet and write the page next to it. When everything is
checked, run in a terminal: copperflow parts verify TJA1051T-3 --by "<your name>" --against "<datasheet, revision, page>"

- [ ] Pins from TJA1051 product data sheet Rev. 9, page(s) 4 (Table 3 pin description, Fig 2 pin configuration): compare each pin
- [ ] Pin 1 is TXD (input)
- [ ] Pin 2 is GND (ground)
- [ ] Pin 3 is VCC (power in)
- [ ] Pin 4 is RXD (output)
- [ ] Pin 5 is VIO (power in)
- [ ] Pin 6 is CANL (bidirectional)
- [ ] Pin 7 is CANH (bidirectional)
- [ ] Pin 8 is S (input)
- [ ] Footprint soic8 matches the package drawing

## Where each item was read

TJA1051 product data sheet, Rev. 9, 28 November 2017: https://www.nxp.com/docs/en/data-sheet/TJA1051.pdf

- Page 4, Fig 2 c (TJA1051T/3, SO8) and Table 3 Pin description: 1 TXD, 2 GND, 3 VCC, 4 RXD, 5 VIO
  (TJA1051T/3 and TJA1051TK/3 only), 6 CANL, 7 CANH, 8 S.
- Page 5: a LOW level on S selects Normal mode.
- The orderable number TJA1051T/3/1J was not found in this data sheet's text; check NXP's ordering page.
- The pads are the generated soic8 land pattern, not taken from NXP's SOT96-1 drawing.
