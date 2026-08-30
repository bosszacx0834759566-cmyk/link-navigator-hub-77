/**
 * Single source of truth for the LEO -> HAPS optical (laser) links.
 *
 * Both the 3D globe and the 2D operational map render *this* assignment —
 * neither view computes its own link geometry. Hard constraint: one LEO can
 * hold an active laser link to at most ONE HAPS at any time (and a HAPS holds
 * at most one LEO), so the scheduler performs a global greedy matching.
 */

import * as THREE from 'three';
import { ASSETS } from '@/lib/ololink';
import { SAT_ORBITS, SATELLITES, orbitPosition, windowScore } from '@/lib/orbits';
import { assetVec } from '@/lib/layers';

export const ACQUIRE_SCORE = 0.34;
export const LOS_SCORE = 0.16;

export const HAPS_ASSETS = ASSETS.filter((a) => a.kind === 'haps');

const HAPS_POS: Record<string, THREE.Vector3> = Object.fromEntries(
  HAPS_ASSETS.map((a) => [a.id, new THREE.Vector3(...assetVec(a))])
);

/** hapsId -> satId (or null when no window is open) */
export type LaserAssignment = Record<string, string | null>;

const scratch = new THREE.Vector3();

/**
 * Compute the exclusive LEO <-> HAPS matching at scene time `t`.
 * `held` is the previous assignment; it lowers the threshold (hysteresis) so
 * an acquired link is kept until the window really closes.
 */
export function computeLaserAssignment(t: number, held: LaserAssignment = {}): LaserAssignment {
  const candidates: { haps: string; sat: string; score: number }[] = [];

  const satPos = new Map<string, THREE.Vector3>();
  for (const sat of SATELLITES) {
    const el = SAT_ORBITS[sat.id];
    if (el) satPos.set(sat.id, orbitPosition(el, t, new THREE.Vector3()));
  }

  for (const haps of HAPS_ASSETS) {
    const rp = HAPS_POS[haps.id];
    if (!rp) continue;
    for (const [satId, sp] of satPos) {
      const score = windowScore(scratch.copy(sp), rp);
      const threshold = held[haps.id] === satId ? LOS_SCORE : ACQUIRE_SCORE;
      if (score > threshold) candidates.push({ haps: haps.id, sat: satId, score });
    }
  }

  // strongest window first; a LEO and a HAPS can each be used only once
  candidates.sort((a, b) => b.score - a.score);
  const usedSats = new Set<string>();
  const next: LaserAssignment = {};
  for (const haps of HAPS_ASSETS) next[haps.id] = null;

  for (const c of candidates) {
    if (next[c.haps] || usedSats.has(c.sat)) continue;
    next[c.haps] = c.sat;
    usedSats.add(c.sat);
  }

  return next;
}

export function sameAssignment(a: LaserAssignment, b: LaserAssignment) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) if ((a[k] ?? null) !== (b[k] ?? null)) return false;
  return true;
}
