import { AABB } from "@nxg-org/mineflayer-util-plugin";
import { Vec3 } from "vec3";
import {
  classicCollidePacked,
  nativeAbiVersion,
  voxelCollidePacked,
} from "../../native";

const AABB_WIDTH = 6;
const INITIAL_COLLIDER_CAPACITY = 32;
// Below this point, the fixed Node-API call cost is larger than V8's typed-array
// loop on supported Node releases. Dense shapes go native; independent queries
// should use the Rust batch ABI.
const NATIVE_SINGLE_QUERY_MIN_COLLIDERS = 48;
const COLLISION_EPSILON = 1e-7;

type Vec3Like = { x: number; y: number; z: number };
type BlockLike = {
  position: Vec3Like;
  shapes: number[][];
};
type WorldLike = {
  getBlock(position: Vec3): BlockLike | null | undefined;
};

/**
 * Reusable, allocation-conscious bridge to the Rust collision kernels.
 *
 * Typed arrays are retained for the lifetime of the physics engine. A call only
 * crosses Node-API once after JavaScript has gathered prismarine-world's block
 * data; Rust never calls back into JavaScript from its inner collision loop.
 */
export class NativeCollisionWorkspace {
  public readonly abiVersion = nativeAbiVersion();

  private readonly cursor = new Vec3(0, 0, 0);
  private workspace = new Float64Array(10 + INITIAL_COLLIDER_CAPACITY * AABB_WIDTH);
  private output = this.workspace.subarray(7, 10);
  private colliderCount = 0;

  public classic(
    bb: AABB,
    dx: number,
    dy: number,
    dz: number,
    colliders: readonly AABB[],
  ): Float64Array {
    this.begin(bb, dx, dy, dz, colliders.length);
    for (const collider of colliders) this.pushAabb(collider);
    this.resolveClassic();
    return this.output;
  }

  public voxel(
    bb: AABB,
    dx: number,
    dy: number,
    dz: number,
    colliders: readonly AABB[],
  ): Float64Array {
    this.begin(bb, dx, dy, dz, colliders.length);
    for (const collider of colliders) this.pushAabb(collider);
    this.resolveVoxel();
    return this.output;
  }

  public classicWorld(
    bb: AABB,
    dx: number,
    dy: number,
    dz: number,
    queryBB: AABB,
    world: WorldLike,
  ): Float64Array {
    this.begin(bb, dx, dy, dz);
    this.pushWorld(queryBB, world);
    this.resolveClassic();
    return this.output;
  }

  public voxelWorld(
    bb: AABB,
    dx: number,
    dy: number,
    dz: number,
    queryBB: AABB,
    world: WorldLike,
    extraColliders: readonly AABB[] = [],
  ): Float64Array {
    this.begin(bb, dx, dy, dz, extraColliders.length);
    for (const collider of extraColliders) this.pushAabb(collider);
    this.pushWorld(queryBB, world);
    this.resolveVoxel();
    return this.output;
  }

  private begin(bb: AABB, dx: number, dy: number, dz: number, expectedColliders = 0): void {
    this.colliderCount = 0;
    this.ensureCapacity(expectedColliders);
    this.workspace[0] = 0;
    this.workspace[1] = bb.minX;
    this.workspace[2] = bb.minY;
    this.workspace[3] = bb.minZ;
    this.workspace[4] = bb.maxX;
    this.workspace[5] = bb.maxY;
    this.workspace[6] = bb.maxZ;
    this.workspace[7] = dx;
    this.workspace[8] = dy;
    this.workspace[9] = dz;
  }

  private pushWorld(queryBB: AABB, world: WorldLike): void {
    const cursor = this.cursor;
    for (cursor.y = Math.floor(queryBB.minY) - 1; cursor.y <= Math.floor(queryBB.maxY); cursor.y++) {
      for (cursor.z = Math.floor(queryBB.minZ); cursor.z <= Math.floor(queryBB.maxZ); cursor.z++) {
        for (cursor.x = Math.floor(queryBB.minX); cursor.x <= Math.floor(queryBB.maxX); cursor.x++) {
          const block = world.getBlock(cursor);
          if (!block) continue;
          const { x, y, z } = block.position;
          for (const shape of block.shapes) {
            if (shape.length < AABB_WIDTH) continue;
            this.pushValues(
              shape[0] + x,
              shape[1] + y,
              shape[2] + z,
              shape[3] + x,
              shape[4] + y,
              shape[5] + z,
            );
          }
        }
      }
    }
  }

  private pushAabb(bb: AABB): void {
    this.pushValues(bb.minX, bb.minY, bb.minZ, bb.maxX, bb.maxY, bb.maxZ);
  }

  private pushValues(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): void {
    this.ensureCapacity(this.colliderCount + 1);
    const offset = 10 + this.colliderCount * AABB_WIDTH;
    const data = this.workspace;
    data[offset] = minX;
    data[offset + 1] = minY;
    data[offset + 2] = minZ;
    data[offset + 3] = maxX;
    data[offset + 4] = maxY;
    data[offset + 5] = maxZ;
    this.colliderCount++;
    data[0] = this.colliderCount;
  }

