# Project

## Intent

Example: a 24 V relay coil driver built by hand, once on perfboard and once on stripboard. An NPN (TO-92) switches the coil from a logic input through a 4.7k base resistor, with a 10k pull-down, a flyback diode across the coil terminals and an LED with a 10k resistor that lights while the coil is driven. J1 brings 24 V and ground, J2 the logic input, J3 goes to the relay coil.

Both circuits were written with `new_circuit` (board kind perfboard or stripboard), placed onto the holes, routed with `autoroute` and checked; `*-build.md` is `export { as: "build" }` without its pictures (run it again for them).

## Blocks

- Driver: Q1, R1, R2 (routed)
- Coil and indicator: J3, D1, R3, D2 (routed)
- Inputs: J1 V24/GND, J2 CTRL/GND (routed)

## Decisions

- 2026-11-24 Built-in parts only, on 2.54 mm footprints: `axial6.3x10.16` resistors, `axial4x10.16` diode, `to92`, `led5mm`, `screw2` terminals at 5.08 mm, a 2-pin header.

## Open

- No part numbers: choose the transistor (for example a 2N2222 or BC337 for coils up to about 100 mA), the diode (1N4148 or 1N4007) and the LED, and check the TO-92 pin order of the chosen transistor against Q1's pins 1 E, 2 B, 3 C before building
- R1 4.7k gives about 5 mA of base current from a 24 V signal and about 0.55 mA from 3.3 V logic; check it against the coil current and the transistor's gain
