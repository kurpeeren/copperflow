# Project

## Intent

Example: a 12 V relay with a changeover contact, switched by a logic signal (0 off, 3.3 V or 5 V fully on, open input off), an LED on while driven. One RelayDriver module, headers for supply, control and the contacts.

## Blocks

- RelayDriver: x1: library module RelayDriver; ports V12, GND, CTRL, COM, NO, NC (routed)
- Headers: J1 V12/GND, J2 CTRL/GND (2.54 mm), J3 NC/COM/NO (5.08 mm) (routed)

## Decisions

- 2026-11-17 Switch: AO3400A (LCSC C20917). Source: https://www.aosmd.com/res/datasheets/AO3400A.pdf page 2: VGS(th) 0.65 to 1.45 V, RDS(on) < 48 mOhm at VGS 2.5 V, ID 3 A. Driven at 3.3 V it is over the 2.5 V point the datasheet guarantees; 30 mA coil gives 1.4 mV across it. 100 ohm gate resistor, 100k pull-down holds it off when CTRL is open.
- 2026-11-17 Relay: Songle SRD-12VDC-SL-C (LCSC C30431). Source: https://www.circuitbasics.com/wp-content/uploads/2015/11/SRD-05VDC-SL-C-Datasheet.pdf page 2: 12 V coil 400 ohm, 30 mA, 0.36 W; contacts form C 10 A 125 VAC / 28 VDC, 7 A 240 VAC. Page 1: drilling drawing (12.2 mm, 2 mm, 12 mm, 1.4 mm) and wiring diagram.
- 2026-11-17 Flyback: 1N4148W-7-F (Diodes Inc DS30086, SOD123, page 1). LED: Kingbright APTD1608LZGCK green, VF 2.65 V typ at 2 mA (datasheet page 2); 4.7k from 12 V gives (12 - 2.65) / 4.7k = 2.0 mA.
- 2026-11-17 Contact nets COM, NO, NC are the net class contact in rules.yaml: 1.5 mm tracks, 1.0 mm clearance. Source for width: IPC-2221 as in design-rules.md.

## Open

- RelayDriver is NOT verified: check it, then copperflow modules verify RelayDriver --by <name>
- SRD-12VDC-SL-C is NOT verified. Its pads come from the drilling drawing on page 1 of the Songle datasheet, read as the bottom view; the datasheet does not say which view it is. If it is the top view, NO and NC are swapped. Check against a relay in hand before the first order
- SRD-12VDC-SL-C: the datasheet gives no hole size; 1.3 mm drill and 2.5 mm pads were chosen for the 1.1 x 0.4 mm leads
- AO3400A is NOT verified: compare pins 1 G, 2 S, 3 D with page 1 of its datasheet
- Contact tracks are 1.5 mm wide in 1 oz copper: about 4 A for a 20 C rise and 3 A for 10 C by IPC-2221; the relay itself is rated 10 A. Wider copper or a solder-thickened track is needed for more
- Clearance: 1.0 mm from the contact nets to everything else. Mains voltage needs far more (creepage and clearance by the applicable standard, typically 2.5 mm or more for 230 VAC functional insulation and 6 mm or more with slots for reinforced). This board is for low voltage loads only
- J3 is a 5.08 mm pin row standing in for a screw terminal: replace it with the terminal you will use
- No LCSC numbers for D1 and LED1 (only manufacturer part numbers); resistors carry no part numbers

