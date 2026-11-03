# Starter design rules

A short, conservative set. The datasheet of the part always wins over these rules.
Each rule names its source; contributions should do the same.

## Decoupling

- Place each IC's decoupling capacitors as close to its supply pins as the layout allows,
  with the shortest possible return path to ground.
- Use the values the datasheet recommends. For example, the AP2112K regulator datasheet
  recommends 1 µF ceramic capacitors on the input and output.

Source: device datasheets; H. W. Ott, *Electromagnetic Compatibility Engineering*, Wiley, 2009,
chapter on digital circuit power distribution.

## Trace width for current

IPC-2221 gives a first estimate of the cross-section a trace needs:

    I = k · ΔT^0.44 · A^0.725

I is current in amperes, ΔT the allowed temperature rise in °C, A the cross-section in square
mils, and k = 0.048 for outer layers or 0.024 for inner layers. Width = A / thickness, where
1 oz copper is about 1.378 mil thick.

Example: 0.6 A on an outer layer with a 10 °C rise needs about 8 mil², which is about 6 mil
(0.15 mm) wide in 1 oz copper. Power traces are usually made wider than this minimum.

IPC-2152 replaces the IPC-2221 charts with more detailed data; use it when the margin is small.

Source: IPC-2221, *Generic Standard on Printed Board Design*; IPC-2152, *Standard for
Determining Current Carrying Capacity in Printed Board Design*.

## USB-C power sink

- A device that only takes power (a sink) needs a separate 5.1 kΩ pull-down (Rd) from each CC
  pin to ground. Do not share one resistor between CC1 and CC2.
- Without Rd, a USB-C source does not turn on VBUS.

Source: USB Type-C Cable and Connector Specification, USB Implementers Forum.

## Enable pins and indicators

- Do not leave enable pins floating; tie them to the level the datasheet requires.
- An indicator LED needs a series resistor: R = (V_supply − V_f) / I. For a red LED
  (V_f about 2 V) on 3.3 V, 1 kΩ gives about 1.3 mA, which is enough for an indicator.

Source: device datasheets.

## Placement

- Part courtyards must not overlap. tscircuit skips autorouting when they do, so build after
  every placement change.

Source: tscircuit build output; IPC-7351, *Generic Requirements for Surface Mount Design and
Land Pattern Standard*, for courtyard definitions.
