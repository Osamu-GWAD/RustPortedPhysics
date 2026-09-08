import { expect } from "expect";
import { AABB } from "@nxg-org/mineflayer-util-plugin";
import {
  classicCollideInto,
  nativeAbiVersion,
  voxelCollideBatchInto,
  voxelCollideInto,
} from "../../../native";
import { NativeCollisionWorkspace } from "../../../src/native/collision";

const EPSILON = 1e-7;

type Box = [number, number, number, number, number, number];
type Movement = [number, number, number];

function axisOffset(axis: number, bb: Box, colliders: Float64Array, movement: number, epsilon = 0): number {
  if (epsilon !== 0 && Math.abs(movement) < epsilon) return 0;
  const axis1 = (axis + 1) % 3;
  const axis2 = (axis + 2) % 3;
  let adjusted = movement;
  for (let offset = 0; offset < colliders.length; offset += 6) {
    const overlaps1 = bb[axis1 + 3] - epsilon > colliders[offset + axis1]
      && bb[axis1] + epsilon < colliders[offset + axis1 + 3];
    const overlaps2 = bb[axis2 + 3] - epsilon > colliders[offset + axis2]
      && bb[axis2] + epsilon < colliders[offset + axis2 + 3];
    if (!overlaps1 || !overlaps2) continue;
    if (movement > 0) {
      const gap = colliders[offset + axis] - bb[axis + 3];
      if (gap >= -epsilon) adjusted = Math.min(adjusted, gap);
    } else if (movement < 0) {
      const gap = colliders[offset + axis + 3] - bb[axis];
      if (gap <= epsilon) adjusted = Math.max(adjusted, gap);
    }
  }
  return adjusted;
}

function moveBox(bb: Box, axis: number, amount: number): void {
  bb[axis] += amount;
  bb[axis + 3] += amount;
}

function referenceClassic(box: Box, movement: Movement, colliders: Float64Array): Movement {
  const bb = [...box] as Box;
  const dy = axisOffset(1, bb, colliders, movement[1]);
  moveBox(bb, 1, dy);
  const dx = axisOffset(0, bb, colliders, movement[0]);
  moveBox(bb, 0, dx);
  const dz = axisOffset(2, bb, colliders, movement[2]);
  return [dx, dy, dz];
}

function referenceVoxel(box: Box, movement: Movement, colliders: Float64Array): Movement {
  const bb = [...box] as Box;
  let [dx, dy, dz] = movement;
  if (dy !== 0) {
    dy = axisOffset(1, bb, colliders, dy, EPSILON);
    if (dy !== 0) moveBox(bb, 1, dy);
  }
  const prioritizeZ = Math.abs(dx) < Math.abs(dz);
  if (prioritizeZ && dz !== 0) {
    dz = axisOffset(2, bb, colliders, dz, EPSILON);
    if (dz !== 0) moveBox(bb, 2, dz);
  }
  if (dx !== 0) {
    dx = axisOffset(0, bb, colliders, dx, EPSILON);
    if (!prioritizeZ && dx !== 0) moveBox(bb, 0, dx);
  }
  if (!prioritizeZ && dz !== 0) dz = axisOffset(2, bb, colliders, dz, EPSILON);
  return [dx, dy, dz];
}

function rng(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 0x100000000;
  };
}

function randomScenario(random: () => number, count: number): { box: Box; movement: Movement; colliders: Float64Array } {
  const x = random() * 20 - 10;
  const y = random() * 8 - 4;
  const z = random() * 20 - 10;
  const box: Box = [x, y, z, x + 0.6, y + 1.8, z + 0.6];
  const movement: Movement = [random() * 3 - 1.5, random() * 3 - 1.5, random() * 3 - 1.5];
  const colliders = new Float64Array(count * 6);
  for (let index = 0; index < count; index++) {
    const offset = index * 6;
    const minX = x + random() * 6 - 3;
    const minY = y + random() * 5 - 2.5;
    const minZ = z + random() * 6 - 3;
    colliders[offset] = minX;
    colliders[offset + 1] = minY;
    colliders[offset + 2] = minZ;
    colliders[offset + 3] = minX + 0.1 + random() * 1.5;
    colliders[offset + 4] = minY + 0.1 + random() * 1.5;
    colliders[offset + 5] = minZ + 0.1 + random() * 1.5;
  }
  return { box, movement, colliders };
}

