import { describe, it } from "mocha";
import expect from "expect";
import { Vec3 } from "vec3";
import {
  createHorseRig,
  simulateHorseTick,
} from "../../helpers/unit/botcraftTestSupport";

const version = "1.17.1";
const groundY = 64;

function setupGroundHorse() {
  return createHorseRig({
    version,
    position: new Vec3(0, groundY, 0),
    floorY: groundY - 1,
  });
}

describe("HorsePhysics movement", () => {
  it("moves forward when forward control is pressed", () => {
    const rig = setupGroundHorse();
    rig.horseState.control.forward = true;
    for (let i = 0; i < 5; i++) simulateHorseTick(rig);
    expect(rig.horseState.pos.z).toBeLessThan(0);
  });

  it("moves backward slower than forward", () => {
    const forwardRig = setupGroundHorse();
    forwardRig.horseState.control.forward = true;
    for (let i = 0; i < 10; i++) simulateHorseTick(forwardRig);
    const forwardDistance = Math.hypot(forwardRig.horseState.pos.x, forwardRig.horseState.pos.z);

    const backRig = setupGroundHorse();
    backRig.horseState.control.back = true;
    for (let i = 0; i < 10; i++) simulateHorseTick(backRig);
    const backDistance = Math.hypot(backRig.horseState.pos.x, backRig.horseState.pos.z);

    expect(forwardDistance).toBeGreaterThan(backDistance * 2);
  });

  it("strafes left and right with opposite X deltas", () => {
    const leftRig = setupGroundHorse();
    leftRig.horseState.control.left = true;
    simulateHorseTick(leftRig);
    const leftX = leftRig.horseState.pos.x;

    const rightRig = setupGroundHorse();
    rightRig.horseState.control.right = true;
    simulateHorseTick(rightRig);
    const rightX = rightRig.horseState.pos.x;

    expect(leftX).toBeLessThan(0);
    expect(rightX).toBeGreaterThan(0);
  });

  it("uses rider yaw for horse rotation", () => {
    const rig = setupGroundHorse();
    rig.horseState.updateControls(rig.horseState.control, Math.PI / 2, 0);
    expect(rig.horseState.yaw).toBeCloseTo(Math.PI / 2, 5);
  });

  it("sets horse pitch to half rider pitch", () => {
    const rig = setupGroundHorse();
    rig.horseState.updateControls(rig.horseState.control, 0, Math.PI / 4);
    expect(rig.horseState.pitch).toBeCloseTo(Math.PI / 8, 5);
  });

  it("does not apply sprint speed multiplier", () => {
    const normalRig = setupGroundHorse();
    normalRig.horseState.control.forward = true;
    for (let i = 0; i < 10; i++) simulateHorseTick(normalRig);
    const normalDistance = Math.hypot(normalRig.horseState.pos.x, normalRig.horseState.pos.z);

    const sprintRig = setupGroundHorse();
    sprintRig.horseState.control.forward = true;
    sprintRig.horseState.control.sprint = true;
    for (let i = 0; i < 10; i++) simulateHorseTick(sprintRig);
    const sprintDistance = Math.hypot(sprintRig.horseState.pos.x, sprintRig.horseState.pos.z);

    expect(Math.abs(sprintDistance - normalDistance)).toBeLessThan(0.01);
  });

  it("steps up a 1-block ledge", () => {
    const rig = setupGroundHorse();
    for (let x = -2; x <= 2; x++) {
      for (let z = -2; z <= 5; z++) {
        rig.world.setStone(new Vec3(x, groundY - 1, z));
      }
    }
    rig.world.setStone(new Vec3(0, groundY, -3));
    rig.horseState.control.forward = true;
    let maxY = rig.horseState.pos.y;
    for (let i = 0; i < 20; i++) {
      simulateHorseTick(rig);
      maxY = Math.max(maxY, rig.horseState.pos.y);
    }
    expect(maxY).toBeGreaterThanOrEqual(groundY + 1);
  });

  it("collides with a wall", () => {
    const rig = setupGroundHorse();
    for (let y = groundY - 1; y <= groundY + 2; y++) {
      rig.world.setStone(new Vec3(0, y, -3));
    }
    rig.horseState.control.forward = true;
    for (let i = 0; i < 30; i++) simulateHorseTick(rig);
    expect(rig.horseState.pos.z).toBeGreaterThan(-2.5);
  });

  it("moves faster on ice than stone", () => {
    const iceRig = setupGroundHorse();
    for (let x = -1; x <= 1; x++) {
      for (let z = -20; z <= 1; z++) {
        iceRig.world.setIce(new Vec3(x, groundY - 1, z));
      }
    }
    iceRig.horseState.control.forward = true;
    for (let i = 0; i < 20; i++) simulateHorseTick(iceRig);
    const iceSpeed = Math.hypot(iceRig.horseState.vel.x, iceRig.horseState.vel.z);

    const stoneRig = setupGroundHorse();
    stoneRig.horseState.control.forward = true;
    for (let i = 0; i < 20; i++) simulateHorseTick(stoneRig);
    const stoneSpeed = Math.hypot(stoneRig.horseState.vel.x, stoneRig.horseState.vel.z);

    expect(iceSpeed).toBeGreaterThan(stoneSpeed);
  });
});

