import { describe, it } from "mocha";
import expect from "expect";
import { Vec3 } from "vec3";
import {
  createHorseRig,
  loadMcData,
  simulateHorseTick,
} from "../../helpers/unit/botcraftTestSupport";

/* eslint-disable @typescript-eslint/no-require-imports */
function loadHorseSettingsModule() {
  return require("../../../src/physics/settings/horseSettings");
}
/* eslint-enable @typescript-eslint/no-require-imports */

const groundY = 64;

const versions = [
  {
    version: "1.14.4",
    entityNames: ["horse", "donkey"],
    movementKey: "generic.movementSpeed",
    jumpKey: "horse.jumpStrength",
    movementValue: 0.33,
    jumpValue: 0.55,
  },
  {
    version: "1.16.5",
    entityNames: ["horse", "mule"],
    movementKey: "generic.movement_speed",
    jumpKey: "horse.jump_strength",
    movementValue: 0.31,
    jumpValue: 0.45,
  },
  {
    version: "1.17.1",
    entityNames: ["horse", "skeleton_horse", "zombie_horse"],
    movementKey: "generic.movement_speed",
    jumpKey: "horse.jump_strength",
    movementValue: 0.29,
    jumpValue: 0.85,
  },
  {
    version: "1.20.1",
    entityNames: ["horse", "donkey"],
    movementKey: "generic.movement_speed",
    jumpKey: "horse.jump_strength",
    movementValue: 0.27,
    jumpValue: 0.65,
  },
  {
    version: "1.21.1",
    entityNames: ["horse"],
    movementKey: "generic.movement_speed",
    jumpKey: "generic.jump_strength",
    movementValue: 0.25,
    jumpValue: 0.75,
  },
  {
    version: "1.21.4",
    entityNames: ["horse", "donkey"],
    movementKey: "generic.movement_speed",
    jumpKey: "generic.jump_strength",
    movementValue: 0.23,
    jumpValue: 0.95,
  },
  {
    version: "1.21.11",
    entityNames: ["horse", "donkey"],
    movementKey: "generic.movement_speed",
    jumpKey: "generic.jump_strength",
    movementValue: 0.21,
    jumpValue: 0.35,
  },
];

function expectHorseLivingContext(rig: ReturnType<typeof createHorseRig>) {
  expect(rig.horseCtx.stepHeight).toBe(1.0);
  simulateHorseTick(rig);
  expect(rig.horseCtx.useControls).toBe(false);
  expect(rig.horseCtx.gravity).toBe(0.08);
  expect(rig.horseCtx.collisionBehavior).toEqual({
    blockEffects: true,
    affectedAfterCollision: true,
  });
}