  private ensureCapacity(requiredColliders: number): void {
    if (10 + requiredColliders * AABB_WIDTH <= this.workspace.length) return;
    let capacity = (this.workspace.length - 10) / AABB_WIDTH;
    while (capacity < requiredColliders) capacity *= 2;
    const replacement = new Float64Array(10 + capacity * AABB_WIDTH);
    replacement.set(this.workspace);
    this.workspace = replacement;
    this.output = replacement.subarray(7, 10);
  }

  private resolveClassic(): void {
    if (this.colliderCount === 0) return;
    if (this.colliderCount >= NATIVE_SINGLE_QUERY_MIN_COLLIDERS) {
      classicCollidePacked(this.workspace);
      return;
    }

    const data = this.workspace;
    let minX = data[1];
    let minY = data[2];
    const minZ = data[3];
    let maxX = data[4];
    let maxY = data[5];
    const maxZ = data[6];
    let dx = data[7];
    let dy = data[8];
    let dz = data[9];
    const end = 10 + this.colliderCount * AABB_WIDTH;

    for (let offset = 10; offset < end; offset += AABB_WIDTH) {
      if (maxX > data[offset] && minX < data[offset + 3] && maxZ > data[offset + 2] && minZ < data[offset + 5]) {
        if (dy > 0 && maxY <= data[offset + 1]) dy = Math.min(data[offset + 1] - maxY, dy);
        else if (dy < 0 && minY >= data[offset + 4]) dy = Math.max(data[offset + 4] - minY, dy);
      }
    }
    minY += dy;
    maxY += dy;

    for (let offset = 10; offset < end; offset += AABB_WIDTH) {
      if (maxY > data[offset + 1] && minY < data[offset + 4] && maxZ > data[offset + 2] && minZ < data[offset + 5]) {
        if (dx > 0 && maxX <= data[offset]) dx = Math.min(data[offset] - maxX, dx);
        else if (dx < 0 && minX >= data[offset + 3]) dx = Math.max(data[offset + 3] - minX, dx);
      }
    }
    minX += dx;
    maxX += dx;

    for (let offset = 10; offset < end; offset += AABB_WIDTH) {
      if (maxX > data[offset] && minX < data[offset + 3] && maxY > data[offset + 1] && minY < data[offset + 4]) {
        if (dz > 0 && maxZ <= data[offset + 2]) dz = Math.min(data[offset + 2] - maxZ, dz);
        else if (dz < 0 && minZ >= data[offset + 5]) dz = Math.max(data[offset + 5] - minZ, dz);
      }
    }
    data[7] = dx;
    data[8] = dy;
    data[9] = dz;
  }

  private resolveVoxel(): void {
    if (this.colliderCount === 0) return;
    if (this.colliderCount >= NATIVE_SINGLE_QUERY_MIN_COLLIDERS) {
      voxelCollidePacked(this.workspace);
      return;
    }

    const data = this.workspace;
    const box = [data[1], data[2], data[3], data[4], data[5], data[6]];
    let dx = data[7];
    let dy = data[8];
    let dz = data[9];
    if (dy !== 0) {
      dy = this.voxelAxis(1, box, dy);
      box[1] += dy;
      box[4] += dy;
    }
    const prioritizeZ = Math.abs(dx) < Math.abs(dz);
    if (prioritizeZ && dz !== 0) {
      dz = this.voxelAxis(2, box, dz);
      box[2] += dz;
      box[5] += dz;
    }
    if (dx !== 0) {
      dx = this.voxelAxis(0, box, dx);
      if (!prioritizeZ) {
        box[0] += dx;
        box[3] += dx;
      }
    }
    if (!prioritizeZ && dz !== 0) dz = this.voxelAxis(2, box, dz);
    data[7] = dx;
    data[8] = dy;
    data[9] = dz;
  }

  private voxelAxis(axis: number, box: number[], movement: number): number {
    if (Math.abs(movement) < COLLISION_EPSILON) return 0;
    const axis1 = (axis + 1) % 3;
    const axis2 = (axis + 2) % 3;
    const data = this.workspace;
    const end = 10 + this.colliderCount * AABB_WIDTH;
    let adjusted = movement;
    for (let offset = 10; offset < end; offset += AABB_WIDTH) {
      const overlaps1 = box[axis1 + 3] - COLLISION_EPSILON > data[offset + axis1]
        && box[axis1] + COLLISION_EPSILON < data[offset + axis1 + 3];
      const overlaps2 = box[axis2 + 3] - COLLISION_EPSILON > data[offset + axis2]
        && box[axis2] + COLLISION_EPSILON < data[offset + axis2 + 3];
      if (!overlaps1 || !overlaps2) continue;
      if (movement > 0) {
        const gap = data[offset + axis] - box[axis + 3];
        if (gap >= -COLLISION_EPSILON) adjusted = Math.min(adjusted, gap);
      } else {
        const gap = data[offset + axis + 3] - box[axis];
        if (gap <= COLLISION_EPSILON) adjusted = Math.max(adjusted, gap);
      }
    }
    return adjusted;
  }
}
