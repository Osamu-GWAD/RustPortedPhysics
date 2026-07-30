import { describe, it } from "mocha";
import expect from "expect";
import { Vec3 } from "vec3";
import { HorseState } from "../../../src/physics/states/horseState";
import {
  createHorseRig,
  loadMcData,
  simulateHorseTick,
} from "../../helpers/unit/botcraftTestSupport";

/* eslint-disable @typescript-eslint/no-require-imports */
function loadHorseSettingsModule() {
  return require("../../../src/physics/settings/horseSettings");
}

function loadHorseSettingsJson() {
  return require("../../../src/physics/info/entity_physics.json");
}
/* eslint-enable @typescript-eslint/no-require-imports */

const version = "1.17.1";
const groundY = 64;
const VANILLA_AIR_DROP_VEL_Y = (0 - 0.08) * Math.fround(0.98);

describe("Horse settings resolution", () => {
  it("normalizes float32 horse-specific fields only", () => {
    const { FLOAT32_FIELDS, resolveHorseSettings } = loadHorseSettingsModule();
    const horseSection = loadHorseSettingsJson().horses;
    const defaultSettings = horseSection.default;
    const { mcData } = loadMcData("1.17.1");
    const resolved = resolveHorseSettings(mcData);

    for (const field of FLOAT32_FIELDS) {
      expect(resolved[field]).toBe(Math.fround(defaultSettings[field]));
    }

    expect(resolved.gravity).toBe(defaultSettings.gravity);
    expect(resolved.defaultJumpStrength).toBe(defaultSettings.defaultJumpStrength);
    expect(resolved.defaultJumpStrength).toBe(0.7);
    expect(resolved.verticalDrag).toBe(Math.fround(defaultSettings.verticalDrag));
    expect(resolved.waterInertia).toBe(Math.fround(defaultSettings.waterInertia));
    expect(resolved.lavaShallowThreshold).toBe(defaultSettings.lavaShallowThreshold);
  });

  it("returns default settings for an unknown major version", () => {
    const { FLOAT32_FIELDS, resolveHorseSettingsFromSection } = loadHorseSettingsModule();
    const defaultSettings = loadHorseSettingsJson().horses.default;
    const { mcData } = loadMcData("1.17.1");
    const fakeMcData = {
      ...mcData,
      version: { ...mcData.version, majorVersion: "99.99" },
    };
    const resolved = resolveHorseSettingsFromSection(fakeMcData, loadHorseSettingsJson().horses);

    for (const field of FLOAT32_FIELDS) {
      expect(resolved[field]).toBe(Math.fround(defaultSettings[field]));
    }
  });

  it("applies version-specific overrides and normalizes overridden float32 values", () => {
    const { resolveHorseSettingsFromSection } = loadHorseSettingsModule();
    const horseSection = loadHorseSettingsJson().horses;
    const { mcData } = loadMcData("1.17.1");
    const testSection = {
      ...horseSection,
      overrides: [{ versions: ["1.17"], values: { gravity: 0.05 } }],
    };

    const onTarget = resolveHorseSettingsFromSection(mcData, testSection);
    expect(onTarget.gravity).toBe(0.05);

    const offTarget = resolveHorseSettingsFromSection(
      { ...mcData, version: { ...mcData.version, majorVersion: "1.15" } },
      testSection,
    );
    expect(offTarget.gravity).toBe(horseSection.default.gravity);
  });

  it("lets the last matching override win when multiple entries match", () => {
    const { resolveHorseSettingsFromSection } = loadHorseSettingsModule();
    const horseSection = loadHorseSettingsJson().horses;
    const { mcData } = loadMcData("1.17.1");
    const testSection = {
      ...horseSection,
      overrides: [
        { versions: ["1.17"], values: { defaultMovementSpeed: 0.1 } },
        { versions: ["1.17"], values: { defaultMovementSpeed: 0.2 } },
      ],
    };

    const resolved = resolveHorseSettingsFromSection(mcData, testSection);
    expect(resolved.defaultMovementSpeed).toBe(Math.fround(0.2));
  });
});

describe("Horse dimensions resolution", () => {
  it("resolves donkey height separately from horse", () => {
    const { resolveHorseDimensions } = loadHorseSettingsModule();
    const { mcData } = loadMcData("1.17.1");
    const horseDims = resolveHorseDimensions(mcData, "horse");
    const donkeyDims = resolveHorseDimensions(mcData, "donkey");
    expect(horseDims.height).toBe(1.6);
    expect(donkeyDims.height).toBe(1.5);
  });

  it("uses runtime entity dimensions when finite and positive", () => {
    const rig = createHorseRig({
      version,
      position: new Vec3(0, groundY, 0),
      floorY: groundY - 1,
      entityName: "donkey",
    });
    expect(rig.horseState.height).toBe(1.5);
    expect(rig.horseState.halfWidth * 2).toBeCloseTo(1.3964844, 5);
  });

  it("falls back when runtime dimensions are NaN or non-positive", () => {
    const { pickRuntimeDimension, resolveHorseDimensions } = loadHorseSettingsModule();
    const { mcData } = loadMcData("1.17.1");
    const dims = resolveHorseDimensions(mcData, "horse");

    expect(pickRuntimeDimension(Number.NaN, dims.height)).toBe(dims.height);
    expect(pickRuntimeDimension(0, dims.height)).toBe(dims.height);
    expect(pickRuntimeDimension(-1, dims.width)).toBe(dims.width);
    expect(pickRuntimeDimension(undefined, dims.height)).toBe(dims.height);

    const state = HorseState.CREATE_FROM_ENTITY({ data: mcData } as any, {
      position: new Vec3(0, groundY, 0),
      velocity: new Vec3(0, 0, 0),
      height: Number.NaN,
      width: 0,
      yaw: 0,
      pitch: 0,
      name: "horse",
    } as any);
    expect(state.height).toBe(dims.height);
    expect(state.halfWidth * 2).toBe(dims.width);
  });
});

