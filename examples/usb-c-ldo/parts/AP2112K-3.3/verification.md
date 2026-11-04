# Verification of AP2112K-3.3 LDO regulator, 600 mA

Status: not verified
Content: 03a68af9b35d (changes when part.yaml changes)

Check each item against the datasheet and write the page next to it. When everything is
checked, run in a terminal: copperflow parts verify AP2112K-3.3 --by "<your name>" --against "<datasheet, revision, page>"

- [ ] Pin 1 is VIN (power in)
- [ ] Pin 2 is GND (ground)
- [ ] Pin 3 is EN (input)
- [ ] Pin 4 is NC (no connect)
- [ ] Pin 5 is VOUT (power out)
- [ ] Footprint sot23_5 matches the package drawing
- [ ] jlcpcb part C51118 is this exact part
