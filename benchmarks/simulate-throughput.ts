import { performance } from "node:perf_hooks";
import { Vec3 } from "vec3";
import {
  createBoatRig,
  createBotcraftPlayerRig,
  createFlatWorld,
  createHorseRig,
} from "../tests/helpers/unit/botcraftTestSupport";

const version = "1.21.11";
const groundLevel = 64;

function measure(operation: () => void, iterations: number): number {
  for (let index = 0; index < 1_000; index++) operation();
  const start = performance.now();
  for (let index = 0; index < iterations; index++) operation();
  const elapsed = performance.now() - start;
  return elapsed * 1e6 / iterations;
}

function disableWorldCache(engine: object): void {
  const cache = Reflect.get(engine, "worldCache") as { begin(source: unknown): unknown };
  cache.begin = (source: unknown) => source;
}

function compare(name: string, baseline: () => void, optimized: () => void, iterations = 10_000): void {
  const baselineNs = measure(baseline, iterations);
  const optimizedNs = measure(optimized, iterations);
  console.log(
    `${name.padEnd(10)} ${baselineNs.toFixed(1).padStart(11)} ns/tick -> `
    + `${optimizedNs.toFixed(1).padStart(11)} ns/tick  ${(baselineNs / optimizedNs).toFixed(2)}x`,
  );
}

const baselinePlayer = createBotcraftPlayerRig({
  version,
  position: new Vec3(0, groundLevel, 0),
  groundLevel,
});
const optimizedPlayer = createBotcraftPlayerRig({
  version,
  position: new Vec3(0, groundLevel, 0),
  groundLevel,
});
disableWorldCache(baselinePlayer.physics);
const baselinePlayerWorld: Parameters<typeof baselinePlayer.physics.simulate>[1] = createFlatWorld(version, groundLevel);
const optimizedPlayerWorld: Parameters<typeof optimizedPlayer.physics.simulate>[1] = createFlatWorld(version, groundLevel);
compare(
  "Botcraft",
  () => baselinePlayer.physics.simulate(baselinePlayer.playerCtx, baselinePlayerWorld),
  () => optimizedPlayer.physics.simulate(optimizedPlayer.playerCtx, optimizedPlayerWorld),
);

const baselineBoat = createBoatRig({
  version,
  position: new Vec3(0, groundLevel, 0),
  floorY: groundLevel - 1,
  entityName: "oak_boat",
});
const optimizedBoat = createBoatRig({
  version,
  position: new Vec3(0, groundLevel, 0),
  floorY: groundLevel - 1,
  entityName: "oak_boat",
});
disableWorldCache(baselineBoat.physics);
compare(
  "Boat",
  () => baselineBoat.physics.simulate(baselineBoat.boatCtx, baselineBoat.world),
  () => optimizedBoat.physics.simulate(optimizedBoat.boatCtx, optimizedBoat.world),
);

const baselineHorse = createHorseRig({
  version,
  position: new Vec3(0, groundLevel, 0),
  floorY: groundLevel - 1,
});
const optimizedHorse = createHorseRig({
  version,
  position: new Vec3(0, groundLevel, 0),
  floorY: groundLevel - 1,
});
disableWorldCache(baselineHorse.physics);
compare(
  "Horse",
  () => baselineHorse.physics.simulate(baselineHorse.horseCtx, baselineHorse.world),
  () => optimizedHorse.physics.simulate(optimizedHorse.horseCtx, optimizedHorse.world),
);
