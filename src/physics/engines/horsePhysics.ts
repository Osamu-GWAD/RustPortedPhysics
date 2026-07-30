import { AABB } from "@nxg-org/mineflayer-util-plugin";
import md from "minecraft-data";
import { Block } from "prismarine-block";
import { Vec3 } from "vec3";
import { EPhysicsCtx } from "../settings/entityPhysicsCtx";
import { HorsePhysicsSettings, resolveHorseSettings, computeHorseJumpPower, resolveWaterHorizontalSlowDown } from "../settings/horseSettings";
import { getHorseBlockBelowAffectingMovementPos } from "../settings/horseBlockSupport";
import { HorseState } from "../states/horseState";
import { IEntityState } from "../states";
import { EntityPhysics } from "./entityPhysics";

type PhysicsWorld = {
  getBlock(pos: Vec3): Block | null | undefined;
};

type LavaFluidScan = {
  fluidHeight: number;
  isInLava: boolean;
};

export class HorsePhysics extends EntityPhysics {
  private readonly horseSettings: HorsePhysicsSettings;

  constructor(mcData: md.IndexedData) {
    super(mcData);
    this.horseSettings = resolveHorseSettings(mcData);
  }

  simulate(simCtx: EPhysicsCtx, world: PhysicsWorld): IEntityState {
    if (!(simCtx.state instanceof HorseState)) {
      return super.simulate(simCtx, world);
    }

    const state = simCtx.state;
    if (!this.isWorldReady(simCtx, state, world)) {
      state.worldReady = false;
      return state;
    }

    state.worldReady = true;
    const cfg = this.horseSettings;

    this.applyHorseTravelContext(simCtx, state, cfg);

    this.updateFluidState(simCtx, state, world);
    this.applyRidersJump(simCtx, state, world, cfg);

    const { strafe, forward } = state.getTravelInput();
    if (state.isInWater) {
      this.travelInWater(simCtx, state, strafe, forward, world, cfg);
    } else if (state.isInLava) {
      this.travelInLava(simCtx, state, strafe, forward, world, cfg);
    } else {
      this.travelInAir(simCtx, state, strafe, forward, world, cfg);
    }

    state.age++;
    return state;
  }

  private getHorseBB(simCtx: EPhysicsCtx, state: HorseState): AABB {
    return this.getEntityBB(simCtx, state.pos);
  }

  private getLavaQueryBB(simCtx: EPhysicsCtx, _state: HorseState): AABB {
    // Vanilla LivingEntity.updateFluidHeightAndDoFluidPushing: getBoundingBox().deflate(0.001)
    return this.getHorseBB(simCtx, _state).contract(0.001, 0.001, 0.001);
  }

  private getWorldReadinessBlockRange(simCtx: EPhysicsCtx, state: HorseState): {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    minZ: number;
    maxZ: number;
  } {
    const bb = this.getHorseBB(simCtx, state);
    const input = state.getTravelInput();
    const yaw = Math.PI - state.yaw;
    const sin = Math.sin(yaw);
    const cos = Math.cos(yaw);
    const dx = input.strafe * cos - input.forward * sin;
    const dz = input.forward * cos + input.strafe * sin;
    const swept = bb.clone().extend(dx, state.vel.y, dz);
    const stepBB = bb.clone().extend(dx, simCtx.stepHeight, dz);
    const margin = 1;

    return {
      minX: Math.floor(Math.min(bb.minX, swept.minX, stepBB.minX)) - margin,
      maxX: Math.ceil(Math.max(bb.maxX, swept.maxX, stepBB.maxX)) + margin,
      minY: Math.floor(Math.min(bb.minY, swept.minY, stepBB.minY)) - margin,
      maxY: Math.ceil(Math.max(bb.maxY, swept.maxY, stepBB.maxY)) + margin,
      minZ: Math.floor(Math.min(bb.minZ, swept.minZ, stepBB.minZ)) - margin,
      maxZ: Math.ceil(Math.max(bb.maxZ, swept.maxZ, stepBB.maxZ)) + margin,
    };
  }