function assertExactMovement(actual: Float64Array, expected: Movement, scenarioIndex: number): void {
  for (let axis = 0; axis < 3; axis++) {
    if (!Object.is(actual[axis], expected[axis])) {
      throw new Error(`movement mismatch in scenario ${scenarioIndex}, axis ${axis}: ${actual[axis]} !== ${expected[axis]}`);
    }
  }
}

describe("Rust Node-API collision kernels", function () {
  this.timeout(15_000);
  it("loads the expected native ABI", () => {
    expect(nativeAbiVersion()).toBe(1);
  });

  it("preserves signed zero components", () => {
    const output = new Float64Array(3);
    const box = new Float64Array([0, 0, 0, 1, 1, 1]);
    const movement = new Float64Array([-0, -0, -0]);
    voxelCollideInto(box, movement, new Float64Array(0), 0, output);
    expect(Object.is(output[0], -0)).toBe(true);
    expect(Object.is(output[1], -0)).toBe(true);
    expect(Object.is(output[2], -0)).toBe(true);
  });

  it("matches classic node-aabb semantics over randomized inputs", () => {
    const random = rng(0xc0111de);
    const output = new Float64Array(3);
    for (let index = 0; index < 10_000; index++) {
      const scenario = randomScenario(random, index % 24);
      classicCollideInto(
        new Float64Array(scenario.box),
        new Float64Array(scenario.movement),
        scenario.colliders,
        scenario.colliders.length / 6,
        output,
      );
      assertExactMovement(output, referenceClassic(scenario.box, scenario.movement, scenario.colliders), index);
    }
  });

  it("matches Botcraft epsilon semantics over randomized inputs", () => {
    const random = rng(0xb07c4f7);
    const output = new Float64Array(3);
    for (let index = 0; index < 10_000; index++) {
      const scenario = randomScenario(random, index % 24);
      voxelCollideInto(
        new Float64Array(scenario.box),
        new Float64Array(scenario.movement),
        scenario.colliders,
        scenario.colliders.length / 6,
        output,
      );
      assertExactMovement(output, referenceVoxel(scenario.box, scenario.movement, scenario.colliders), index);
    }
  });

  it("batches independent queries without changing their results", () => {
    const random = rng(0xba7c123);
    const queryCount = 128;
    const colliderCount = 16;
    const boxes = new Float64Array(queryCount * 6);
    const movements = new Float64Array(queryCount * 3);
    const colliders = new Float64Array(queryCount * colliderCount * 6);
    const ranges = new Uint32Array(queryCount * 2);
    const output = new Float64Array(queryCount * 3);
    for (let index = 0; index < queryCount; index++) {
      const scenario = randomScenario(random, colliderCount);
      boxes.set(scenario.box, index * 6);
      movements.set(scenario.movement, index * 3);
      colliders.set(scenario.colliders, index * colliderCount * 6);
      ranges[index * 2] = index * colliderCount;
      ranges[index * 2 + 1] = colliderCount;
    }

    voxelCollideBatchInto(boxes, movements, colliders, ranges, output);
    for (let index = 0; index < queryCount; index++) {
      const box = [...boxes.subarray(index * 6, index * 6 + 6)] as Box;
      const movement = [...movements.subarray(index * 3, index * 3 + 3)] as Movement;
      const colliderStart = index * colliderCount * 6;
      const queryColliders = colliders.slice(colliderStart, colliderStart + colliderCount * 6);
      expect([...output.subarray(index * 3, index * 3 + 3)]).toEqual(referenceVoxel(box, movement, queryColliders));
    }
  });

  it("packs dense AABB objects through the adaptive workspace", () => {
    const box = new AABB(0, 0, 0, 0.6, 1.8, 0.6);
    const movement: Movement = [0.8, -0.2, 0.4];
    const colliders: AABB[] = [];
    for (let index = 0; index < 63; index++) {
      colliders.push(new AABB(10 + index, 10, 10, 11 + index, 11, 11));
    }
    colliders.push(new AABB(1, -1, 0, 2, 2, 1));
    const packed = new Float64Array(colliders.flatMap((collider) => collider.toArray()));
    const workspace = new NativeCollisionWorkspace();

    expect([...workspace.classic(box, ...movement, colliders)]).toEqual(
      referenceClassic(box.toArray(), movement, packed),
    );
    expect([...workspace.voxel(box, ...movement, colliders)]).toEqual(
      referenceVoxel(box.toArray(), movement, packed),
    );
  });
});
