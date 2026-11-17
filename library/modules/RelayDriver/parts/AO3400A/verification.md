# Verification of AO3400A 30 V N-channel MOSFET, RDS(on) < 48 mOhm at VGS 2.5 V

Status: not verified
Content: 1d54e3b56f51 (changes when part.yaml changes)

Check each item against the datasheet and write the page next to it. When everything is
checked, run in a terminal: copperflow parts verify AO3400A --by "<your name>" --against "<datasheet, revision, page>"

- [ ] Pins from AO3400A datasheet, page(s) 1 (SOT23 pin drawing), 2 (VGS(th), RDS(on)): compare each pin
- [ ] Pin 1 is G (input)
- [ ] Pin 2 is S (passive)
- [ ] Pin 3 is D (passive)
- [ ] Footprint sot23 matches the package drawing
- [ ] lcsc part C20917 is this exact part

## Where each item was read

AO3400A datasheet, Rev 3.1, July 2023: https://www.aosmd.com/res/datasheets/AO3400A.pdf

- Page 1: SOT23, top-view drawing with G and S on the row of two pins and D alone; pin numbers 1 G, 2 S, 3 D
  follow the usual SOT23 numbering of that drawing; compare it.
- Page 1: VDS 30 V, VGS +/-12 V, ID 5.7 A at 25 C.
- Page 2: VGS(th) 0.65 / 1.05 / 1.45 V (min / typ / max) at VDS = VGS, ID 250 uA;
  RDS(on) max 26.5 mOhm at VGS 10 V, 32 mOhm at 4.5 V, 48 mOhm at VGS 2.5 V, ID 3 A.