  private isWorldReady(simCtx: EPhysicsCtx, state: HorseState, world: PhysicsWorld): boolean {
    const range = this.getWorldReadinessBlockRange(simCtx, state);
    const cursor = new Vec3(0, 0, 0);

    for (cursor.y = range.minY; cursor.y < range.maxY; cursor.y++) {
      for (cursor.z = range.minZ; cursor.z < range.maxZ; cursor.z++) {
        for (cursor.x = range.minX; cursor.x < range.maxX; cursor.x++) {
          if (world.getBlock(cursor) == null) {
            return false;
          }
        }
      }
    }
    return true;
  }

  private updateFluidState(simCtx: EPhysicsCtx, state: HorseState, world: PhysicsWorld): void {
    const vel = state.vel;
    const waterBB = this.getHorseBB(simCtx, state).contract(0.001, state.vel.y < 0 ? 0.401 : 0.001, 0.001);
    state.isInWater = this.isInWaterApplyCurrent(waterBB, vel, world);

    const lavaScan = this.scanLavaFluid(simCtx, state, world);
    state.isInLava = lavaScan.isInLava;
  }

  private applyHorseTravelContext(simCtx: EPhysicsCtx, state: HorseState, cfg: HorsePhysicsSettings): void {
    simCtx.gravity = cfg.gravity;
    simCtx.waterGravity = cfg.gravity / 16;
    simCtx.lavaGravity = cfg.gravity / 4;
    simCtx.airdrag = cfg.verticalDrag;
    simCtx.airborneInertia = cfg.groundFrictionMultiplier;
    simCtx.airborneAccel = state.movementSpeed * cfg.airborneAccelFactor;
    simCtx.waterInertia = resolveWaterHorizontalSlowDown(state.species, this.data);
    simCtx.lavaInertia = cfg.lavaHorizontalInertia;
    simCtx.liquidAccel = cfg.liquidAccel;
    simCtx.stepHeight = cfg.stepHeight;
    simCtx.useControls = false;
    // gravityThenDrag is preserved for living-context compatibility only;
    // scoped air/water/lava branches encode their respective vanilla order directly.
    simCtx.gravityThenDrag = true;
    simCtx.collisionBehavior = { blockEffects: true, affectedAfterCollision: true };
  }

  private getBlockBelowAffectingMovement(
    simCtx: EPhysicsCtx,
    state: HorseState,
    world: PhysicsWorld,
  ): Vec3 {
    const bb = this.getHorseBB(simCtx, state);
    return getHorseBlockBelowAffectingMovementPos(
      this.data,
      state.pos,
      bb.minY,
      state.supportingBlockPos,
      (pos) => world.getBlock(pos),
    );
  }

  private getGroundFriction(
    simCtx: EPhysicsCtx,
    state: HorseState,
    world: PhysicsWorld,
    cfg: HorsePhysicsSettings,
  ): number {
    if (!state.onGround) return 1.0;
    const blockPos = this.getBlockBelowAffectingMovement(simCtx, state, world);
    const block = world.getBlock(blockPos);
    if (!block || block.boundingBox === "empty") return cfg.defaultBlockFriction;
    return Math.fround(this.blockSlipperiness[block.type] ?? cfg.defaultBlockFriction);
  }

  private getBlockJumpFactor(simCtx: EPhysicsCtx, state: HorseState, world: PhysicsWorld, cfg: HorsePhysicsSettings): number {
    const posBlock = world.getBlock(state.pos.floored());
    const belowBlock = world.getBlock(this.getBlockBelowAffectingMovement(simCtx, state, world));
    const posFactor = this.getBlockJumpFactorForBlock(posBlock, cfg);
    const belowFactor = this.getBlockJumpFactorForBlock(belowBlock, cfg);
    return posFactor === 1.0 ? belowFactor : posFactor;
  }

  private getBlockJumpFactorForBlock(block: Block | null | undefined, cfg: HorsePhysicsSettings): number {
    if (!block) return 1.0;
    if (block.type === this.honeyblockId) return cfg.honeyJumpFactor;
    return 1.0;
  }

