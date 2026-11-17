// The light the 3D view is lit by: one key light from above, behind and to the left of the starting view, a soft
// fill from the eye and an even ambient share. The key light is fixed to the board, so shadows can be painted into
// the board's picture once; seen from below, it comes from below by the same angle, so the bottom is lit alike. Pure.
import type { Material, Vec3 } from "./scene.js"

const unit = (v: Vec3): Vec3 => {
  const length = Math.hypot(v[0], v[1], v[2])
  return [v[0] / length, v[1] / length, v[2] / length]
}

/** Towards the key light, seen from above the top. */
export const KEY_LIGHT: Vec3 = unit([-0.55, 0.5, 0.78])

const AMBIENT = 0.34
const FILL = 0.16
/** The key's share: a face square to the light from straight above shows its colour as it is. */
const KEY = (1 - AMBIENT - FILL) / KEY_LIGHT[2]
/** A metal face's highlight: how strong and how tight. */
const SHINE = 0.55
const TIGHTNESS = 18

/** The key light for an eye above (z > 0) or below the board. */
export const keyFor = (eye: Vec3): Vec3 => (eye[2] >= 0 ? KEY_LIGHT : [KEY_LIGHT[0], KEY_LIGHT[1], -KEY_LIGHT[2]])

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

export interface Lighting {
  /** Multiplies the face's colour. */
  scale: number
  /** Added to every channel, 0 to 255: a metal face's highlight. */
  add: number
}

/** How a face with this outward normal is lit, seen from `eye` (towards the eye). */
export function lightFace(normal: Vec3, eye: Vec3, key: Vec3, material: Material = "matt"): Lighting {
  const facing = dot(normal, eye)
  // A face seen from behind (the inside of a hole's wall) is lit as its other side.
  const n: Vec3 = facing < 0 ? [-normal[0], -normal[1], -normal[2]] : normal
  const diffuse = Math.max(0, dot(n, key))
  const scale = AMBIENT + FILL * Math.abs(facing) + KEY * diffuse * (material === "metal" ? 0.8 : 1)
  if (material !== "metal") return { scale, add: 0 }
  const half = unit([key[0] + eye[0], key[1] + eye[1], key[2] + eye[2]])
  return { scale, add: 255 * SHINE * Math.max(0, dot(n, half)) ** TIGHTNESS }
}
