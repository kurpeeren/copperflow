# Project

## Intent

A small USB-C power board: 5 V from any USB-C charger in, 3.3 V out at up to 600 mA for breadboard and sensor projects. Power-only USB-C (5.1k CC pull-downs), a B5819W Schottky against back-feeding, an AP2112K-3.3 LDO with 10 uF + 1 uF in and 1 uF out, a power LED, a 2-pin 3V3 header and a 3-pin 5V/3V3/GND header, four M3 holes, ground pours on both sides, a logo and the board name on the silkscreen. 34 x 22 mm, two layers, JLCPCB rules.

## Blocks

- USB-C input: Power-only receptacle, 5.1k CC pull-downs, B5819W Schottky, 10 uF + 1 uF in (routed)
- 3.3 V regulator: AP2112K-3.3 LDO, EN tied to VIN, 1 uF out (routed)
- Outputs: Power LED with 1k, 2-pin 3V3 header, 3-pin 5V/3V3/GND header (routed)

## Decisions

- 2026-11-19 Power-only USB-C: the data and SBU pins are marked no-connect; a 3-pin 5V/3V3/GND header replaces the planned I2C header, since nothing on the board drives SDA or SCL.

## Open

- Verify AP2112K-3.3 and TYPE-C-16P against their datasheets (verification.md)
- Add LCSC numbers for the passives and headers before ordering assembly

