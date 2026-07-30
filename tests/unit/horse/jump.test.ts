import { describe, it } from "mocha";
import expect from "expect";
import { Vec3 } from "vec3";
import { HorseState } from "../../../src/physics/states/horseState";
import {
  createHorseRig,
  fillWaterColumn,
  loadMcData,
  simulateHorseTick,
} from "../../helpers/unit/botcraftTestSupport";

const version = "1.17.1";
const groundY = 64;

function setupGroundHorse() {
  return createHorseRig({
    version,
    position: new Vec3(0, groundY, 0),
    floorY: groundY - 1,
    attributes: {
      "generic.movement_speed": { value: 0.225, modifiers: [] },
      "horse.jump_strength": { value: 0.7, modifiers: [] },
    },
  });
}

function setupLavaPool(horseY: number) {
  const rig = createHorseRig({
    version,
    position: new Vec3(0, horseY, 0),
    floorY: 61,
  });
  for (let x = -1; x <= 1; x++) {
    for (let z = -1; z <= 1; z++) {
      rig.world.setLava(new Vec3(x, 63, z), 0);
    }
  }
  rig.horseState.vel.set(0, 0, 0);
  rig.horseState.onGround = false;
  return rig;
}

/** End-of-tick jump Y: executeRidersJump then air travel with float verticalDrag (1.17.1). */
const VANILLA_JUMP_END_VEL_Y = (0.7 - 0.08) * Math.fround(0.98);
const VANILLA_AIR_DROP_VEL_Y = (0 - 0.08) * Math.fround(0.98);
const VANILLA_WATER_INERTIA = Math.fround(0.8);

describe("HorsePhysics jump", () => {
  it("starts at zero and charges linearly through the tenth held tick", () => {
    const rig = setupGroundHorse();
    for (let tick = 0; tick <= 10; tick++) {
      rig.horseState.updateJumpCharge(true);
      expect(rig.horseState.jumpChargeScale).toBeCloseTo(Math.min(tick * 0.1, 1), 5);
    }
  });

  it("falls from 1.0 toward the vanilla 0.8 long-hold limit", () => {
    const rig = setupGroundHorse();
    for (let tick = 0; tick < 20; tick++) {
      rig.horseState.updateJumpCharge(true);
    }
    expect(rig.horseState.jumpChargeScale).toBeGreaterThan(0.8);
    expect(rig.horseState.jumpChargeScale).toBeLessThan(0.9);
  });

  it("sets pending scale on release with minimum 0.4 for quick tap", () => {
    const rig = setupGroundHorse();
    rig.horseState.updateJumpCharge(true);
    const release = rig.horseState.updateJumpCharge(false);
    expect(release.released).toBe(true);
    expect(release.jumpBoost).toBe(0);
    expect(rig.horseState.jumpPendingScale).toBeCloseTo(0.4, 5);
  });

  it("applies vanilla end-of-tick jump Y for scale 1.0", () => {
    const rig = setupGroundHorse();
    rig.horseState.jumpPendingScale = 1.0;
    rig.horseState.onGround = true;
    simulateHorseTick(rig);
    expect(rig.horseState.vel.y).toBe(VANILLA_JUMP_END_VEL_Y);
  });

  it("assigns jump Y directly without Math.max regression", () => {
    const rig = setupGroundHorse();
    rig.horseState.vel.y = 1.2;
    rig.horseState.jumpPendingScale = 1.0;
    rig.horseState.onGround = true;
    simulateHorseTick(rig);
    expect(rig.horseState.vel.y).toBe(VANILLA_JUMP_END_VEL_Y);
    expect(rig.horseState.vel.y).toBeLessThan(1.0);
  });

  it("adds forward horizontal impulse when jumping forward", () => {
    const rig = setupGroundHorse();
    rig.horseState.control.forward = true;
    rig.horseState.jumpPendingScale = 1.0;
    rig.horseState.onGround = true;
    simulateHorseTick(rig);
    expect(rig.horseState.vel.z).toBeLessThan(0);
    expect(rig.horseState.vel.y).toBe(VANILLA_JUMP_END_VEL_Y);
  });

  it("lands and allows repeated jumps", () => {
    const rig = setupGroundHorse();
    rig.horseState.jumpPendingScale = 1.0;
    simulateHorseTick(rig);
    expect(rig.horseState.vel.y).toBeGreaterThan(0);

    for (let i = 0; i < 30; i++) simulateHorseTick(rig);
    expect(rig.horseState.onGround).toBe(true);

    rig.horseState.jumpPendingScale = 0.5;
    simulateHorseTick(rig);
    expect(rig.horseState.vel.y).toBeGreaterThan(0);
  });

  it("uses honey block jump factor", () => {
    const rig = setupGroundHorse();
    const honeyId = rig.mcData.blocksByName.honey_block?.id;
    if (honeyId != null) {
      rig.world.setBlock(new Vec3(0, groundY, 0), honeyId);
    }
    rig.horseState.jumpPendingScale = 1.0;
    simulateHorseTick(rig);
    const honeyJump = rig.horseState.vel.y;

    const normalRig = setupGroundHorse();
    normalRig.horseState.jumpPendingScale = 1.0;
    simulateHorseTick(normalRig);
    if (honeyId != null) {
      expect(honeyJump).toBeLessThan(normalRig.horseState.vel.y);
    }
  });

  it("reads jump strength from entity attributes", () => {
    const rig = createHorseRig({
      version,
      position: new Vec3(0, groundY, 0),
      floorY: groundY - 1,
      attributes: {
        "horse.jump_strength": { value: 1.0, modifiers: [] },
      },
    });
    expect(rig.horseState.jumpStrength).toBeCloseTo(1.0, 5);
  });

  it("clone preserves jump state independently", () => {
    const rig = setupGroundHorse();
    rig.horseState.jumpChargeScale = 0.5;
    rig.horseState.jumpPendingScale = 0.8;
    const clone = rig.horseState.clone();
    clone.jumpChargeScale = 0.1;
    expect(rig.horseState.jumpChargeScale).toBeCloseTo(0.5, 5);
  });
});

