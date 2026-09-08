import { expect } from "expect";
import { Vec3 } from "vec3";
import { TickWorldCache } from "../../../src/native/worldCache";

describe("per-tick world cache", () => {
  it("deduplicates fractional positions in the same block", () => {
    let calls = 0;
    const source = {
      getBlock(position: Vec3) {
        calls++;
        return { x: Math.floor(position.x), y: Math.floor(position.y), z: Math.floor(position.z) };
      },
    };
    const cache = new TickWorldCache<{ x: number; y: number; z: number }>().begin(source);
    const first = cache.getBlock(new Vec3(10.1, 64.9, -3.1));
    const second = cache.getBlock(new Vec3(10.8, 64.1, -3.9));
    expect(second).toBe(first);
    expect(calls).toBe(1);
  });

  it("starts a fresh generation for every simulation tick", () => {
    let value = 0;
    const source = { getBlock: () => ++value };
    const cache = new TickWorldCache<number>();
    cache.begin(source);
    expect(cache.getBlock(new Vec3(0, 0, 0))).toBe(1);
    expect(cache.getBlock(new Vec3(0, 0, 0))).toBe(1);
    cache.begin(source);
    expect(cache.getBlock(new Vec3(0, 0, 0))).toBe(2);
  });

  it("stores null and undefined results without repeating source calls", () => {
    let calls = 0;
    const source = { getBlock: () => (calls++ === 0 ? null : undefined) };
    const cache = new TickWorldCache<object>().begin(source);
    expect(cache.getBlock(new Vec3(1, 2, 3))).toBeNull();
    expect(cache.getBlock(new Vec3(1, 2, 3))).toBeNull();
    expect(calls).toBe(1);
  });
});
