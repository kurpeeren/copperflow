Design a relay driver module.

- Supply: 12 V on a 2-pin header (12 V and ground). The relay's coil is 12 V.
- Control input: one logic signal on a 2-pin header (signal and ground). Logic 0 switches the relay off; both 3.3 V
  and 5 V logic must switch it on fully.
- An open control input must leave the relay off.
- One relay with a changeover contact, its three contact pins on a 3-pin header (5.08 mm pitch if you have it).
- An LED that is on while the relay is driven.
- Two layers, small parts are fine (0603), as small a board as it routes.

Before you choose parts, look up how such a driver is usually built and write the sources down.

Nobody is here to answer questions: take your default for each one, write it under Open, and build the board through to the fabrication files.
