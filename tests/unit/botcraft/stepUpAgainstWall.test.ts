import { describe, it } from "mocha";
import expect from "expect";
import { Vec3 } from "vec3";
import { createBotcraftPlayerRig, createFlatWorld, loadMcData } from "../../helpers/unit/botcraftTestSupport";

/**
 * Entity::collide step-up must never leave the entity embedded in the block it stepped
 * onto.
 *
 * Vanilla (<= 1.20.6) Entity#collide runs its follow-up step-up probes from the
 * *unmodified* bounding box, because AABB#move returns a new AABB:
 *
 *   Vec3 vec35 = collideBoundingBox(this, new Vec3(vec3.x, 0.0, vec3.z), aABB.move(vec34), ...).add(vec34);
 *   return vec33.add(collideBoundingBox(this, new Vec3(0.0, -vec33.y + vec3.y, 0.0), aABB.move(vec33), ...));
 *
 * Scenario: 1-wide corridor, the entity walks diagonally into the side wall while
 * stepping onto a 0.5-high step. The wall reaches above the entity's head, so the
 * "step only" probe - which is expanded towards the horizontal movement, i.e. into the
 * wall column - is clipped by the wall block above the head. That is the branch which
 * used to corrupt the shared bounding box, dropping the entity 0.2 short of the surface
 * and leaving it inside the step.
 */

const GROUND = 60;
const DIAGONAL_YAW = -20 * (Math.PI / 180);

/**
 * 1.20.4 / 1.20.5 straddle the version check in applyMovement: below 1.20.5 the step
 * height is the static `ctx.stepHeight`, from 1.20.5 on it is read from the entity
 * attribute (falling back to `ctx.stepHeight` when the dataset has no such attribute).
 */
const VERSIONS = [
  "1.8.9", "1.9.4", "1.10.2", "1.11.2", "1.12.2", "1.13.2", "1.14.4", "1.15.2",
  "1.16.5", "1.17.1", "1.18.2", "1.19.4", "1.20.1", "1.20.4", "1.20.5", "1.20.6",
  "1.21.1", "1.21.4", "1.21.8", "1.21.11",
];

/**
 * The installed minecraft-data only ships a `stepHeight` attribute descriptor from 1.21
 * on, so the cases that actually put a value in the attribute are driven by the dataset
 * rather than by a hardcoded version list.
 */
function hasStepHeightAttribute(version: string) {
  const { mcData } = loadMcData(version);
  return (mcData as any).attributesByName?.stepHeight != null;
}

function findState(version: string, blockName: string, wanted: Record<string, unknown>) {
  const { mcData, Block } = loadMcData(version);
  const def = mcData.blocksByName[blockName] as any;
  if (!def) return null;
  const count = (def.maxStateId ?? def.minStateId ?? 0) - (def.minStateId ?? 0);
  for (let metadata = 0; metadata <= count; metadata++) {
    const block = new Block(def.id, 0, metadata);
    const props = block.getProperties() as Record<string, unknown>;
    if (props.waterlogged === true) continue; // water would take a different movement path
    if (Object.entries(wanted).every(([key, value]) => props[key] === value)) {
      return { id: def.id as number, metadata, shapes: block.shapes };
    }
  }
  return null;
}

/**
 * Before 1.12 minecraft-data returns the same stair collision shape for every facing,
 * so a stair scenario cannot be placed deterministically there. Detect that instead of
 * hardcoding a version cutoff.
 */
function stairShapesFollowFacing(version: string) {
  const north = findState(version, "acacia_stairs", { facing: "north", half: "bottom" });
  const east = findState(version, "acacia_stairs", { facing: "east", half: "bottom" });
  if (!north || !east) return false;
  return JSON.stringify(north.shapes) !== JSON.stringify(east.shapes);
}

/** Sand walls at x = -1 and x = +1, tall enough to reach above the player's head. */
function buildWalls(
  fakeWorld: ReturnType<typeof createFlatWorld>,
  sandId: number,
  fromZ: number,
  toZ: number,
  baseY: number,
  height: number,
) {
  for (let z = fromZ; z >= toZ; z--) {
    for (let dy = 0; dy < height; dy++) {
      fakeWorld.setOverrideBlock(new Vec3(-1, baseY + dy, z), sandId);
      fakeWorld.setOverrideBlock(new Vec3(1, baseY + dy, z), sandId);
    }
  }
}

function walkDiagonally(
  version: string,
  fakeWorld: ReturnType<typeof createFlatWorld>,
  ticks: number,
  stepHeightAttribute?: number,
) {
  const rig = createBotcraftPlayerRig({
    version,
    position: new Vec3(0.5, GROUND, 0.5),
    groundLevel: GROUND,
  });

  if (stepHeightAttribute != null) {
    const key = (rig.physics as any).stepHeightAttribute as string | null;
    expect(key).not.toBeNull();
    (rig.playerState as any).attributes[key!] = { value: stepHeightAttribute, modifiers: [] };
  }

  rig.playerState.look(DIAGONAL_YAW, 0);
  rig.playerState.control.forward = true;

  const trace: Vec3[] = [];
  for (let i = 0; i < ticks; i++) {
    rig.physics.simulate(rig.playerCtx, fakeWorld as any);
    rig.playerState.apply(rig.fakePlayer);
    trace.push(rig.playerState.pos.clone());
  }
  return trace;
}

