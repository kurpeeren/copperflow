# relay-perfboard: perfboard build sheet

Perfboard, 17 columns by 15 rows of 2.54 mm holes. Rows A–O run from the top, columns 1–17 from the left; the bottom picture is seen from below, so its columns run right to left.

## Parts

| Part | Value | Footprint | Holes (pin) |
| --- | --- | --- | --- |
| D1 | diode | axial4x10.16 | D12 (2), H12 (1) |
| D2 | led | led5mm | I14 (2), I15 (1) |
| J1 | connector | screw2 | D8 (2), D10 (1) |
| J2 | pinheader | pinrow2_p2.54mm | N11 (2), N12 (1) |
| J3 | connector | screw2 | D3 (2), D5 (1) |
| Q1 | transistor | to92 | H8 (1), H9 (2), H10 (3) |
| R1 | 4.7k | axial6.3x10.16 | K11 (2), K15 (1) |
| R2 | 10k | axial6.3x10.16 | J6 (2), J10 (1) |
| R3 | 10k | axial6.3x10.16 | C14 (1), G14 (2) |

## Links (top, 1)

| Link | Net | From | To | Length |
| --- | --- | --- | --- | --- |
| W1 | DRV | E10 | E3 | 17.8 mm |

## Solder runs (bottom, 14)

| Run | Net | Holes |
| --- | --- | --- |
| S1 | LEDA | I15 → H15 → G15 → G14 |
| S2 | BASE | H9 → I9 → I10 → J10 |
| S3 | BASE | J10 → J11 → K11 |
| S4 | CTRL | N12 → M12 → L12 → K12 → K13 → K14 → K15 |
| S5 | V24 | D12 → D11 → D10 |
| S6 | V24 | D12 → C12 → C13 → C14 |
| S7 | V24 | D10 → C10 → C9 → C8 → C7 → C6 → C5 → D5 |
| S8 | GND | D8 → E8 → F8 → G8 → H8 |
| S9 | GND | H8 → H7 → H6 → I6 → J6 |
| S10 | GND | H8 → I8 → J8 → J9 → K9 → K10 → L10 → L11 → M11 → N11 |
| S11 | DRV | H12 → H11 → H10 |
| S12 | DRV | H12 → H13 → H14 → I14 |
| S13 | DRV | H10 → G10 → F10 → E10 |
| S14 | DRV | E3 → D3 |

## Build order

1. Fit the links from the link list on the top, flat on the board, and solder them.
2. Fit the parts lowest first (resistors and diodes, then sockets and headers, then the rest) and solder their legs.
3. Make the solder runs on the bottom from hole to hole, along the list.
4. Check each net with a meter against the parts list before powering it.
