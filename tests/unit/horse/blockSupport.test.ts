import { describe, it } from "mocha";
import expect from "expect";
import { Vec3 } from "vec3";
import { resolveHorseSettings, resolveWaterHorizontalSlowDown } from "../../../src/physics/settings/horseSettings";
import {
  createHorseRig,
  loadMcData,
  simulateHorseTick,
} from "../../helpers/unit/botcraftTestSupport";

/* eslint-disable @typescript-eslint/no-require-imports */
function loadHorseBlockSupportModule() {
  return require("../../../src/physics/settings/horseBlockSupport");
}
/* eslint-enable @typescript-eslint/no-require-imports */

const { getHorseBlockBelowAffectingMovementPos, HORSE_BLOCK_BELOW_OFFSET_MODERN } =
  loadHorseBlockSupportModule();

/** Farmland collision top: blockY + 15/16. */
const FARMLAND_SURFACE_Y = 63 + 15 / 16;
const MODERN_OFFSET_Y = Math.fround(HORSE_BLOCK_BELOW_OFFSET_MODERN);

function setupFarmlandOverIceRig(version: string) {
  const rig = createHorseRig({
    version,
    position: new Vec3(0, FARMLAND_SURFACE_Y, 0),
    floorY: 60,
  });
  rig.world.setIce(new Vec3(0, 62, 0));
  rig.world.setFarmland(new Vec3(0, 63, 0));
  rig.horseState.onGround = true;
  rig.horseState.control.forward = true;
  return rig;
}

function pickHorseTravelCtx(ctx: ReturnType<typeof createHorseRig>["horseCtx"]) {
  return {
    gravity: ctx.gravity,
    waterGravity: ctx.waterGravity,
    lavaGravity: ctx.lavaGravity,
    airdrag: ctx.airdrag,
    airborneInertia: ctx.airborneInertia,
    airborneAccel: ctx.airborneAccel,
    waterInertia: ctx.waterInertia,
    lavaInertia: ctx.lavaInertia,
    liquidAccel: ctx.liquidAccel,
    stepHeight: ctx.stepHeight,
    useControls: ctx.useControls,
    gravityThenDrag: ctx.gravityThenDrag,
    collisionBehavior: ctx.collisionBehavior,
  };
}

describe("HorsePhysics block below feet", () => {
  it("uses ice under farmland on 1.14.4 (legacy -1.0 offset)", () => {
    const rig = setupFarmlandOverIceRig("1.14.4");
    simulateHorseTick(rig);
    expect(rig.horseState.vel.z).toBeCloseTo(-0.045128574939215405, 10);
  });

  it("uses farmland on 1.16.5 (0.5000001 offset)", () => {
    const rig = setupFarmlandOverIceRig("1.16.5");
    simulateHorseTick(rig);
    expect(rig.horseState.vel.z).toBeCloseTo(-0.12039300448399745, 10);
  });

  it("picks different friction blocks between 1.14.4 and 1.16.5 on farmland", () => {
    const legacy = setupFarmlandOverIceRig("1.14.4");
    const modern = setupFarmlandOverIceRig("1.16.5");
    simulateHorseTick(legacy);
    simulateHorseTick(modern);
    expect(legacy.horseState.vel.z).not.toBe(modern.horseState.vel.z);
    expect(Math.abs(legacy.horseState.vel.z)).toBeLessThan(Math.abs(modern.horseState.vel.z));
  });
});

