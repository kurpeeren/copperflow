# Draws the KiCad import fixtures from scratch through pcbnew: every footprint and pad is defined here, none is loaded from KiCad's libraries.
# Run with KiCad's own Python: "C:\Program Files\KiCad\10.0\bin\python.exe" make_fixtures.py <out folder> [trial]
# It writes <name>.kicad_pcb (saved by KiCad) and <name>.pads.json: every pad's place, size, drill and net as pcbnew reports them.
# older-v6.kicad_pcb is written by hand in the layout KiCad 6 saved (its footprints, pads and shapes are made up too);
# older-v6.pads.json is what pcbnew reads from it ("pads" below).
import json
import math
import os
import sys

import pcbnew

MM = pcbnew.FromMM


def point(x, y):
    return pcbnew.VECTOR2I(MM(x), MM(y))


def add_net(board, name):
    net = pcbnew.NETINFO_ITEM(board, name)
    board.Add(net)
    return net


def pad(fp, number, shape, x, y, w, h, kind="smd", drill=None, angle=0, function=None):
    p = pcbnew.PAD(fp)
    p.SetNumber(number)
    p.SetShape(shape)
    p.SetSize(point(w, h))
    p.SetPosition(point(0, 0))
    if kind == "smd":
        p.SetAttribute(pcbnew.PAD_ATTRIB_SMD)
        p.SetLayerSet(pcbnew.PAD.SMDMask())
    elif kind == "npth":
        p.SetAttribute(pcbnew.PAD_ATTRIB_NPTH)
        p.SetLayerSet(pcbnew.PAD.UnplatedHoleMask())
        p.SetDrillSize(point(drill, drill))
    else:
        p.SetAttribute(pcbnew.PAD_ATTRIB_PTH)
        p.SetLayerSet(pcbnew.PAD.PTHMask())
        p.SetDrillSize(point(drill, drill))
    if function:
        p.SetPinFunction(function)
    fp.Add(p)
    p.SetFPRelativePosition(point(x, y))
    p.SetFPRelativeOrientation(pcbnew.EDA_ANGLE(angle, pcbnew.DEGREES_T))
    return p


def footprint(board, ref, value, name, x, y, angle, bottom, pads):
    fp = pcbnew.FOOTPRINT(board)
    fp.SetReference(ref)
    fp.SetValue(value)
    fp.SetFPID(pcbnew.LIB_ID("fixture", name))
    board.Add(fp)
    for spec in pads:
        pad(fp, *spec[0], **spec[1])
    fp.SetPosition(point(x, y))
    fp.SetOrientationDegrees(angle)
    if bottom:
        fp.Flip(fp.GetPosition(), pcbnew.FLIP_DIRECTION_TOP_BOTTOM)
    return fp


def resistor(board, ref, value, x, y, angle=0, bottom=False):
    return footprint(board, ref, value, "R_fixture_1608", x, y, angle, bottom, [
        (("1", pcbnew.PAD_SHAPE_ROUNDRECT, -0.8, 0, 0.9, 1.0), {}),
        (("2", pcbnew.PAD_SHAPE_ROUNDRECT, 0.8, 0, 0.9, 1.0), {}),
    ])


def odd(board, ref, x, y, angle, bottom):
    # An asymmetric land pattern: three pads of different sizes, one turned, so any mirror or turn shows.
    return footprint(board, ref, "ODD3", "ODD3_fixture", x, y, angle, bottom, [
        (("1", pcbnew.PAD_SHAPE_RECT, -1.5, -1.0, 1.2, 0.6), {"function": "IN"}),
        (("2", pcbnew.PAD_SHAPE_OVAL, 1.5, -1.0, 0.6, 1.4), {"function": "OUT"}),
        (("3", pcbnew.PAD_SHAPE_CIRCLE, 0.4, 1.6, 0.8, 0.8), {"function": "GND"}),
        (("4", pcbnew.PAD_SHAPE_RECT, -0.6, 1.2, 0.5, 1.0), {"angle": 30}),
    ])