  /** executeRidersJump — direct Y assignment, no Math.max. */
  private applyRidersJump(
    simCtx: EPhysicsCtx,
    state: HorseState,
    world: PhysicsWorld,
    cfg: HorsePhysicsSettings,
  ): void {
    if (!state.onGround) return;
    if (state.jumpPendingScale <= 0 || state.isJumping) return;

    const blockJumpFactor = this.getBlockJumpFactor(simCtx, state, world, cfg);
    state.vel.y = computeHorseJumpPower(
      state.jumpStrength,
      state.jumpPendingScale,
      blockJumpFactor,
      state.jumpBoost,
      this.data,
    );
    state.isJumping = true;
    state.onGround = false;

    const { forward } = state.getTravelInput();
    if (forward > 0) {
      const notchianYaw = Math.PI - state.yaw;
      const sin = Math.sin(notchianYaw);
      const cos = Math.cos(notchianYaw);
      const impulse = cfg.forwardJumpImpulse * state.jumpPendingScale;
      state.vel.x -= impulse * sin;
      state.vel.z += impulse * cos;
    }

    state.jumpPendingScale = 0;
  }

  private travelInAir(
    simCtx: EPhysicsCtx,
    state: HorseState,
    strafe: number,
    forward: number,
    world: PhysicsWorld,
    cfg: HorsePhysicsSettings,
  ): void {
    const groundFriction = this.getGroundFriction(simCtx, state, world, cfg);
    const horizontalFriction = groundFriction * cfg.groundFrictionMultiplier;
    const acceleration = state.onGround
      ? state.movementSpeed *
        (cfg.frictionInfluencedSpeedFactor / (groundFriction * groundFriction * groundFriction))
      : state.movementSpeed * cfg.airborneAccelFactor;

    this.applyHorseHeading(simCtx, strafe, forward, acceleration);
    this.moveEntity(simCtx, state.vel.x, state.vel.y, state.vel.z, world);

    state.vel.y = (state.vel.y - cfg.gravity) * cfg.verticalDrag;
    state.vel.x *= horizontalFriction;
    state.vel.z *= horizontalFriction;

    if (!state.onGround && state.vel.y <= 0) {
      state.isJumping = false;
    }
    if (state.onGround) {
      state.isJumping = false;
      state.clearGroundJumpPending();
    }
  }

  private travelInWater(
    simCtx: EPhysicsCtx,
    state: HorseState,
    strafe: number,
    forward: number,
    world: PhysicsWorld,
    cfg: HorsePhysicsSettings,
  ): void {
    const lastY = state.pos.y;
    this.applyHorseHeading(simCtx, strafe, forward, cfg.liquidAccel);
    this.moveEntity(simCtx, state.vel.x, state.vel.y, state.vel.z, world);

    const waterHorizontalSlowDown = resolveWaterHorizontalSlowDown(state.species, this.data);
    const liquidVerticalInertia = cfg.liquidVerticalInertia;

    // Vanilla LivingEntity.travel water branch: drag then getFluidFallingAdjustedMovement (gravity/16).
    state.vel.x *= waterHorizontalSlowDown;
    state.vel.y = state.vel.y * liquidVerticalInertia - simCtx.waterGravity;
    state.vel.z *= waterHorizontalSlowDown;

    this.applyOutOfLiquidImpulse(simCtx, state, world, lastY);
  }

  private travelInLava(
    simCtx: EPhysicsCtx,
    state: HorseState,
    strafe: number,
    forward: number,
    world: PhysicsWorld,
    cfg: HorsePhysicsSettings,
  ): void {
    const lastY = state.pos.y;
    this.applyHorseHeading(simCtx, strafe, forward, cfg.liquidAccel);
    this.moveEntity(simCtx, state.vel.x, state.vel.y, state.vel.z, world);

    const { fluidHeight } = this.scanLavaFluid(simCtx, state, world);
    const lavaScale = cfg.lavaHorizontalInertia;
    const liquidVerticalInertia = cfg.liquidVerticalInertia;
    if (fluidHeight <= cfg.lavaShallowThreshold) {
      state.vel.x *= lavaScale;
      state.vel.y = state.vel.y * liquidVerticalInertia - simCtx.waterGravity;
      state.vel.z *= lavaScale;
    } else {
      state.vel.x *= lavaScale;
      state.vel.y *= lavaScale;
      state.vel.z *= lavaScale;
    }

    state.vel.y -= simCtx.lavaGravity;

    this.applyOutOfLiquidImpulse(simCtx, state, world, lastY);
  }

