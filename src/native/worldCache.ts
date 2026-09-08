import { Vec3 } from "vec3";

export type BlockWorld<Block> = {
  getBlock(position: Vec3): Block | null | undefined;
};

const CACHE_CAPACITY = 512;
const CACHE_MASK = CACHE_CAPACITY - 1;

/**
 * Per-tick, allocation-free cache for the JavaScript world boundary.
 *
 * Physics branches repeatedly ask prismarine-world for the same coordinates.
 * Avoiding duplicate Block construction matters more than moving tiny vector
 * operations across Node-API. A generation array makes reset O(1), and open
 * addressing avoids Map keys and string allocation.
 */
export class TickWorldCache<Block> implements BlockWorld<Block> {
  private readonly generations = new Uint32Array(CACHE_CAPACITY);
  private readonly xs = new Int32Array(CACHE_CAPACITY);
  private readonly ys = new Int32Array(CACHE_CAPACITY);
  private readonly zs = new Int32Array(CACHE_CAPACITY);
  private readonly blocks: Array<Block | null | undefined> = new Array(CACHE_CAPACITY);
  private generation = 1;
  private source: BlockWorld<Block> | undefined;

  public begin(source: BlockWorld<Block>): this {
    this.source = source;
    this.generation++;
    if (this.generation === 0xffffffff) {
      this.generations.fill(0);
      this.generation = 1;
    }
    return this;
  }

  public getBlock(position: Vec3): Block | null | undefined {
    const source = this.source;
    if (!source) return undefined;

    const x = Math.floor(position.x);
    const y = Math.floor(position.y);
    const z = Math.floor(position.z);
    let slot = (
      Math.imul(x, 73_856_093)
      ^ Math.imul(y, 19_349_663)
      ^ Math.imul(z, 83_492_791)
    ) & CACHE_MASK;

    for (let probes = 0; probes < CACHE_CAPACITY; probes++) {
      if (this.generations[slot] !== this.generation) {
        const block = source.getBlock(position);
        this.generations[slot] = this.generation;
        this.xs[slot] = x;
        this.ys[slot] = y;
        this.zs[slot] = z;
        this.blocks[slot] = block;
        return block;
      }
      if (this.xs[slot] === x && this.ys[slot] === y && this.zs[slot] === z) {
        return this.blocks[slot];
      }
      slot = (slot + 1) & CACHE_MASK;
    }

    // Extremely large entities can exceed the fixed cache. Preserve behavior
    // instead of resizing during a hot tick.
    return source.getBlock(position);
  }
}
