'use strict'
/* eslint-disable @typescript-eslint/no-require-imports */

const { performance } = require('node:perf_hooks')
const {
  voxelCollidePacked,
  voxelCollideBatchInto,
  voxelCollideInto,
} = require('../native')
const { AABB } = require('@nxg-org/mineflayer-util-plugin')
const { NativeCollisionWorkspace } = require('../dist/native/collision')

const EPSILON = 1e-7

function axisOffset (axis, bb, colliders, movement) {
  if (Math.abs(movement) < EPSILON) return 0
  const axis1 = (axis + 1) % 3
  const axis2 = (axis + 2) % 3
  let adjusted = movement
  for (let offset = 0; offset < colliders.length; offset += 6) {
    if (
      bb[axis1 + 3] - EPSILON > colliders[offset + axis1] &&
      bb[axis1] + EPSILON < colliders[offset + axis1 + 3] &&
      bb[axis2 + 3] - EPSILON > colliders[offset + axis2] &&
      bb[axis2] + EPSILON < colliders[offset + axis2 + 3]
    ) {
      if (movement > 0) {
        const gap = colliders[offset + axis] - bb[axis + 3]
        if (gap >= -EPSILON) adjusted = Math.min(adjusted, gap)
      } else {
        const gap = colliders[offset + axis + 3] - bb[axis]
        if (gap <= EPSILON) adjusted = Math.max(adjusted, gap)
      }
    }
  }
  return adjusted
}

function jsVoxel (sourceBox, movement, colliders, output) {
  const bb = sourceBox.slice()
  let dx = movement[0]
  let dy = movement[1]
  let dz = movement[2]
  if (dy !== 0) {
    dy = axisOffset(1, bb, colliders, dy)
    bb[1] += dy
    bb[4] += dy
  }
  const prioritizeZ = Math.abs(dx) < Math.abs(dz)
  if (prioritizeZ && dz !== 0) {
    dz = axisOffset(2, bb, colliders, dz)
    bb[2] += dz
    bb[5] += dz
  }
  if (dx !== 0) {
    dx = axisOffset(0, bb, colliders, dx)
    if (!prioritizeZ) {
      bb[0] += dx
      bb[3] += dx
    }
  }
  if (!prioritizeZ && dz !== 0) dz = axisOffset(2, bb, colliders, dz)
  output[0] = dx
  output[1] = dy
  output[2] = dz
}

function makeColliders (count) {
  const data = new Float64Array(count * 6)
  for (let index = 0; index < count; index++) {
    const offset = index * 6
    const x = (index % 11) - 5
    const y = (Math.floor(index / 11) % 5) - 2
    const z = (Math.floor(index / 55) % 11) - 5
    data.set([x, y, z, x + 1, y + 1, z + 1], offset)
  }
  return data
}

function measure (name, iterations, operation) {
  for (let index = 0; index < 10_000; index++) operation(index)
  const start = performance.now()
  for (let index = 0; index < iterations; index++) operation(index)
  const elapsed = performance.now() - start
  return { name, ns: elapsed * 1e6 / iterations }
}

function runSingle (colliderCount) {
  const bb = new Float64Array([-0.3, 0, -0.3, 0.3, 1.8, 0.3])
  const movement = new Float64Array([0.22, -0.08, 0.17])
  const colliders = makeColliders(colliderCount)
  const output = new Float64Array(3)
  const iterations = colliderCount < 32 ? 1_000_000 : 250_000
  const js = measure(`JS ${colliderCount}`, iterations, () => jsVoxel(bb, movement, colliders, output))
  const rust = measure(`Rust ${colliderCount}`, iterations, () => voxelCollideInto(bb, movement, colliders, colliderCount, output))
  const packed = new Float64Array(10 + colliders.length)
  packed[0] = colliderCount
  packed.set(bb, 1)
  packed.set(movement, 7)
  packed.set(colliders, 10)
  const rustPacked = measure(`Rust packed ${colliderCount}`, iterations, () => {
    packed.set(movement, 7)
    voxelCollidePacked(packed)
  })
  return { colliderCount, js: js.ns, rust: rust.ns, rustPacked: rustPacked.ns, speedup: js.ns / rustPacked.ns }
}