  private applyOutOfLiquidImpulse(
    simCtx: EPhysicsCtx,
    state: HorseState,
    world: PhysicsWorld,
    lastY: number,
  ): void {
    if (
      state.isCollidedHorizontally &&
      this.doesNotCollide(simCtx, state.pos.offset(state.vel.x, 0.6 - state.pos.y + lastY, state.vel.z), world)
    ) {
      state.vel.y = simCtx.worldSettings.outOfLiquidImpulse;
    }
  }

  /** Vanilla getFluidHeight(FluidTags.LAVA) scoped to horse BB.
   *  Lava fluid flow pushing (updateFluidHeightAndDoFluidPushing) is out of scope for this PR. */
  private scanLavaFluid(simCtx: EPhysicsCtx, state: HorseState, world: PhysicsWorld): LavaFluidScan {
    const bb = this.getLavaQueryBB(simCtx, state);
    let maxFluidHeight = 0;
    let isInLava = false;
    const cursor = new Vec3(0, 0, 0);

    for (cursor.y = Math.floor(bb.minY); cursor.y <= Math.floor(bb.maxY); cursor.y++) {
      for (cursor.z = Math.floor(bb.minZ); cursor.z <= Math.floor(bb.maxZ); cursor.z++) {
        for (cursor.x = Math.floor(bb.minX); cursor.x <= Math.floor(bb.maxX); cursor.x++) {
          const block = world.getBlock(cursor);
          if (!block || block.type !== this.lavaId) continue;

          const blockFluidHeight = this.getLavaFluidHeightInBlock(block, world, cursor);
          if (blockFluidHeight <= 0) continue;

          const fluidBottom = cursor.y;
          const fluidTop = fluidBottom + blockFluidHeight;
          // Vanilla: fluid present when fluidTop >= bb.minY (touching surface counts).
          if (fluidTop < bb.minY || fluidBottom >= bb.maxY) continue;

          isInLava = true;
          const heightInEntity = Math.min(fluidTop, bb.maxY) - bb.minY;
          if (heightInEntity > maxFluidHeight) {
            maxFluidHeight = heightInEntity;
          }
        }
      }
    }

    return { fluidHeight: maxFluidHeight, isInLava };
  }

  private getLavaFluidHeightInBlock(block: Block, world: PhysicsWorld, pos: Vec3): number {
    const above = world.getBlock(pos.offset(0, 1, 0));
    if (above && above.type === this.lavaId) {
      return 1;
    }
    return 1 - this.getLavaLiquidHeightFraction(block);
  }

  /** Filled fraction of block column: source = 8/9 (LivingEntity.getLiquidHeight). */
  private getLavaLiquidHeightFraction(block: Block): number {
    const depth = this.getLavaRenderedDepth(block);
    return (depth + 1) / 9;
  }

  private getLavaRenderedDepth(block: Block): number {
    const props = block.getProperties?.();
    if (props && props.level != null) {
      const level = typeof props.level === "number" ? props.level : parseInt(String(props.level), 10);
      if (!Number.isNaN(level)) {
        return level >= 8 ? 0 : level;
      }
    }
    const meta = block.metadata;
    return meta >= 8 ? 0 : meta;
  }

  private applyHorseHeading(simCtx: EPhysicsCtx, strafe: number, forward: number, acceleration: number): void {
    const state = simCtx.state as HorseState;
    const lengthSqr = strafe * strafe + forward * forward;
    if (lengthSqr < 1e-7) {
      return;
    }

    let normStrafe = strafe;
    let normForward = forward;
    if (lengthSqr > 1.0) {
      const length = Math.sqrt(lengthSqr);
      normStrafe = strafe / length;
      normForward = forward / length;
    }

    const yaw = Math.PI - state.yaw;
    const sin = Math.sin(yaw);
    const cos = Math.cos(yaw);
    const offsetX = normStrafe * cos - normForward * sin;
    const offsetZ = normForward * cos + normStrafe * sin;
    state.vel.x += offsetX * acceleration;
    state.vel.z += offsetZ * acceleration;
  }
}
