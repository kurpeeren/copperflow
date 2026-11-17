# Project

## Intent

Example: eight 24 V digital inputs, each a DigitalInput24V module, from a 10-pin field header to a 10-pin controller header.

## Blocks

- DigitalInput24V: x8: library module; ports IN, OUT, GND (routed)
- Headers: J1 IN1..IN8, V24, GND (field); J2 DI1..DI8, GND, pin 10 free (controller) (routed)

## Decisions

- 2026-11-17 Divider 47k / 10k: 24 V gives 4.2 V unclamped, clamped by the zener to about 3.4 V; 15 V (type 1 on) gives 2.6 V, above 0.7 x 3.3 V; 5 V (off) gives 0.9 V. Input current (24 - 3.6) / 47k = 0.43 mA, zener current 0.43 - 0.36 = 0.07 mA.
- 2026-11-17 Zener: Diodes Inc BZT52C3V6-7-F, Source: https://www.diodes.com/assets/Datasheets/ds18004.pdf page 2: 3.4 to 3.8 V at 5 mA, SOD123. Filter: 1k with 100 nF behind the 8.2k divider source gives a time constant of 0.92 ms, about 170 Hz.
- 2026-11-17 Channels placed by hand in a row at 5.2 mm pitch, rotated alike, IN side towards J1 and OUT side towards J2; autoplace packed them closer and put the copies out of order.

- 2026-11-17 Divider changed to 4.53k / 1k (R1 a 1206): with 47k / 10k the zener got 0.24 mA and the simulator gave 2.24 V at 24 V, not 3.4 V.
- Now 3.07 to 3.45 V at 24 V (4.6 mA), high from 15 V and low at 5 V in both zener readings, at most 3.53 V at 30 V; the module's cases check it.

## Open

- DigitalInput24V is NOT verified: check it, then copperflow modules verify DigitalInput24V --by <name>
- J1 pin 9 (V24) is on the header as the brief asks but nothing on the board uses it; it is marked not connected
- Each input draws 4.6 mA at 24 V (5.9 mA at 30 V), within what IEC 61131-2 type 1 sensors supply; check the sensors in use
- The zener carries about 1.1 to 1.6 mA at 24 V, still below its 5 mA test current; the 24 V level depends on its knee (3.07 V with the datasheet's maximum impedance, 3.45 V with the typical curve)
- Silkscreen: eight silk-on-pad warnings remain: R2 names on the next channel's zener or own R1, and D801's name on R701's courtyard; one touches a zener pad; the channels are 5.2 mm apart
- J1 and J2 are 2.54 mm pin rows; a field connection usually wants a screw terminal

