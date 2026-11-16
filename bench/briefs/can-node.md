Design a CAN bus node board with copperflow.

- MCP2515 CAN controller (SOIC-18) and TJA1051T/3 transceiver (SOIC-8), the MCP2515 on 3.3 V; the TJA1051T/3 has a VIO pin, tie it to 3.3 V and its VCC to 5 V.
- 8 MHz crystal (HC-49 SMD or 3225) on OSC1/OSC2 with two 18 pF load capacitors.
- A 7-pin 2.54 mm SPI header for the host: 5 V, 3.3 V, GND, SCK, MOSI, MISO, CS; bring INT out on a separate 1-pin header.
- A 3-pin bus header: CANH, CANL, GND.
- A 120 ohm termination resistor between CANH and CANL through a 2-pin jumper, so it can be left off.
- 100 nF decoupling at every supply pin, plus a 10 kOhm pull-up on RESET.
- Two layers, as small as is easy to route.

Nobody is here to answer questions: take your default for each one, write it under Open, and build the board through to the fabrication files.