describe("HorsePhysics block below feet — 1.20+ modern branch", () => {
  const horsePos = new Vec3(0.65, FARMLAND_SURFACE_Y, 0);
  const bbMinY = FARMLAND_SURFACE_Y;

  function blockGetter(blocks: Record<string, { name: string; boundingBox: string }>) {
    return (pos: Vec3) => blocks[`${pos.x},${pos.y},${pos.z}`] ?? null;
  }

  it("falls back to floor(minY - fround(0.500001)) without supportingBlockPos", () => {
    const { mcData } = loadMcData("1.20.1");
    const below = getHorseBlockBelowAffectingMovementPos(mcData, horsePos, bbMinY, null, () => null);
    expect(below.x).toBe(Math.floor(horsePos.x));
    expect(below.y).toBe(Math.floor(bbMinY - MODERN_OFFSET_Y));
    expect(below.z).toBe(Math.floor(horsePos.z));
  });

  it("uses fround offset at pos.y boundary 64.500001 (vanilla floor gives 63, not 64)", () => {
    const { mcData } = loadMcData("1.20.1");
    const boundaryPos = new Vec3(0, 64.500001, 0);
    const below = getHorseBlockBelowAffectingMovementPos(
      mcData,
      boundaryPos,
      boundaryPos.y,
      null,
      () => null,
    );
    expect(below.y).toBe(63);
    expect(below.y).toBe(Math.floor(boundaryPos.y - MODERN_OFFSET_Y));
    expect(Math.floor(boundaryPos.y - HORSE_BLOCK_BELOW_OFFSET_MODERN)).toBe(64);
  });

  it("uses supportingBlockPos X/Z with recalculated Y for normal blocks", () => {
    const { mcData, Block } = loadMcData("1.20.1");
    const supporting = new Vec3(1, 63, 0);
    const farmland = new Block(mcData.blocksByName.farmland.id, 0, 0);
    farmland.name = "farmland";
    farmland.boundingBox = "block";
    const below = getHorseBlockBelowAffectingMovementPos(
      mcData,
      horsePos,
      bbMinY,
      supporting,
      blockGetter({ "1,63,0": farmland }),
    );
    expect(below.x).toBe(1);
    expect(below.y).toBe(Math.floor(horsePos.y - MODERN_OFFSET_Y));
    expect(below.z).toBe(0);
    expect(below.x).not.toBe(Math.floor(horsePos.x));
  });

  it("keeps supportingBlockPos unchanged for fence gate (vanilla gate branch)", () => {
    const { mcData, Block } = loadMcData("1.20.1");
    const supporting = new Vec3(1, 63, 0);
    const gate = new Block(mcData.blocksByName.oak_fence_gate.id, 0, 0);
    gate.name = "oak_fence_gate";
    gate.boundingBox = "block";
    const below = getHorseBlockBelowAffectingMovementPos(
      mcData,
      horsePos,
      bbMinY,
      supporting,
      blockGetter({ "1,63,0": gate }),
    );
    expect(below).toEqual(supporting);
  });

  it("keeps supportingBlockPos unchanged for cobblestone wall", () => {
    const { mcData, Block } = loadMcData("1.20.1");
    const supporting = new Vec3(1, 63, 0);
    const wall = new Block(mcData.blocksByName.cobblestone_wall.id, 0, 0);
    wall.name = "cobblestone_wall";
    wall.boundingBox = "block";
    const below = getHorseBlockBelowAffectingMovementPos(
      mcData,
      horsePos,
      bbMinY,
      supporting,
      blockGetter({ "1,63,0": wall }),
    );
    expect(below).toEqual(supporting);
  });

  it("uses farmland on 1.20.1 without supportingBlockPos (same as 1.16.5 offset)", () => {
    const rig = setupFarmlandOverIceRig("1.20.1");
    simulateHorseTick(rig);
    expect(rig.horseState.vel.z).toBeCloseTo(-0.12039300448399745, 10);
  });

  it("uses supportingBlockPos farmland instead of ice at entity floored column", () => {
    const rig = createHorseRig({
      version: "1.20.1",
      position: horsePos.clone(),
      floorY: 60,
    });
    rig.world.setIce(new Vec3(0, 63, 0));
    rig.world.setFarmland(new Vec3(1, 63, 0));
    rig.horseState.supportingBlockPos = new Vec3(1, 63, 0);
    rig.horseState.onGround = true;
    rig.horseState.control.forward = true;
    simulateHorseTick(rig);
    expect(rig.horseState.vel.z).toBeCloseTo(-0.12039300448399745, 10);

    const withoutSupport = createHorseRig({
      version: "1.20.1",
      position: horsePos.clone(),
      floorY: 60,
    });
    withoutSupport.world.setIce(new Vec3(0, 63, 0));
    withoutSupport.world.setFarmland(new Vec3(1, 63, 0));
    withoutSupport.horseState.onGround = true;
    withoutSupport.horseState.control.forward = true;
    simulateHorseTick(withoutSupport);
    expect(withoutSupport.horseState.vel.z).toBeCloseTo(-0.045128574939215405, 10);
  });
});

describe("HorsePhysics travel context", () => {
  it("sets gravityThenDrag=true (living default; scoped travel ignores the flag)", () => {
    const rig = createHorseRig({
      version: "1.17.1",
      position: new Vec3(0, 64, 0),
      floorY: 63,
    });
    simulateHorseTick(rig);
    expect(rig.horseCtx.gravityThenDrag).toBe(true);
  });

  it("applies identical horse travel ctx on 1.16.5 and 1.17.1", () => {
    const rig165 = createHorseRig({
      version: "1.16.5",
      position: new Vec3(0, 64, 0),
      floorY: 63,
    });
    const rig171 = createHorseRig({
      version: "1.17.1",
      position: new Vec3(0, 64, 0),
      floorY: 63,
    });

    simulateHorseTick(rig165);
    simulateHorseTick(rig171);

    const cfg = resolveHorseSettings(loadMcData("1.17.1").mcData);
    const expected = {
      gravity: cfg.gravity,
      waterGravity: cfg.gravity / 16,
      lavaGravity: cfg.gravity / 4,
      airdrag: cfg.verticalDrag,
      airborneInertia: cfg.groundFrictionMultiplier,
      airborneAccel: Math.fround(0.225) * cfg.airborneAccelFactor,
      waterInertia: resolveWaterHorizontalSlowDown(rig171.horseState.species, loadMcData("1.17.1").mcData),
      lavaInertia: cfg.lavaHorizontalInertia,
      liquidAccel: cfg.liquidAccel,
      stepHeight: cfg.stepHeight,
      useControls: false,
      gravityThenDrag: true,
      collisionBehavior: { blockEffects: true, affectedAfterCollision: true },
    };

    expect(pickHorseTravelCtx(rig165.horseCtx)).toEqual(expected);
    expect(pickHorseTravelCtx(rig171.horseCtx)).toEqual(expected);
    expect(pickHorseTravelCtx(rig165.horseCtx)).toEqual(pickHorseTravelCtx(rig171.horseCtx));
  });
});
