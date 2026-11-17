# Verification of Songle SRD relay, 12 V coil (400 ohm, 30 mA), SPDT changeover, 10 A

Status: not verified
Content: f28d0a70ada2 (changes when part.yaml or footprint.yaml changes)

Check each item against the datasheet and write the page next to it. When everything is
checked, run in a terminal: copperflow parts verify SRD-12VDC-SL-C --by "<your name>" --against "<datasheet, revision, page>"

- [ ] Pins from Songle Relay SRD datasheet, page(s) 1 (DRILLING and WIRING DIAGRAM), 2 (coil data, contact rating): compare each pin
- [ ] Pin 1 is COM (passive)
- [ ] Pin 2 is COIL1 (passive)
- [ ] Pin 3 is COIL2 (passive)
- [ ] Pin 4 is NO (passive)
- [ ] Pin 5 is NC (passive)
- [ ] Footprint footprint.yaml matches the package drawing
- [ ] Every pad in footprint.yaml matches the recommended land pattern (position, size, drill)
- [ ] lcsc part C30431 is this exact part
- [ ] Height 15.3 mm, p1, 5. DIMENSION, body 15.3 mm max: compare

## Where each item was read

Songle Relay SRD datasheet, 2 pages: https://www.circuitbasics.com/wp-content/uploads/2015/11/SRD-05VDC-SL-C-Datasheet.pdf
(the same 2-page sheet covers every SRD coil voltage; the LCSC copy for C30431 could not be opened).

- Page 1, DRILLING: common 1.4 mm in from the body edge on the centre line; coil pins 2 +/- 0.05 mm further in,
  12 +/- 0.05 mm apart (6 mm either side); contact pins 12.2 +/- 0.05 mm beyond the coil pins, 12 mm apart.
- Page 1, DIMENSION: body 19.1 x 15.5 mm max, 15.3 mm high; leads 1 x 0.4 mm (contacts) and 0.6 mm, 0.3 mm thick.
  No hole size is given: the 1.3 mm drill and 2.5 mm round pads are this part's choice, not the datasheet's.
- Page 1, WIRING DIAGRAM: coil between the two pins beside the common; the blade from the common rests on the
  contact on the side drawn at the bottom of the diagram (normally closed); the other contact is normally open.
- The datasheet does not say whether the drilling and wiring drawings are seen from the top or the bottom.
  They were read as the bottom view (the usual convention for a drilling plan) and mirrored: on this
  footprint (top view, common on the left) NC is pad 5 at y = +6 and NO is pad 4 at y = -6. If the drawing
  is a top view, NO and NC are swapped. Check with an ohmmeter on a relay in hand.
- Pin numbers 1 to 5 are this library's own; the datasheet numbers no pins.
- Page 2, COIL DATA: 12 V coil (high sensitivity, L, 0.36 W): 30 mA, 400 ohm +/- 10 %, pull-in 75 % max,
  drop-out 10 % min. CONTACT RATING (form C): 7 A 28 VDC, 10 A 125 VAC, 7 A 240 VAC resistive.
- Page 1, RATING: UL/CUL 10 A 125 VAC 28 VDC, TUV 10 A 240 VAC 28 VDC.
