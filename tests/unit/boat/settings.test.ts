import { describe, it } from "mocha";
import expect from "expect";
import type { Entity } from "prismarine-entity";
import { Vec3 } from "vec3";
import { BoatState, BoatStatus } from "../../../src/physics/states/boatState";
import {
  createBoatRig,
  fillWaterColumn,
  loadMcData,
  simulateBoatTick,
} from "../../helpers/unit/botcraftTestSupport";

/* eslint-disable @typescript-eslint/no-require-imports */
function loadBoatSettingsModule() {
  return require("../../../src/physics/settings/boatSettings");
}

function loadBoatSettingsJson() {
  return require("../../../src/physics/info/entity_physics.json");
}

function loadEPhysicsCtx() {
  return require("../../../src/physics/settings").EPhysicsCtx;
}
/* eslint-enable @typescript-eslint/no-require-imports */

const BASELINE_IN_WATER = {
  pos: { x: 0, y: 63.593703703861685, z: 0 },
  vel: { x: 0, y: -0.006296296138316393, z: 0 },
};

const BASELINE_ON_LAND = {
  pos: { x: 0, y: 63.96000000089407, z: -0.03999999910593033 },
  vel: { x: 0, y: -0.03999999910593033, z: -0.03999999910593033 },
};

describe("Boat settings resolution", () => {
  it("normalizes float32 fields and preserves double fields from default", () => {
    const { FLOAT32_FIELDS, resolveBoatSettings } = loadBoatSettingsModule();
    const boatSection = loadBoatSettingsJson().boats;
    const defaultSettings = boatSection.default;
    const { mcData } = loadMcData("1.17.1");
    const resolved = resolveBoatSettings(mcData);

    for (const field of FLOAT32_FIELDS) {
      expect(resolved[field]).toBe(Math.fround(defaultSettings[field]));
    }

    const doubleFields = Object.keys(defaultSettings).filter(
      (key: string) => !FLOAT32_FIELDS.includes(key),
    );

    for (const field of doubleFields) {
      expect(resolved[field]).toBe(defaultSettings[field]);
    }

    expect(resolved).not.toHaveProperty("height");
    expect(resolved).not.toHaveProperty("width");
  });

  it("returns default settings for an unknown major version", () => {
    const { FLOAT32_FIELDS, resolveBoatSettingsFromSection } = loadBoatSettingsModule();
    const defaultSettings = loadBoatSettingsJson().boats.default;
    const { mcData } = loadMcData("1.17.1");
    const fakeMcData = {
      ...mcData,
      version: { ...mcData.version, majorVersion: "99.99" },
    };
    const resolved = resolveBoatSettingsFromSection(fakeMcData, loadBoatSettingsJson().boats);

    for (const field of FLOAT32_FIELDS) {
      expect(resolved[field]).toBe(Math.fround(defaultSettings[field]));
    }
  });

  it("applies version-specific overrides and normalizes overridden float32 values", () => {
    const { resolveBoatSettingsFromSection } = loadBoatSettingsModule();
    const boatSection = loadBoatSettingsJson().boats;
    const { mcData } = loadMcData("1.17.1");
    const testSection = {
      ...boatSection,
      overrides: [{ versions: ["1.17"], values: { gravity: 0.05 } }],
    };

    const onTarget = resolveBoatSettingsFromSection(mcData, testSection);
    expect(onTarget.gravity).toBe(Math.fround(0.05));

    const offTarget = resolveBoatSettingsFromSection(
      { ...mcData, version: { ...mcData.version, majorVersion: "1.15" } },
      testSection,
    );
    expect(offTarget.gravity).toBe(Math.fround(boatSection.default.gravity));
  });

  it("lets the last matching override win when multiple entries match", () => {
    const { resolveBoatSettingsFromSection } = loadBoatSettingsModule();
    const boatSection = loadBoatSettingsJson().boats;
    const { mcData } = loadMcData("1.17.1");
    const testSection = {
      ...boatSection,
      overrides: [
        { versions: ["1.17"], values: { forwardAcceleration: 0.01 } },
        { versions: ["1.17"], values: { forwardAcceleration: 0.02 } },
      ],
    };

    const resolved = resolveBoatSettingsFromSection(mcData, testSection);
    expect(resolved.forwardAcceleration).toBe(Math.fround(0.02));
  });

  it("isolates resolved settings from JSON and from each other", () => {
    const boatSection = loadBoatSettingsJson().boats;
    const originalGravity = boatSection.default.gravity;
    const rigA = createBoatRig({ version: "1.17.1", position: new Vec3(0, 64, 0) });
    const rigB = createBoatRig({ version: "1.17.1", position: new Vec3(0, 64, 0) });

    expect(rigA.boatCtx.boat).toBeDefined();
    expect(rigB.boatCtx.boat).toBeDefined();
    rigA.boatCtx.boat!.gravity = 999;
    expect(rigB.boatCtx.boat!.gravity).not.toBe(999);
    expect(boatSection.default.gravity).toBe(originalGravity);
  });
});