describe("HorseState attributes", () => {
  it("applies attribute modifiers without mutating source", () => {
    const attr = {
      value: 0.225,
      modifiers: [{ uuid: "test", operation: 1, amount: 0.5 }],
    };
    const speed = HorseState.getMovementSpeedFromAttributes(
      { "generic.movement_speed": attr },
      loadMcData("1.17.1").mcData,
    );
    expect(speed).toBeCloseTo(0.3375, 4);
    expect(attr.modifiers.length).toBe(1);
  });
});

describe("HorsePhysics travel — water and lava oracle", () => {
  it("applies drag-then-gravity water branch with float waterInertia", () => {
    const waterY = 64;
    const rig = createHorseRig({
      version,
      position: new Vec3(0, waterY - 0.5, 0),
      floorY: waterY - 3,
    });
    for (let x = -1; x <= 1; x++) {
      for (let z = -1; z <= 1; z++) {
        fillWaterColumn(rig.world, x, z, waterY - 1, waterY, 0);
      }
    }
    rig.horseState.vel.set(0, 0, 0);
    rig.horseState.onGround = false;
    simulateHorseTick(rig);
    expect(rig.horseState.isInWater).toBe(true);
    expect(rig.horseState.vel.y).toBe(-0.005);
  });

  it("applies float waterInertia to non-zero vertical velocity", () => {
    const waterY = 64;
    const rig = createHorseRig({
      version,
      position: new Vec3(0, waterY - 0.5, 0),
      floorY: waterY - 3,
    });
    for (let x = -1; x <= 1; x++) {
      for (let z = -1; z <= 1; z++) {
        fillWaterColumn(rig.world, x, z, waterY - 1, waterY, 0);
      }
    }
    rig.horseState.vel.set(0, 0.5, 0);
    rig.horseState.onGround = false;
    simulateHorseTick(rig);
    expect(rig.horseState.vel.y).toBe(0.5 * VANILLA_WATER_INERTIA - 0.005);
  });

  it("detects lava when feet are below source surface (y≈63.85)", () => {
    const rig = setupLavaPool(63.85);
    simulateHorseTick(rig);
    expect(rig.horseState.isInLava).toBe(true);
    expect(rig.horseState.vel.y).toBe(-0.025);
  });

  it("does not detect lava when feet are above source surface (y=63.9)", () => {
    const rig = setupLavaPool(63.9);
    simulateHorseTick(rig);
    expect(rig.horseState.isInLava).toBe(false);
    expect(rig.horseState.vel.y).toBe(VANILLA_AIR_DROP_VEL_Y);
  });

  it("applies deep lava branch when submerged", () => {
    const rig = setupLavaPool(63.1);
    simulateHorseTick(rig);
    expect(rig.horseState.isInLava).toBe(true);
    expect(rig.horseState.vel.y).toBe(-0.02);
  });

  it("parses string lava level from block properties", () => {
    const rig = setupLavaPool(63.85);
    const block = rig.world.getBlock(new Vec3(0, 63, 0));
    expect(typeof block?.getProperties().level).toBe("string");
    simulateHorseTick(rig);
    expect(rig.horseState.isInLava).toBe(true);
  });

  it("detects lava while falling with negative Y velocity", () => {
    const rig = setupLavaPool(63.85);
    rig.horseState.vel.y = -0.5;
    simulateHorseTick(rig);
    expect(rig.horseState.isInLava).toBe(true);
  });

  it("detects lava at horizontal BB edge with vanilla deflate BB", () => {
    const rig = createHorseRig({
      version,
      position: new Vec3(0.65, 63.85, 0),
      floorY: 61,
    });
    rig.world.setLava(new Vec3(1, 63, 0), 0);
    rig.horseState.vel.set(0, -0.2, 0);
    rig.horseState.onGround = false;
    simulateHorseTick(rig);
    expect(rig.horseState.isInLava).toBe(true);
  });

  it("detects lava when fluidTop equals deflated BB minY (fluidTop >= bb.minY)", () => {
    const surfaceY = 63 + 8 / 9;
    // Feet one millimeter below surface so deflate(0.001) minY equals fluidTop.
    const rig = createHorseRig({
      version,
      position: new Vec3(0, surfaceY - 0.001, 0),
      floorY: 61,
    });
    rig.world.setLava(new Vec3(0, 63, 0), 0);
    rig.horseState.vel.set(0, 0, 0);
    rig.horseState.onGround = false;
    simulateHorseTick(rig);
    expect(rig.horseState.isInLava).toBe(true);
  });
});

