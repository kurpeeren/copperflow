// The 3D view's camera: it looks at the middle of the model from a turn around the board's z axis (yaw) and a height
// above or below the board (pitch, -90 from straight below to 90 from straight above), with a zoom on top of the fit.
// The projection is orthographic: sizes on screen do not change with depth, as in a mechanical drawing. Pure.
import type { Scene, Vec3 } from "./scene.js"

export interface Orbit {
  /** Degrees around z; 0 looks along +y. */
  yaw: number
  /** Degrees above the board's plane; 90 looks straight down on the top, -90 straight up at the bottom. */
  pitch: number
  /** 1 fits the model to the view. */
  zoom: number
}

export const START: Orbit = { yaw: -30, pitch: 35, zoom: 1 }
export const TOP: Orbit = { yaw: 0, pitch: 90, zoom: 1 }
export const BOTTOM: Orbit = { yaw: 0, pitch: -90, zoom: 1 }

/** How far an arrow key turns, in degrees. */
export const KEY_TURN = 15
/** Degrees per pixel of a drag. */
const DRAG_TURN = 0.4
const ZOOM_MIN = 0.2
const ZOOM_MAX = 20
/** The share of the view the fitted model fills. */
const FIT = 0.85

const clampPitch = (pitch: number) => Math.max(-90, Math.min(90, pitch))
const clampZoom = (zoom: number) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom))
const wrapYaw = (yaw: number) => ((((yaw + 180) % 360) + 360) % 360) - 180

export const turned = (orbit: Orbit, dYaw: number, dPitch: number): Orbit => ({ ...orbit, yaw: wrapYaw(orbit.yaw + dYaw), pitch: clampPitch(orbit.pitch + dPitch) })

/** A drag of dx, dy pixels: right turns the model to the right, down tips its near edge down. */
export const dragged = (orbit: Orbit, dx: number, dy: number): Orbit => turned(orbit, -dx * DRAG_TURN, dy * DRAG_TURN)

/** A wheel step: up (negative deltaY) zooms in. */
export const wheeled = (orbit: Orbit, deltaY: number): Orbit => ({ ...orbit, zoom: clampZoom(orbit.zoom * Math.exp(-deltaY * 0.0015)) })

/** What a key does to the view; undefined for a key it does not use. */
export function orbitKey(orbit: Orbit, key: string): Orbit | undefined {
  switch (key) {
    case "ArrowLeft":
      return turned(orbit, KEY_TURN, 0)
    case "ArrowRight":
      return turned(orbit, -KEY_TURN, 0)
    case "ArrowUp":
      return turned(orbit, 0, KEY_TURN)
    case "ArrowDown":
      return turned(orbit, 0, -KEY_TURN)
    case "+":
    case "=":
      return wheeled(orbit, -200)
    case "-":
      return wheeled(orbit, 200)
    case "Home":
    case "0":
      return START
    case "t":
    case "T":
      return TOP
    case "b":
    case "B":
      return BOTTOM
    default:
      return undefined
  }
}

/** The camera's frame: the direction towards the eye, and screen right and up, all unit vectors in board space. */
export interface ViewFrame {
  eye: Vec3
  right: Vec3
  up: Vec3
  /** The point in the middle of the screen. */
  target: Vec3
  /** Screen pixels per mm. */
  scale: number
  width: number
  height: number
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]

export function viewFrame(orbit: Orbit, scene: Scene, width: number, height: number): ViewFrame {
  const [yaw, pitch] = [(orbit.yaw * Math.PI) / 180, (orbit.pitch * Math.PI) / 180]
  const eye: Vec3 = [Math.cos(pitch) * Math.sin(yaw), -Math.cos(pitch) * Math.cos(yaw), Math.sin(pitch)]
  const right: Vec3 = [Math.cos(yaw), Math.sin(yaw), 0]
  const up = cross(eye, right)
  const [min, max] = scene.bounds
  const target: Vec3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2]
  const diagonal = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) || 1
  return { eye, right, up, target, scale: ((Math.min(width, height) * FIT) / diagonal) * orbit.zoom, width, height }
}

/** A point on screen, in pixels from the top left, and its depth: smaller is nearer the eye. */
export function project(frame: ViewFrame, p: Vec3): { x: number; y: number; depth: number } {
  const d: Vec3 = [p[0] - frame.target[0], p[1] - frame.target[1], p[2] - frame.target[2]]
  return { x: frame.width / 2 + frame.scale * dot(d, frame.right), y: frame.height / 2 - frame.scale * dot(d, frame.up), depth: -dot(d, frame.eye) }
}

export { dot }
