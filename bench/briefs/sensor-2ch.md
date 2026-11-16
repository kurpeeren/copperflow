Design a two-channel analog sensor board with copperflow.

- A small controller, ATtiny1616-SSFR (SOIC-20), reads two analog sensors on two ADC pins.
- Each sensor comes in on its own 3-pin 2.54 mm header (3.3 V, signal, GND) and goes through the same RC filter (10 k, 100 nF) to the controller: one block used twice.
- An MCP1700-3302E/TT regulator (SOT-23) makes 3.3 V from 5 V that comes in on a 2-pin header, with 1 uF on its input and output.
- A 3-pin UPDI programming header (UPDI, 3.3 V, GND) and 100 nF decoupling at the controller.
- 0603 passives, two layers.

Nobody is here to answer questions: take your default for each one, write it under Open, and build the board through to the fabrication files.