describe("HorsePhysics multiversion compatibility", () => {
  for (const {
    version,
    entityNames,
    movementKey,
    jumpKey,
    movementValue,
    jumpValue,
  } of versions) {
    describe(version, () => {
      for (const entityName of entityNames) {
        describe(entityName, () => {
          it("resolves entity descriptor and dimensions", () => {
            const rig = createHorseRig({
              version,
              entityName,
              position: new Vec3(0, groundY, 0),
              floorY: groundY - 1,
            });

            expect(rig.entityDescriptor).toBe(rig.mcData.entitiesByName[entityName]);
            expect(rig.horseState.height).toBe(rig.entityDescriptor.height);
            expect(rig.horseState.halfWidth * 2).toBe(rig.entityDescriptor.width);
          });

          it("uses living-entity collision context with horse step height", () => {
            const rig = createHorseRig({
              version,
              entityName,
              position: new Vec3(0, groundY, 0),
              floorY: groundY - 1,
            });
            expectHorseLivingContext(rig);
          });

          it("reads movement and jump attributes from real packet keys", () => {
            const rig = createHorseRig({
              version,
              entityName,
              position: new Vec3(0, groundY, 0),
              floorY: groundY - 1,
              attributes: {
                [movementKey]: { value: movementValue, modifiers: [] },
                [jumpKey]: { value: jumpValue, modifiers: [] },
              },
            });

            expect(rig.horseState.movementSpeed).toBeCloseTo(movementValue, 5);
            expect(rig.horseState.jumpStrength).toBeCloseTo(jumpValue, 5);
          });

          it("moves forward under forward input", () => {
            const rig = createHorseRig({
              version,
              entityName,
              position: new Vec3(0, groundY, 0),
              floorY: groundY - 1,
            });
            rig.horseState.control.forward = true;
            simulateHorseTick(rig);
            expect(rig.horseState.pos.z).toBeLessThan(0);
          });

          it("keeps finite state after repeated ticks", () => {
            const rig = createHorseRig({
              version,
              entityName,
              position: new Vec3(0, groundY, 0),
              floorY: groundY - 1,
            });
            rig.horseState.control.forward = true;
            for (let i = 0; i < 20; i++) {
              simulateHorseTick(rig);
              expect(Number.isFinite(rig.horseState.pos.x)).toBe(true);
              expect(Number.isFinite(rig.horseState.pos.y)).toBe(true);
              expect(Number.isFinite(rig.horseState.pos.z)).toBe(true);
              expect(Number.isFinite(rig.horseState.vel.x)).toBe(true);
              expect(Number.isFinite(rig.horseState.vel.y)).toBe(true);
              expect(Number.isFinite(rig.horseState.vel.z)).toBe(true);
            }
          });
        });
      }
    });
  }
});

describe("HorsePhysics attribute key matrix", () => {
  it("reads 1.14.4 camelCase movementSpeed key", () => {
    const { getHorseMovementSpeedAttribute } = loadHorseSettingsModule();
    const { mcData } = loadMcData("1.14.4");
    const speed = getHorseMovementSpeedAttribute(
      { "generic.movementSpeed": { value: 0.42, modifiers: [] } },
      mcData,
    );
    expect(speed).toBeCloseTo(0.42, 5);
  });

  it("reads 1.21.x generic.jump_strength packet key", () => {
    const { getHorseJumpStrengthAttribute } = loadHorseSettingsModule();
    const { mcData } = loadMcData("1.21.1");
    const jump = getHorseJumpStrengthAttribute(
      { "generic.jump_strength": { value: 0.88, modifiers: [] } },
      mcData,
    );
    expect(jump).toBeCloseTo(0.88, 5);
  });

  it("falls back to defaults when no attribute key matches", () => {
    const { getHorseMovementSpeedAttribute, getHorseJumpStrengthAttribute } = loadHorseSettingsModule();
    const { mcData } = loadMcData("1.17.1");
    expect(getHorseMovementSpeedAttribute({}, mcData)).toBeCloseTo(0.225, 5);
    expect(getHorseJumpStrengthAttribute({}, mcData)).toBe(0.7);
  });

  it("applies float jump strength precision from 1.21+", () => {
    const { applyJumpStrengthPrecision, usesFloatJumpStrengthPrecision } = loadHorseSettingsModule();
    const mcData17 = loadMcData("1.17.1").mcData;
    const mcData21 = loadMcData("1.21.1").mcData;
    expect(usesFloatJumpStrengthPrecision(mcData17)).toBe(false);
    expect(usesFloatJumpStrengthPrecision(mcData21)).toBe(true);
    expect(applyJumpStrengthPrecision(0.7, mcData17)).toBe(0.7);
    expect(applyJumpStrengthPrecision(0.7, mcData21)).toBe(Math.fround(0.7));
  });

  it("casts movement speed to float like getRiddenSpeed", () => {
    const { applyMovementSpeedPrecision, getHorseMovementSpeedAttribute } = loadHorseSettingsModule();
    const { mcData } = loadMcData("1.17.1");
    const speed = getHorseMovementSpeedAttribute(
      { "generic.movement_speed": { value: 0.225, modifiers: [] } },
      mcData,
    );
    expect(speed).toBe(applyMovementSpeedPrecision(0.225));
  });
});