describe("Boat settings simulation parity", () => {
  const version = "1.17.1";
  const waterSurfaceY = 64;
  const boatY = waterSurfaceY - 0.4;

  it("matches baseline IN_WATER tick exactly", () => {
    const rig = createBoatRig({ version, position: new Vec3(0, boatY, 0), floorY: waterSurfaceY - 2 });
    for (let x = -1; x <= 1; x++) {
      for (let z = -1; z <= 1; z++) {
        fillWaterColumn(rig.world, x, z, waterSurfaceY - 1, waterSurfaceY - 1, 0);
      }
    }
    rig.boatState.status = BoatStatus.IN_WATER;
    rig.boatState.previousStatus = BoatStatus.IN_WATER;
    rig.boatState.waterLevel = waterSurfaceY;
    simulateBoatTick(rig);

    expect(rig.boatState.pos.x).toBe(BASELINE_IN_WATER.pos.x);
    expect(rig.boatState.pos.y).toBe(BASELINE_IN_WATER.pos.y);
    expect(rig.boatState.pos.z).toBe(BASELINE_IN_WATER.pos.z);
    expect(rig.boatState.vel.x).toBe(BASELINE_IN_WATER.vel.x);
    expect(rig.boatState.vel.y).toBe(BASELINE_IN_WATER.vel.y);
    expect(rig.boatState.vel.z).toBe(BASELINE_IN_WATER.vel.z);
  });

  it("matches baseline ON_LAND controlled tick exactly", () => {
    const rig = createBoatRig({ version, position: new Vec3(0, waterSurfaceY, 0), floorY: waterSurfaceY - 1 });
    rig.boatState.status = BoatStatus.ON_LAND;
    rig.boatState.previousStatus = BoatStatus.ON_LAND;
    rig.boatState.landFriction = 0.6;
    rig.boatState.controllingPlayer = true;
    rig.boatState.control.forward = true;
    simulateBoatTick(rig);

    expect(rig.boatState.pos.x).toBe(BASELINE_ON_LAND.pos.x);
    expect(rig.boatState.pos.y).toBe(BASELINE_ON_LAND.pos.y);
    expect(rig.boatState.pos.z).toBe(BASELINE_ON_LAND.pos.z);
    expect(rig.boatState.vel.x).toBe(BASELINE_ON_LAND.vel.x);
    expect(rig.boatState.vel.y).toBe(BASELINE_ON_LAND.vel.y);
    expect(rig.boatState.vel.z).toBe(BASELINE_ON_LAND.vel.z);
  });

  it("simulates boat physics when FROM_ENTITY_STATE has no entityType", () => {
    const EPhysicsCtx = loadEPhysicsCtx();
    const rig = createBoatRig({ version, position: new Vec3(0, boatY, 0), floorY: waterSurfaceY - 2 });
    for (let x = -1; x <= 1; x++) {
      for (let z = -1; z <= 1; z++) {
        fillWaterColumn(rig.world, x, z, waterSurfaceY - 1, waterSurfaceY - 1, 0);
      }
    }
    rig.boatState.status = BoatStatus.IN_WATER;
    rig.boatState.previousStatus = BoatStatus.IN_WATER;
    rig.boatState.waterLevel = waterSurfaceY;

    const boatCtx = EPhysicsCtx.FROM_ENTITY_STATE(rig.physics, rig.boatState);
    expect(boatCtx.boat).toBeUndefined();

    rig.physics.simulate(boatCtx, rig.world);

    expect(rig.boatState.pos.y).toBe(BASELINE_IN_WATER.pos.y);
    expect(rig.boatState.vel.y).toBe(BASELINE_IN_WATER.vel.y);
  });
});

