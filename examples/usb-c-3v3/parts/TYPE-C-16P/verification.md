# Verification of USB Type-C receptacle, 16 pins (USB 2.0), mid-mount

Status: not verified
Content: 6c4662f935d3 (changes when part.yaml changes)

Check each item against the datasheet and write the page next to it. When everything is
checked, run in a terminal: copperflow parts verify TYPE-C-16P --by "<your name>" --against "<datasheet, revision, page>"

- [ ] Pin 1 is GND1 (ground)
- [ ] Pin 2 is VBUS1 (power out)
- [ ] Pin 3 is SBU2 (passive)
- [ ] Pin 4 is CC1 (bidirectional)
- [ ] Pin 5 is DN2 (passive)
- [ ] Pin 6 is DP1 (passive)
- [ ] Pin 7 is DN1 (passive)
- [ ] Pin 8 is DP2 (passive)
- [ ] Pin 9 is SBU1 (passive)
- [ ] Pin 10 is CC2 (bidirectional)
- [ ] Pin 11 is VBUS2 (power out)
- [ ] Pin 12 is GND2 (ground)
- [ ] Pin 13 is SHIELD (passive)
- [ ] Footprint usb_c16 matches the package drawing
- [ ] lcsc part C165948 is this exact part
