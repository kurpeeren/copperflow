Design an eight-channel 24 V digital input board with copperflow.

- 24 V field signals come in on a 10-pin 2.54 mm terminal header: IN1..IN8, 24 V and GND.
- Every input has the same block: a 47 k / 10 k divider, a 3.6 V zener clamp (SOD-123) across the lower resistor, and an RC filter (1 k, 100 nF) to the output.
- All eight inputs are alike: draw the block once and use it eight times.
- The eight outputs and GND go to a 10-pin 2.54 mm header for the controller board (DI1..DI8, GND, and one pin left free).
- 0603 passives, two layers, the channels side by side.

Nobody is here to answer questions: take your default for each one, write it under Open, and build the board through to the fabrication files.