function runBatch (queryCount, colliderCount) {
  const boxes = new Float64Array(queryCount * 6)
  const movements = new Float64Array(queryCount * 3)
  const colliders = new Float64Array(queryCount * colliderCount * 6)
  const ranges = new Uint32Array(queryCount * 2)
  const oneSet = makeColliders(colliderCount)
  for (let index = 0; index < queryCount; index++) {
    boxes.set([-0.3, 0, -0.3, 0.3, 1.8, 0.3], index * 6)
    movements.set([0.22, -0.08, 0.17], index * 3)
    colliders.set(oneSet, index * colliderCount * 6)
    ranges[index * 2] = index * colliderCount
    ranges[index * 2 + 1] = colliderCount
  }
  const output = new Float64Array(queryCount * 3)
  const iterations = 25_000
  const rust = measure('Rust batch', iterations, () => voxelCollideBatchInto(boxes, movements, colliders, ranges, output))
  return rust.ns / queryCount
}

console.log('Node-API collision cost (lower is better; reusable typed arrays, release build)')
console.log('colliders | JS ns/query | Rust 5-arg | Rust packed | packed speedup')
for (const count of [0, 4, 16, 64, 256]) {
  const row = runSingle(count)
  console.log(`${String(count).padStart(9)} | ${row.js.toFixed(1).padStart(11)} | ${row.rust.toFixed(1).padStart(10)} | ${row.rustPacked.toFixed(1).padStart(11)} | ${row.speedup.toFixed(2)}x`)
}
console.log(`256-query Rust batch with 16 colliders: ${runBatch(256, 16).toFixed(1)} ns/query`)

function runWorldBridge () {
  const playerBB = new AABB(-0.3, 0, -0.3, 0.3, 1.8, 0.3)
  const queryBB = playerBB.clone().extend(0.22, -0.08, 0.17)
  const movement = [0.22, -0.08, 0.17]
  const output = new Float64Array(3)
  const workspace = new NativeCollisionWorkspace()
  const solidShape = [[0, 0, 0, 1, 1, 1]]
  const emptyShape = []
  const world = {
    getBlock (position) {
      const x = Math.floor(position.x)
      const y = Math.floor(position.y)
      const z = Math.floor(position.z)
      const solid = y < 0 || (x === 1 && y < 2) || (z === 1 && y === 0)
      return { position: { x, y, z }, shapes: solid ? solidShape : emptyShape }
    }
  }

  function oldObjectPath () {
    const colliders = []
    for (let y = Math.floor(queryBB.minY) - 1; y <= Math.floor(queryBB.maxY); y++) {
      for (let z = Math.floor(queryBB.minZ); z <= Math.floor(queryBB.maxZ); z++) {
        for (let x = Math.floor(queryBB.minX); x <= Math.floor(queryBB.maxX); x++) {
          const block = world.getBlock({ x, y, z })
          for (const shape of block.shapes) {
            colliders.push(new AABB(
              shape[0] + x,
              shape[1] + y,
              shape[2] + z,
              shape[3] + x,
              shape[4] + y,
              shape[5] + z
            ))
          }
        }
      }
    }
    let bb = playerBB.clone()
    output[1] = movement[1]
    for (const collider of colliders) output[1] = collider.computeOffsetY(bb, output[1])
    bb.translate(0, output[1], 0)
    output[0] = movement[0]
    for (const collider of colliders) output[0] = collider.computeOffsetX(bb, output[0])
    bb.translate(output[0], 0, 0)
    output[2] = movement[2]
    for (const collider of colliders) output[2] = collider.computeOffsetZ(bb, output[2])
  }

  const iterations = 250_000
  const old = measure('object world path', iterations, oldObjectPath)
  const rust = measure('native world path', iterations, () => {
    workspace.classicWorld(playerBB, movement[0], movement[1], movement[2], queryBB, world)
  })
  console.log(`end-to-end block gather + collision: JS objects ${old.ns.toFixed(1)} ns, adaptive bridge ${rust.ns.toFixed(1)} ns, ${(old.ns / rust.ns).toFixed(2)}x`)
}

runWorldBridge()
