# mineflayer-physics-utils

Drop-in Rust/Node-API acceleration for `@nxg-org/mineflayer-physics-util`.

The public JavaScript and TypeScript API is unchanged. Existing Mineflayer
plugins can upgrade without changing imports, constructors, state classes, or
simulation calls:

```ts
import physicsUtil, {
  BotcraftPhysics,
  BoatPhysics,
  EntityPhysics,
  HorsePhysics,
  EPhysicsCtx,
} from "@nxg-org/mineflayer-physics-util";

bot.loadPlugin(physicsUtil);

const engine = new BotcraftPhysics(bot.registry);
const state = EPhysicsCtx.FROM_ENTITY(engine, bot.entity);
engine.simulate(state, bot.world);
```

## Native design

The compatibility layer remains TypeScript so callers continue to receive the
same `Vec3`, `AABB`, state, settings, and engine objects. Collision resolution
and dense voxel-shape scans run in an optimized Rust `cdylib` through Node-API.

The boundary is deliberately coarse:

- Block shapes are gathered into retained `Float64Array` workspaces with no
  per-shape `AABB` allocation.
- A packed one-argument ABI avoids repeated Node-API argument conversion.
- Small collision sets stay in a specialized V8 typed-array loop when crossing
  the native boundary would cost more than the computation.
- Dense collision sets use Rust, while independent workloads can use the batch
  kernel and cross Node-API once for many queries.
- Workspaces grow geometrically and are reused for the lifetime of each engine.
- Repeated `world.getBlock` calls within a tick use an allocation-free,
  open-addressed coordinate cache with O(1) generation resets.
- The Rust release profile uses full LTO, one codegen unit, aborting panics, and
  stripped symbols.

This is important: moving every three-number calculation into native code is
slower. The adaptive boundary keeps the existing synchronous interface while
avoiding that trap.

## Supported prebuilds

Published releases provide Node-API binaries selected automatically by the
package manager. Users do not need Rust installed.

- Windows x64 and ARM64
- Linux x64 and ARM64, glibc and musl
- macOS x64 and Apple Silicon

Node.js 16 or newer is required.

## Development

Rust is only required when building from source.

```sh
pnpm install
pnpm build
pnpm test
pnpm bench:native
pnpm bench:simulate
```

`pnpm bench:native` reports raw Node-API overhead, single-query break-even
behavior, batched throughput, and an end-to-end block-gather/collision
comparison. Treat results as machine- and Node-version-specific; the adaptive
threshold exists because the boundary cost is measurable.

The native parity suite compares Rust against the original JavaScript
semantics over 20,000 deterministic randomized scenarios and separately checks
the multi-query batch ABI.

## Compatibility surface

The default Mineflayer loader and all existing named exports remain available:

- `PhysicsUtilWrapper`, `initSetup`
- `EPhysicsCtx`, `PhysicsWorldSettings`
- `EntityPhysics`, `BotcraftPhysics`, `BoatPhysics`, `HorsePhysics`
- `EntityState`, `PlayerState`, `BoatState`, `HorseState`, `BoatStatus`
- `PlayerPoses`, `ControlStateHandler`, `BaseSimulator`
- `convertPlayerState`, `applyToPlayerState`

The release workflow builds and publishes one optional npm package per target,
which is the standard `napi-rs` distribution model. The root loader first uses
a local development binary and otherwise selects the matching platform package.

## License

GPL-3.0