describe("Horse attribute extractors", () => {
  it("reads non-default movement speed far from fallback", () => {
    const { getHorseMovementSpeedAttribute } = loadHorseSettingsModule();
    const { mcData } = loadMcData("1.17.1");
    const speed = getHorseMovementSpeedAttribute(
      { "generic.movement_speed": { value: 0.99, modifiers: [] } },
      mcData,
    );
    expect(speed).toBeCloseTo(0.99, 5);
  });

  it("reads non-default jump strength far from fallback", () => {
    const { getHorseJumpStrengthAttribute } = loadHorseSettingsModule();
    const { mcData } = loadMcData("1.17.1");
    const jump = getHorseJumpStrengthAttribute(
      { "horse.jump_strength": { value: 0.15, modifiers: [] } },
      mcData,
    );
    expect(jump).toBeCloseTo(0.15, 5);
  });

  it("uses vanilla defaults before attributes arrive", () => {
    const state = HorseState.CREATE_FROM_ENTITY({ data: loadMcData("1.17.1").mcData } as any, {
      position: new Vec3(0, 64, 0),
      velocity: new Vec3(0, 0, 0),
      height: 1.6,
      width: 1.3964844,
      yaw: 0,
      pitch: 0,
    } as any);
    expect(state.movementSpeed).toBeCloseTo(0.225, 5);
    expect(state.jumpStrength).toBe(0.7);
  });

  it("keeps defaultJumpStrength as double 0.7 on 1.17.1 fallback", () => {
    const { getHorseJumpStrengthAttribute } = loadHorseSettingsModule();
    const { mcData } = loadMcData("1.17.1");
    expect(getHorseJumpStrengthAttribute({}, mcData)).toBe(0.7);
  });
});

describe("Horse collision BB", () => {
  it("uses getEntityBB dimensions for horse collision path", () => {
    const rig = createHorseRig({
      version,
      position: new Vec3(0, groundY, 0),
      floorY: groundY - 1,
    });
    const bb = rig.physics.getEntityBB(rig.horseCtx, rig.horseState.pos);
    expect(bb.maxY - bb.minY).toBeCloseTo(1.6, 3);
    expect(bb.maxX - bb.minX).toBeCloseTo(1.3964844, 4);
  });

  it("uses donkey height in collision BB", () => {
    const rig = createHorseRig({
      version,
      position: new Vec3(0, groundY, 0),
      floorY: groundY - 1,
      entityName: "donkey",
    });
    const bb = rig.physics.getEntityBB(rig.horseCtx, rig.horseState.pos);
    expect(bb.maxY - bb.minY).toBeCloseTo(1.5, 3);
  });
});

describe("Horse settings simulation parity", () => {
  it("isolates resolved settings between rigs", () => {
    const horseSection = loadHorseSettingsJson().horses;
    const originalGravity = horseSection.default.gravity;
    const rigA = createHorseRig({ version, position: new Vec3(0, groundY, 0), floorY: groundY - 1 });
    const rigB = createHorseRig({ version, position: new Vec3(0, groundY, 0), floorY: groundY - 1 });

    rigA.horseCtx.gravity = 999;
    expect(rigB.horseCtx.gravity).not.toBe(999);
    expect(horseSection.default.gravity).toBe(originalGravity);
  });

  it("matches exact first ground tick on stone", () => {
    const rig = createHorseRig({
      version,
      position: new Vec3(0, groundY, 0),
      floorY: groundY - 1,
    });
    simulateHorseTick(rig);
    expect(rig.horseState.pos.x).toBe(0);
    expect(rig.horseState.pos.y).toBe(groundY);
    expect(rig.horseState.pos.z).toBe(0);
    expect(rig.horseState.vel.x).toBe(0);
    expect(rig.horseState.vel.y).toBe(VANILLA_AIR_DROP_VEL_Y);
    expect(rig.horseState.vel.z).toBe(0);
  });

  it("matches exact first forward ground tick on stone", () => {
    const rig = createHorseRig({
      version,
      position: new Vec3(0, groundY, 0),
      floorY: groundY - 1,
    });
    rig.horseState.control.forward = true;
    simulateHorseTick(rig);
    expect(rig.horseState.pos.z).toBeCloseTo(-0.22049999309579482, 10);
    expect(rig.horseState.vel.z).toBeCloseTo(-0.12039300448399745, 10);
    expect(rig.horseState.vel.y).toBe(VANILLA_AIR_DROP_VEL_Y);
  });

  it("matches exact first forward ground tick on ice", () => {
    const rig = createHorseRig({
      version,
      position: new Vec3(0, groundY, 0),
      floorY: groundY - 1,
    });
    for (let x = -1; x <= 1; x++) {
      for (let z = -1; z <= 1; z++) {
        rig.world.setIce(new Vec3(x, groundY - 1, z));
      }
    }
    rig.horseState.control.forward = true;
    simulateHorseTick(rig);
    expect(rig.horseState.pos.z).toBeCloseTo(-0.05060391652869689, 12);
    expect(rig.horseState.vel.z).toBeCloseTo(-0.045128574939215405, 12);
    expect(rig.horseState.vel.y).toBe(VANILLA_AIR_DROP_VEL_Y);
  });
});