describe("Boat dimensions resolution", () => {
  const cases = [
    { version: "1.11.2", width: 1.5, height: 0.6 },
    { version: "1.12.2", width: 1.5, height: 0.6 },
    { version: "1.13.2", width: 1.375, height: 0.6 },
    { version: "1.14.4", width: 1.375, height: 0.5625 },
    { version: "1.21.4", width: 1.375, height: 0.5625 },
  ];

  for (const { version, width, height } of cases) {
    it(`resolves boat dimensions for ${version}`, () => {
      const { resolveBoatDimensions } = loadBoatSettingsModule();
      const { mcData } = loadMcData(version);
      const dims = resolveBoatDimensions(mcData);
      expect(dims.width).toBe(width);
      expect(dims.height).toBe(height);
    });
  }

  it("resolves dimensions by explicit entity name", () => {
    const { resolveBoatDimensions } = loadBoatSettingsModule();
    const { mcData } = loadMcData("1.17.1");
    const fakeMcData = {
      ...mcData,
      entitiesByName: {
        ...mcData.entitiesByName,
        wide_boat: { name: "wide_boat", width: 2.5, height: 0.8 },
        narrow_raft: { name: "narrow_raft", width: 1.0, height: 0.4 },
      },
    };
    expect(resolveBoatDimensions(fakeMcData, "wide_boat")).toEqual({ width: 2.5, height: 0.8 });
    expect(resolveBoatDimensions(fakeMcData, "narrow_raft")).toEqual({ width: 1.0, height: 0.4 });
  });

  it("uses version-correct dimensions when entity lacks height and width", () => {
    const rig = createBoatRig({ version: "1.11.2", position: new Vec3(0, 64, 0) });
    const entity: Partial<Entity> = {
      position: new Vec3(0, 64, 0),
      velocity: new Vec3(0, 0, 0),
      yaw: 0,
      pitch: 0,
      onGround: false,
      name: "boat",
    };
    const state = BoatState.CREATE_FROM_ENTITY(rig.physics, entity as Entity);
    expect(state.height).toBe(0.6);
    expect(state.halfWidth).toBe(1.5 / 2);
  });

  it("rejects partially filled entity descriptors and continues the chain", () => {
    const { resolveBoatDimensions } = loadBoatSettingsModule();
    const { mcData } = loadMcData("1.17.1");
    const fakeMcData = {
      ...mcData,
      entitiesByName: {
        ...mcData.entitiesByName,
        broken_boat: { name: "broken_boat", width: 1.375 },
      },
    };
    const fallback = { width: 9, height: 9 };
    const dims = resolveBoatDimensions(fakeMcData, "broken_boat", fallback);
    expect(dims).toEqual({ width: 1.375, height: 0.5625 });
  });

  it("returns the provided fallback when no boat entities exist", () => {
    const { resolveBoatDimensions } = loadBoatSettingsModule();
    const { mcData } = loadMcData("1.17.1");
    const fakeMcData = {
      ...mcData,
      entitiesByName: { player: mcData.entitiesByName.player },
    };
    const fallback = { width: 2, height: 1 };
    const dims = resolveBoatDimensions(fakeMcData, undefined, fallback);
    expect(dims).toEqual(fallback);
  });
});