describe("HorsePhysics diagonal input normalization", () => {
  it("leaves forward-only acceleration unchanged", () => {
    const rig = setupGroundHorse();
    rig.horseState.control.forward = true;
    simulateHorseTick(rig);
    expect(rig.horseState.pos.z).toBeCloseTo(-0.22049999309579482, 10);
    expect(rig.horseState.vel.z).toBeCloseTo(-0.12039300448399745, 10);
  });

  it("normalizes forward+strafe input like Entity#getInputVector", () => {
    const forwardRig = setupGroundHorse();
    forwardRig.horseState.control.forward = true;
    forwardRig.horseState.vel.set(0, 0, 0);
    simulateHorseTick(forwardRig);
    const forwardDelta = Math.hypot(forwardRig.horseState.vel.x, forwardRig.horseState.vel.z);

    const diagRig = setupGroundHorse();
    diagRig.horseState.control.forward = true;
    diagRig.horseState.control.left = true;
    diagRig.horseState.vel.set(0, 0, 0);
    simulateHorseTick(diagRig);
    const diagDelta = Math.hypot(diagRig.horseState.vel.x, diagRig.horseState.vel.z);

    const unnormalizedRatio = Math.sqrt(1.2005);
    expect(diagDelta).toBeGreaterThan(forwardDelta);
    expect(diagDelta / forwardDelta).toBeCloseTo(1 / 0.98, 5);
    expect(diagDelta).toBeLessThan(unnormalizedRatio * forwardDelta);
  });

  it("applies unit-length diagonal acceleration magnitude", () => {
    const rig = setupGroundHorse();
    rig.horseState.control.forward = true;
    rig.horseState.control.left = true;
    rig.horseState.vel.set(0, 0, 0);
    simulateHorseTick(rig);

    const groundFriction = 0.6;
    const horizontalFriction = groundFriction * 0.91;
    const acceleration =
      rig.horseState.movementSpeed *
      (0.21600002 / (groundFriction * groundFriction * groundFriction));
    const horizVel = Math.hypot(rig.horseState.vel.x, rig.horseState.vel.z);

    expect(horizVel / horizontalFriction).toBeCloseTo(acceleration, 7);
    expect(horizVel / horizontalFriction).toBeLessThan(Math.sqrt(1.2005) * acceleration);
  });

  it("does not produce NaN or movement for zero input", () => {
    const rig = setupGroundHorse();
    rig.horseState.vel.set(0, 0, 0);
    simulateHorseTick(rig);
    expect(Number.isNaN(rig.horseState.vel.x)).toBe(false);
    expect(Number.isNaN(rig.horseState.vel.y)).toBe(false);
    expect(Number.isNaN(rig.horseState.vel.z)).toBe(false);
    expect(rig.horseState.vel.x).toBe(0);
    expect(rig.horseState.vel.z).toBe(0);
  });
});
