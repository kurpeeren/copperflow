// The hero's workshop: small agents carry parts from a tray onto a board, set each on its footprint, then walk the
// connections laying copper behind them, while a line below names the copperflow tool each step is. It plays while it
// is on screen, rests between rounds, and shows the finished board still for anyone who asks for less motion.
"use strict"
;(() => {
  const host = document.querySelector("[data-workshop]")
  if (!host) return
  const NS = "http://www.w3.org/2000/svg"
  const W = 640
  const H = 400
  /** Walking speed, in viewBox units per second. */
  const SPEED = 150
  /** How long a placed part settles, and the rest after a finished board, in ms. */
  const SETTLE_MS = 320
  const REST_MS = 3200
  const AGENT_COLOURS = ["#f0a04b", "#f2c200", "#e8e6df"]
  /** The agents are drawn larger than the parts they carry, so they read as characters at a glance. */
  const AGENT_SCALE = 1.4

  const el = (name, attrs = {}, parent) => {
    const node = document.createElementNS(NS, name)
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value))
    if (parent) parent.append(node)
    return node
  }

  // The board, in viewBox units: the parts' footprints and the connections between their pads.
  const BOARD = { x: 170, y: 46, w: 440, h: 300 }
  const PARTS = [
    { id: "J1", kind: "header", x: 572, y: 196, log: "place_part J1 (pin header)" },
    { id: "U1", kind: "chip", x: 400, y: 196, log: "place_part U1 (AP2112K-3.3)" },
    { id: "C1", kind: "cap", x: 300, y: 120, log: "place_part C1 (1 uF)" },
    { id: "C2", kind: "cap", x: 300, y: 272, log: "place_part C2 (1 uF)" },
    { id: "R1", kind: "res", x: 486, y: 104, log: "place_part R1 (1k)" },
    { id: "D1", kind: "led", x: 486, y: 290, log: "place_part LED1 (green)" },
    { id: "J2", kind: "usb", x: 212, y: 196, log: "place_part J2 (USB-C)" },
  ]
  /** Each connection as the points a track takes, pad to pad, at 45 degrees. */
  const TRACKS = [
    [[230, 184], [262, 152], [288, 120]],
    [[312, 120], [352, 160], [372, 180]],
    [[230, 208], [262, 240], [288, 272]],
    [[312, 272], [352, 232], [372, 212]],
    [[428, 180], [470, 138], [474, 104]],
    [[498, 104], [544, 150], [560, 178]],
    [[428, 212], [470, 254], [474, 290]],
    [[498, 290], [544, 244], [560, 214]],
  ]
  const TRAY = { x: 26, y: 70, w: 98, h: 260 }
  const STEPS_LOG = {
    start: "new_circuit usb-c-3v3.circuit.tsx",
    route: (n) => `autoroute: Routing ${n} of ${TRACKS.length} connections`,
    done: "check_circuit: 0 errors, 0 warnings",
  }

  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, class: "workshop-scene", role: "img", "aria-label": "Small agents carry a USB-C socket, a regulator, capacitors, a resistor, an LED and a pin header from a tray onto a circuit board, then walk the connections laying copper tracks." })
  const defs = el("defs", {}, svg)
  const glow = el("filter", { id: "ws-glow", x: "-50%", y: "-50%", width: "200%", height: "200%" }, defs)
  el("feGaussianBlur", { stdDeviation: 2.2 }, glow)

  // The tray and the board.
  el("rect", { x: TRAY.x, y: TRAY.y, width: TRAY.w, height: TRAY.h, rx: 10, class: "ws-tray" }, svg)
  // The tray's dividers sit between its four rows of parts (shelfOf).
  for (let k = 0; k < 3; k++) el("line", { x1: TRAY.x + 10, x2: TRAY.x + TRAY.w - 10, y1: TRAY.y + 65 + k * 62, y2: TRAY.y + 65 + k * 62, class: "ws-tray-rule" }, svg)
  el("rect", { x: BOARD.x, y: BOARD.y, width: BOARD.w, height: BOARD.h, rx: 14, class: "ws-board" }, svg)
  for (const [cx, cy] of [[BOARD.x + 20, BOARD.y + 20], [BOARD.x + BOARD.w - 20, BOARD.y + 20], [BOARD.x + 20, BOARD.y + BOARD.h - 20], [BOARD.x + BOARD.w - 20, BOARD.y + BOARD.h - 20]]) {
    el("circle", { cx, cy, r: 9, class: "ws-hole" }, svg)
  }
  const trayLayer = el("g", {}, svg)
  const tracksLayer = el("g", {}, svg)
  const footprintLayer = el("g", {}, svg)
  const partsLayer = el("g", {}, svg)
  const agentsLayer = el("g", {}, svg)
  const log = el("text", { x: BOARD.x, y: H - 18, class: "ws-log" }, svg)

  /** A part's body and its pads, drawn around (0, 0). */
  function drawPart(kind, parent) {
    const g = el("g", {}, parent)
    const body = (w, h, cls) => el("rect", { x: -w / 2, y: -h / 2, width: w, height: h, rx: 2, class: cls }, g)
    if (kind === "chip") {
      for (const dy of [-16, 0, 16]) el("rect", { x: -32, y: dy - 3, width: 8, height: 6, class: "ws-pin" }, g)
      for (const dy of [-16, 16]) el("rect", { x: 24, y: dy - 3, width: 8, height: 6, class: "ws-pin" }, g)
      body(48, 52, "ws-chip")
      el("circle", { cx: -14, cy: -18, r: 2.5, class: "ws-dot" }, g)
    } else if (kind === "header") {
      body(22, 62, "ws-header")
      for (const dy of [-20, 0, 20]) el("circle", { cx: 0, cy: dy, r: 5, class: "ws-pin" }, g)
    } else if (kind === "usb") {
      body(30, 50, "ws-usb")
      el("rect", { x: -9, y: -16, width: 18, height: 32, rx: 7, class: "ws-usb-mouth" }, g)
    } else {
      for (const dx of [-12, 12]) el("rect", { x: dx - 4, y: -6, width: 8, height: 12, class: "ws-pin" }, g)
      body(18, 10, kind === "res" ? "ws-res" : kind === "led" ? "ws-led" : "ws-cap")
    }
    return g
  }

  /** The silkscreen outline a part is placed on. */
  function drawFootprint(part) {
    const size = { chip: [76, 64], header: [30, 72], usb: [40, 60], res: [40, 20], cap: [40, 20], led: [40, 20] }[part.kind]
    el("rect", { x: part.x - size[0] / 2, y: part.y - size[1] / 2, width: size[0], height: size[1], rx: 3, class: "ws-silk" }, footprintLayer)
  }

  /** A little agent: a rounded body with a visor, an antenna and two legs; it carries what it holds above its head. */
  function makeAgent(colour) {
    const g = el("g", { class: "ws-agent" }, agentsLayer)
    const figure = el("g", { transform: `scale(${AGENT_SCALE})` }, g)
    const legs = el("g", { class: "ws-legs" }, figure)
    el("line", { x1: -4, y1: 8, x2: -5, y2: 15, class: "ws-leg" }, legs)
    el("line", { x1: 4, y1: 8, x2: 5, y2: 15, class: "ws-leg ws-leg-b" }, legs)
    el("rect", { x: -10, y: -9, width: 20, height: 18, rx: 7, fill: colour, class: "ws-body" }, figure)
    el("rect", { x: -6, y: -4, width: 12, height: 5, rx: 2.5, class: "ws-visor" }, figure)
    el("line", { x1: 0, y1: -9, x2: 0, y2: -15, class: "ws-antenna", stroke: colour }, figure)
    el("circle", { cx: 0, cy: -16, r: 2.2, fill: colour, class: "ws-tip" }, figure)
    const hands = el("g", { transform: `translate(0 ${-27 * AGENT_SCALE})` }, g)
    return { g, hands, x: TRAY.x + TRAY.w / 2, y: TRAY.y + TRAY.h + 30, busy: false }
  }

  const place = (agent) => agent.g.setAttribute("transform", `translate(${agent.x.toFixed(1)} ${agent.y.toFixed(1)})`)
  const walking = (agent, on) => agent.g.classList.toggle("walking", on)

  /** Moves an agent to (x, y) at walking speed; `onStep` hears the fraction done each frame. */
  function walk(agent, x, y, onStep) {
    const from = { x: agent.x, y: agent.y }
    const ms = (Math.hypot(x - from.x, y - from.y) / SPEED) * 1000
    walking(agent, true)
    return tween(ms, (t) => {
      agent.x = from.x + (x - from.x) * t
      agent.y = from.y + (y - from.y) * t + Math.sin(t * Math.PI * 6) * 0.8
      place(agent)
      onStep?.(t)
    }).then(() => {
      agent.y = y
      place(agent)
      walking(agent, false)
    })
  }

  // Time runs only while the scene is on screen and the tab is in front; a paused clock holds every tween.
  let clock = 0
  let last
  let running = false
  const waiting = new Set()
  function frame(now) {
    if (!running) return
    if (last !== undefined) clock += Math.min(now - last, 64)
    last = now
    for (const job of [...waiting]) job()
    requestAnimationFrame(frame)
  }
  function tween(ms, step) {
    const start = clock
    return new Promise((done) => {
      const job = () => {
        const t = ms <= 0 ? 1 : Math.min(1, (clock - start) / ms)
        step(t)
        if (t >= 1) {
          waiting.delete(job)
          done()
        }
      }
      waiting.add(job)
    })
  }
  const wait = (ms) => tween(ms, () => {})
  function setRunning(on) {
    if (on === running) return
    running = on
    last = undefined
    if (on) requestAnimationFrame(frame)
  }

  const say = (text) => {
    log.textContent = text
  }

  /** One agent fetches one part from the tray and sets it on its footprint. */
  async function carry(agent, part, i) {
    agent.busy = true
    const shelf = shelfOf(i)
    await walk(agent, shelf.x, shelf.y + 22)
    stocked[i]?.remove()
    const held = drawPart(part.kind, agent.hands)
    held.setAttribute("transform", "scale(0.7)")
    await walk(agent, part.x, part.y + 44)
    say(part.log)
    held.remove()
    const set = drawPart(part.kind, partsLayer)
    await tween(SETTLE_MS, (t) => set.setAttribute("transform", `translate(${part.x} ${part.y - 34 * (1 - t)}) scale(${0.7 + 0.3 * t})`))
    agent.busy = false
  }

  /** One agent walks a connection, the copper following its steps. */
  async function lay(agent, points) {
    agent.busy = true
    await walk(agent, points[0][0], points[0][1] + 14)
    const path = el("polyline", { points: points.map((p) => p.join(",")).join(" "), class: "ws-track" }, tracksLayer)
    const length = points.slice(1).reduce((sum, p, k) => sum + Math.hypot(p[0] - points[k][0], p[1] - points[k][1]), 0)
    path.style.strokeDasharray = `${length}`
    path.style.strokeDashoffset = `${length}`
    let done = 0
    for (let k = 1; k < points.length; k++) {
      const seg = Math.hypot(points[k][0] - points[k - 1][0], points[k][1] - points[k - 1][1])
      await walk(agent, points[k][0], points[k][1] + 14, (t) => {
        path.style.strokeDashoffset = `${length - done - seg * t}`
      })
      done += seg
    }
    agent.busy = false
  }

  /** Runs jobs on the agents: each free agent takes the next job, so up to three work at once. */
  async function crew(agents, jobs, work) {
    let next = 0
    await Promise.all(agents.map(async (agent) => {
      while (next < jobs.length) {
        const i = next++
        await work(agent, jobs[i], i)
      }
    }))
  }

  const agents = AGENT_COLOURS.map(makeAgent)
  agents.forEach((agent, i) => {
    agent.x = 60 + i * 34
    agent.y = H - 40
    place(agent)
  })
  for (const part of PARTS) drawFootprint(part)

  /** Where part i waits in the tray: two columns, top to bottom. */
  const shelfOf = (i) => ({ x: TRAY.x + (i % 2 === 0 ? 28 : 70), y: TRAY.y + 34 + Math.floor(i / 2) * 62 })
  let stocked = []
  const stock = () => {
    trayLayer.replaceChildren()
    stocked = PARTS.map((part, i) => {
      const shelf = shelfOf(i)
      const g = drawPart(part.kind, trayLayer)
      g.setAttribute("transform", `translate(${shelf.x} ${shelf.y}) scale(0.6)`)
      return g
    })
  }

  async function round() {
    tracksLayer.replaceChildren()
    partsLayer.replaceChildren()
    stock()
    say(STEPS_LOG.start)
    await wait(700)
    await crew(agents, PARTS, carry)
    let laid = 0
    await crew(agents.slice(0, 2), TRACKS, async (agent, points) => {
      await lay(agent, points)
      say(STEPS_LOG.route(++laid))
    })
    await Promise.all(agents.map((agent, i) => walk(agent, 60 + i * 34, H - 40)))
    say(STEPS_LOG.done)
    svg.classList.add("ws-finished")
    await wait(REST_MS)
    svg.classList.remove("ws-finished")
  }

  /** The finished board, still: for anyone who prefers less motion. */
  function finished() {
    for (const part of PARTS) drawPart(part.kind, partsLayer).setAttribute("transform", `translate(${part.x} ${part.y})`)
    for (const points of TRACKS) el("polyline", { points: points.map((p) => p.join(",")).join(" "), class: "ws-track" }, tracksLayer)
    say(STEPS_LOG.done)
  }

  host.replaceChildren(svg)
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    finished()
    return
  }
  let visible = false
  const update = () => setRunning(visible && document.visibilityState === "visible")
  new IntersectionObserver((entries) => {
    visible = entries.some((entry) => entry.isIntersecting)
    update()
  }).observe(svg)
  document.addEventListener("visibilitychange", update)
  ;(async () => {
    for (;;) await round()
  })()
})()