function expectOnlyOnSurfaces(trace: Vec3[], surfaces: number[]) {
  for (const pos of trace) {
    const onSurface = surfaces.some((surface) => Math.abs(pos.y - surface) < 1e-6);
    // compared as an object so a failure prints the offending Y
    expect({ y: pos.y, onSurface }).toEqual({ y: pos.y, onSurface: true });
  }
}

describe("Botcraft step-up against a side wall", () => {
  for (const version of VERSIONS) {
    describe(version, () => {
      it("lands on top of a slab step instead of inside it", () => {
        const { mcData } = loadMcData(version);
        const fakeWorld = createFlatWorld(version, GROUND);
        const sandId = mcData.blocksByName.sand.id;
        const slab = findState(version, "stone_slab", { type: "bottom" })
          ?? findState(version, "smooth_stone_slab", { type: "bottom" });
        expect(slab).not.toBeNull();

        fakeWorld.setOverrideBlock(new Vec3(0, GROUND, -2), slab!.id, slab!.metadata);
        buildWalls(fakeWorld, sandId, 1, -4, GROUND, 4);

        const trace = walkDiagonally(version, fakeWorld, 16);
        fakeWorld.clearOverrides();

        expectOnlyOnSurfaces(trace, [GROUND, GROUND + 0.5]);

        const last = trace[trace.length - 1];
        expect(last.y).toBeCloseTo(GROUND + 0.5, 6);
        expect(last.z).toBeLessThan(-1);
      });

      it("keeps climbing a staircase while pressed against the wall", function () {
        if (!stairShapesFollowFacing(version)) {
          // minecraft-data has no per-facing stair collision shapes for this version
          this.skip();
        }

        const { mcData } = loadMcData(version);
        const fakeWorld = createFlatWorld(version, GROUND);
        const sandId = mcData.blocksByName.sand.id;
        const stairs = findState(version, "acacia_stairs", { facing: "north", half: "bottom" })!;

        const steps = 6;
        for (let i = 0; i < steps; i++) {
          const y = GROUND + i;
          const z = -1 - i;
          fakeWorld.setOverrideBlock(new Vec3(0, y, z), stairs.id, stairs.metadata);
          for (let fill = GROUND; fill < y; fill++) {
            fakeWorld.setOverrideBlock(new Vec3(0, fill, z), sandId);
          }
          for (let dy = 0; dy < 4; dy++) {
            fakeWorld.setOverrideBlock(new Vec3(-1, y + dy, z), sandId);
            fakeWorld.setOverrideBlock(new Vec3(1, y + dy, z), sandId);
          }
        }
        buildWalls(fakeWorld, sandId, 1, 0, GROUND, 4);

        const trace = walkDiagonally(version, fakeWorld, 24);
        fakeWorld.clearOverrides();

        // stair surfaces are multiples of 0.5 - never a step-up remainder such as 0.3
        for (const pos of trace) {
          expect(Math.abs((pos.y * 2) % 1)).toBeLessThan(1e-6);
        }

        // the climb must not stall: height and distance keep increasing
        const last = trace[trace.length - 1];
        expect(last.y).toBeGreaterThanOrEqual(GROUND + 2);
        expect(last.z).toBeLessThan(-2);
      });

      it("steps onto a full block when the step-height attribute allows it", function () {
        if (!hasStepHeightAttribute(version)) {
          // this dataset has no step-height attribute descriptor, so the attribute-aware
          // branch falls back to the static step height, which the cases above cover
          this.skip();
        }

        {
          const { mcData } = loadMcData(version);
          const fakeWorld = createFlatWorld(version, GROUND);
          const sandId = mcData.blocksByName.sand.id;

          fakeWorld.setOverrideBlock(new Vec3(0, GROUND, -2), sandId);
          buildWalls(fakeWorld, sandId, 1, -4, GROUND, 4);

          const trace = walkDiagonally(version, fakeWorld, 16, 1.0);
          fakeWorld.clearOverrides();

          // never inside the block: only the floor or its top face
          expectOnlyOnSurfaces(trace, [GROUND, GROUND + 1]);

          const last = trace[trace.length - 1];
          expect(last.y).toBeCloseTo(GROUND + 1, 6);
          expect(last.z).toBeLessThan(-1);
        }
      });

      it("honours a step-height attribute below the step and refuses to climb", function () {
        if (!hasStepHeightAttribute(version)) this.skip();

        {
          // 0.4 < the 0.5 slab: the entity must stop at the slab face, never step up and
          // never end up inside it. This is what proves the attribute is really read
          // instead of the static 0.6 default.
          const { mcData } = loadMcData(version);
          const fakeWorld = createFlatWorld(version, GROUND);
          const sandId = mcData.blocksByName.sand.id;
          const slab = findState(version, "stone_slab", { type: "bottom" })!;

          fakeWorld.setOverrideBlock(new Vec3(0, GROUND, -2), slab.id, slab.metadata);
          buildWalls(fakeWorld, sandId, 1, -4, GROUND, 4);

          const trace = walkDiagonally(version, fakeWorld, 16, 0.4);
          fakeWorld.clearOverrides();

          expectOnlyOnSurfaces(trace, [GROUND]);

          const last = trace[trace.length - 1];
          expect(last.y).toBeCloseTo(GROUND, 6);
          expect(last.z).toBeGreaterThan(-1); // blocked by the slab's front face
        }
      });
    });
  }
});