def connector(board, ref, x, y, angle):
    return footprint(board, ref, "CONN3", "CONN3_fixture", x, y, angle, False, [
        (("1", pcbnew.PAD_SHAPE_RECT, 0, 0, 1.7, 1.7), {"kind": "pth", "drill": 1.0}),
        (("2", pcbnew.PAD_SHAPE_OVAL, 2.54, 0, 1.7, 1.7), {"kind": "pth", "drill": 1.0}),
        (("3", pcbnew.PAD_SHAPE_OVAL, 5.08, 0, 1.7, 1.7), {"kind": "pth", "drill": 1.0}),
    ])


def mounting_hole(board, ref, x, y):
    return footprint(board, ref, "MH", "MH_fixture", x, y, 0, False, [
        (("", pcbnew.PAD_SHAPE_CIRCLE, 0, 0, 3.2, 3.2), {"kind": "npth", "drill": 3.2}),
    ])


def edge_line(board, a, b):
    s = pcbnew.PCB_SHAPE(board)
    s.SetShape(pcbnew.SHAPE_T_SEGMENT)
    s.SetStart(point(*a))
    s.SetEnd(point(*b))
    s.SetLayer(pcbnew.Edge_Cuts)
    s.SetWidth(MM(0.1))
    board.Add(s)


def edge_arc(board, centre, start, angle):
    s = pcbnew.PCB_SHAPE(board)
    s.SetShape(pcbnew.SHAPE_T_ARC)
    s.SetCenter(point(*centre))
    s.SetStart(point(*start))
    s.SetArcAngleAndEnd(pcbnew.EDA_ANGLE(angle, pcbnew.DEGREES_T), True)
    s.SetLayer(pcbnew.Edge_Cuts)
    s.SetWidth(MM(0.1))
    board.Add(s)


def rounded_outline(board, x0, y0, x1, y1, r):
    edge_line(board, (x0 + r, y0), (x1 - r, y0))
    edge_line(board, (x1, y0 + r), (x1, y1 - r))
    edge_line(board, (x1 - r, y1), (x0 + r, y1))
    edge_line(board, (x0, y1 - r), (x0, y0 + r))
    edge_arc(board, (x1 - r, y0 + r), (x1 - r, y0), 90)
    edge_arc(board, (x1 - r, y1 - r), (x1, y1 - r), 90)
    edge_arc(board, (x0 + r, y1 - r), (x0 + r, y1), 90)
    edge_arc(board, (x0 + r, y0 + r), (x0, y0 + r), 90)


def track(board, net, a, b, width=0.25, layer=pcbnew.F_Cu):
    t = pcbnew.PCB_TRACK(board)
    t.SetStart(point(*a))
    t.SetEnd(point(*b))
    t.SetWidth(MM(width))
    t.SetLayer(layer)
    t.SetNet(net)
    board.Add(t)


def arc_track(board, net, a, mid, b, width=0.25, layer=pcbnew.F_Cu):
    t = pcbnew.PCB_ARC(board)
    t.SetStart(point(*a))
    t.SetMid(point(*mid))
    t.SetEnd(point(*b))
    t.SetWidth(MM(width))
    t.SetLayer(layer)
    t.SetNet(net)
    board.Add(t)


def via(board, net, at, size=0.6, drill=0.3):
    v = pcbnew.PCB_VIA(board)
    v.SetPosition(point(*at))
    v.SetWidth(MM(size))
    v.SetDrill(MM(drill))
    v.SetNet(net)
    board.Add(v)


def zone(board, net, layer, corners):
    z = pcbnew.ZONE(board)
    z.SetLayer(layer)
    z.SetNet(net)
    outline = z.Outline()
    outline.NewOutline()
    for c in corners:
        outline.Append(MM(c[0]), MM(c[1]))
    board.Add(z)
    return z


def connect(fp, number, net):
    for p in fp.Pads():
        if p.GetNumber() == number:
            p.SetNet(net)