/* eslint-disable @typescript-eslint/no-require-imports */
function loadHorseJumpPrecisionModule() {
  return require("../../../src/physics/settings/horseSettings");
}
/* eslint-enable @typescript-eslint/no-require-imports */

describe("HorsePhysics jump precision", () => {
  const {
    computeChargeScale,
    computePendingJumpScale,
    computeHorseJumpPower,
    computeJumpBoostPower,
    floorRidingChargeIndex,
  } = loadHorseJumpPrecisionModule();

  it("floors riding charge index from float32 scale product at tick 7", () => {
    expect(floorRidingChargeIndex(computeChargeScale(7))).toBe(70);
  });

  it("uses sequential float32 pending scale for charge index 8", () => {
    const vanilla = computePendingJumpScale(8);
    const simplified = Math.fround(0.4 + 0.4 * (8 / 90));
    expect(vanilla).toBe(0.4355555772781372);
    expect(vanilla).not.toBe(simplified);
  });

  it("uses sequential float32 pending scale for charge index 2", () => {
    const vanilla = computePendingJumpScale(2);
    const simplified = Math.fround(0.4 + 0.4 * (2 / 90));
    expect(vanilla).toBe(0.40888890624046326);
    expect(vanilla).not.toBe(simplified);
  });

  it("matches vanilla charge scale at tick 2", () => {
    expect(computeChargeScale(2)).toBe(0.20000000298023224);
  });

  it("derives pending scale from riding charge index on release", () => {
    const rig = setupGroundHorse();
    rig.horseState.jumpChargeScale = 0.025;
    rig.horseState.previousJumpInput = true;
    rig.horseState.updateJumpCharge(false);
    expect(rig.horseState.jumpPendingScale).toBe(computePendingJumpScale(2));
  });

  it("applies full float32 getJumpPower chain on 1.21.1 for scale 0.4", () => {
    const { mcData } = loadMcData("1.21.1");
    const jumpPower = computeHorseJumpPower(0.7, 0.4, 1.0, 0, mcData);
    expect(jumpPower).toBe(0.2800000011920929);
    expect(jumpPower).not.toBe(0.28);

    const rig = createHorseRig({
      version: "1.21.1",
      position: new Vec3(0, groundY, 0),
      floorY: groundY - 1,
      attributes: {
        "generic.movement_speed": { value: 0.225, modifiers: [] },
        "generic.jump_strength": { value: 0.7, modifiers: [] },
      },
    });
    rig.horseState.jumpPendingScale = 0.4;
    rig.horseState.onGround = true;
    simulateHorseTick(rig);
    expect(rig.horseState.vel.y).toBe((jumpPower - 0.08) * Math.fround(0.98));
  });

  it("uses double jump power chain on 1.17.1 for scale 0.4", () => {
    const { mcData } = loadMcData("1.17.1");
    const jumpPower = computeHorseJumpPower(0.7, 0.4, 1.0, 0, mcData);
    expect(jumpPower).toBe(0.27999999999999997);

    const rig = setupGroundHorse();
    rig.horseState.jumpPendingScale = 0.4;
    rig.horseState.onGround = true;
    simulateHorseTick(rig);
    expect(rig.horseState.vel.y).toBe((jumpPower - 0.08) * Math.fround(0.98));
  });

  it("applies float32 jump boost power from potion level", () => {
    const { mcData } = loadMcData("1.17.1");
    expect(computeJumpBoostPower(2)).toBe(0.20000000298023224);

    const jumpPower = computeHorseJumpPower(0.7, 1.0, 1.0, 2, mcData);
    expect(jumpPower).toBe(0.9000000029802322);

    const rig = setupGroundHorse();
    rig.horseState.jumpPendingScale = 1.0;
    rig.horseState.jumpBoost = 2;
    rig.horseState.onGround = true;
    simulateHorseTick(rig);
    expect(rig.horseState.vel.y).toBe((jumpPower - 0.08) * Math.fround(0.98));
  });
});