def pads_json(board):
    rows = []
    for fp in board.GetFootprints():
        for p in fp.Pads():
            pos = p.GetPosition()
            size = p.GetSize()
            drill = p.GetDrillSize()
            rows.append({
                "ref": fp.GetReference(),
                "number": p.GetNumber(),
                "x": pcbnew.ToMM(pos.x),
                "y": pcbnew.ToMM(pos.y),
                "angle": p.GetOrientation().AsDegrees(),
                "width": pcbnew.ToMM(size.x),
                "height": pcbnew.ToMM(size.y),
                "drill": pcbnew.ToMM(drill.x) if p.GetAttribute() in (pcbnew.PAD_ATTRIB_PTH, pcbnew.PAD_ATTRIB_NPTH) else 0,
                "plated": p.GetAttribute() != pcbnew.PAD_ATTRIB_NPTH,
                "bottom": fp.IsFlipped(),
                "net": p.GetNetname(),
            })
    return rows


def fixture_board():
    board = pcbnew.BOARD()
    gnd = add_net(board, "GND")
    vcc = add_net(board, "VCC")
    sig = add_net(board, "Net-(R1-Pad2)")
    out = add_net(board, "OUT_A")
    rounded_outline(board, 100, 100, 150, 140, 3)
    r1 = resistor(board, "R1", "10k", 110, 108)
    r2 = resistor(board, "R2", "10k", 110, 114, 90)
    r3 = resistor(board, "R3", "1k", 120, 108, 0, True)
    turns = [(0, False), (90, False), (180, False), (270, False), (45, False), (0, True), (90, True), (180, True), (270, True), (45, True)]
    odds = [odd(board, f"U{i + 1}", 112 + (i % 5) * 7, 122 + (i // 5) * 9, a, b) for i, (a, b) in enumerate(turns)]
    j1 = connector(board, "J1", 140, 106, 90)
    mounting_hole(board, "H1", 104, 136)
    connect(r1, "1", vcc)
    connect(r1, "2", sig)
    connect(r2, "1", sig)
    connect(r2, "2", gnd)
    connect(r3, "1", vcc)
    connect(r3, "2", out)
    connect(odds[0], "1", sig)
    connect(odds[0], "2", out)
    for u in odds:
        connect(u, "3", gnd)
    connect(j1, "1", vcc)
    connect(j1, "2", gnd)
    track(board, vcc, (109.2, 108), (109.2, 105))
    track(board, vcc, (109.2, 105), (140, 105))
    arc_track(board, sig, (110.8, 108), (111.5, 109.2), (110.8, 110.4))
    via(board, gnd, (130, 112))
    track(board, gnd, (130, 112), (140, 108.54), 0.4, pcbnew.B_Cu)
    zone(board, gnd, pcbnew.B_Cu, [(101, 101), (149, 101), (149, 139), (101, 139)])
    return board


def save(board, folder, name):
    path = os.path.join(folder, name + ".kicad_pcb")
    pcbnew.SaveBoard(path, board)
    with open(os.path.join(folder, name + ".pads.json"), "w", newline="\n") as f:
        json.dump(pads_json(pcbnew.LoadBoard(path)), f, indent=1)
        f.write("\n")


if __name__ == "__main__":
    if sys.argv[1] == "pads":
        # The pads of a board written by hand (older-v6.kicad_pcb), as pcbnew reads them: python make_fixtures.py pads <board> <out.json>
        # pcbnew refuses the made-up (mystery_token …) lines the file holds to test what copperflow skips; read it without them.
        with open(sys.argv[2]) as f:
            text = "".join(line for line in f if "mystery_token" not in line)
        copy = sys.argv[3] + ".kicad_pcb"
        with open(copy, "w", newline="\n") as f:
            f.write(text)
        board = pcbnew.LoadBoard(copy)
        os.remove(copy)
        with open(sys.argv[3], "w", newline="\n") as f:
            json.dump(pads_json(board), f, indent=1)
            f.write("\n")
    else:
        save(fixture_board(), sys.argv[1], "fixture")
