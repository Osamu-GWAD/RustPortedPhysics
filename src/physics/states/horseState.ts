import type { Entity } from "prismarine-entity";
import md from "minecraft-data";
import { Vec3 } from "vec3";
import type { IPhysics } from "../engines/IPhysics";
import {
  computeChargeScale,
  computePendingJumpScale,
  floorRidingChargeIndex,
  getHorseJumpStrengthAttribute,
  getHorseMovementSpeedAttribute,
  HorsePhysicsSettings,
  pickRuntimeDimension,
  resolveHorseDimensions,
  resolveHorseSettings,
} from "../settings/horseSettings";
import { ControlStateHandler } from "../player/playerControls";
import { EntityState } from "./entityState";

export type HorseJumpRelease = {
  released: boolean;
  jumpBoost: number;
};

export class HorseState extends EntityState {
  movementSpeed: number;
  jumpStrength: number;

  jumpChargeTicks = 0;
  jumpChargeScale = 0;
  jumpPendingScale = 0;
  previousJumpInput = false;
  isJumping = false;
  allowStandSliding = false;
  /** Out of scope for physics engine — saddle gate remains in consumer. */
  saddled = false;

  worldReady = true;
  attributesReady = false;

  riderYaw = 0;
  riderPitch = 0;

  private readonly settings: HorsePhysicsSettings;

  constructor(
    ctx: IPhysics,
    height: number,
    halfWidth: number,
    pos: Vec3,
    vel: Vec3,
    onGround: boolean,
    yaw: number,
    pitch: number,
    control: ControlStateHandler = ControlStateHandler.DEFAULT(),
    settings?: HorsePhysicsSettings,
  ) {
    super(ctx, height, halfWidth, pos, vel, onGround, yaw, pitch, control);
    this.settings = settings ?? resolveHorseSettings(ctx.data);
    this.movementSpeed = this.settings.defaultMovementSpeed;
    this.jumpStrength = this.settings.defaultJumpStrength;
  }

  public static CREATE_FROM_ENTITY(
    ctx: IPhysics,
    entity: Entity,
    control: ControlStateHandler = ControlStateHandler.DEFAULT(),
  ): HorseState {
    const settings = resolveHorseSettings(ctx.data);
    const dims = resolveHorseDimensions(ctx.data, entity.name);
    const height = pickRuntimeDimension(entity.height, dims.height);
    const width = pickRuntimeDimension(entity.width, dims.width);

    const state = new HorseState(
      ctx,
      height,
      width / 2,
      entity.position.clone(),
      entity.velocity.clone(),
      entity.onGround ?? false,
      entity.yaw,
      entity.pitch,
      control,
      settings,
    );
    state.updateFromHorseEntity(entity);
    return state;
  }

  public static getMovementSpeedFromAttributes(
    entityAttributes: Entity["attributes"] | undefined,
    mcData: md.IndexedData,
  ): number {
    return getHorseMovementSpeedAttribute(entityAttributes, mcData);
  }

  public static getJumpStrengthFromAttributes(
    entityAttributes: Entity["attributes"] | undefined,
    mcData: md.IndexedData,
  ): number {
    return getHorseJumpStrengthAttribute(entityAttributes, mcData);
  }

  public updateFromHorseEntity(entity: Entity): HorseState {
    if (entity.attributes) {
      this.movementSpeed = getHorseMovementSpeedAttribute(entity.attributes, this.ctx.data);
      this.jumpStrength = getHorseJumpStrengthAttribute(entity.attributes, this.ctx.data);
      this.attributesReady = true;
    }
    return this;
  }

  public updateControls(control: ControlStateHandler, riderYaw: number, riderPitch: number): HorseState {
    this.control = control.clone();
    this.riderYaw = riderYaw;
    this.riderPitch = riderPitch;
    this.yaw = riderYaw;
    this.pitch = Math.fround(riderPitch * 0.5);
    return this;
  }

  public updateJumpCharge(jumpInput: boolean): HorseJumpRelease {
    const result: HorseJumpRelease = { released: false, jumpBoost: 0 };

    if (!jumpInput && this.previousJumpInput) {
      this.jumpPendingScale = computePendingJumpScale(floorRidingChargeIndex(this.jumpChargeScale));
      result.released = true;
      result.jumpBoost = floorRidingChargeIndex(this.jumpChargeScale);
      this.jumpChargeTicks = -10;
    } else if (jumpInput && !this.previousJumpInput) {
      this.jumpChargeTicks = 0;
      this.jumpChargeScale = 0;
    } else if (jumpInput) {
      this.jumpChargeTicks++;
      this.jumpChargeScale = computeChargeScale(this.jumpChargeTicks);
    } else {
      this.jumpChargeScale = 0;
    }

    this.previousJumpInput = jumpInput;
    return result;
  }

  public getTravelInput(): { strafe: number; forward: number } {
    const control = this.control;
    const strafe = Math.fround(
      ((control.left ? 1 : 0) - (control.right ? 1 : 0)) * this.settings.inputStrafeScale,
    );
    let forward = Math.fround(
      ((control.forward ? 1 : 0) - (control.back ? 1 : 0)) * this.settings.inputForwardScale,
    );
    if (forward <= 0) {
      forward = Math.fround(forward * this.settings.inputBackwardScale);
    }
    return { strafe, forward };
  }

  public clearGroundJumpPending(): void {
    this.jumpPendingScale = 0;
  }

  public rebaseFromEntity(entity: Entity, options?: { replaceVelocity?: boolean }): HorseState {
    this.pos.set(entity.position.x, entity.position.y, entity.position.z);
    if (options?.replaceVelocity !== false) {
      this.vel.set(entity.velocity.x, entity.velocity.y, entity.velocity.z);
    }
    this.yaw = entity.yaw;
    this.pitch = entity.pitch;
    this.onGround = entity.onGround ?? false;
    const entityExtras = entity as Entity & {
      isCollidedHorizontally?: boolean;
      isCollidedVertically?: boolean;
    };
    this.isCollidedHorizontally = entityExtras.isCollidedHorizontally ?? false;
    this.isCollidedVertically = entityExtras.isCollidedVertically ?? false;
    this.updateFromHorseEntity(entity);
    return this;
  }

  public applyToEntity(entity: Entity) {
    entity.position.set(this.pos.x, this.pos.y, this.pos.z);
    entity.velocity.set(this.vel.x, this.vel.y, this.vel.z);
    entity.yaw = this.yaw;
    entity.pitch = this.pitch;
    entity.onGround = this.onGround;
    const entityExtras = entity as Entity & {
      isCollidedHorizontally?: boolean;
      isCollidedVertically?: boolean;
    };
    entityExtras.isCollidedHorizontally = this.isCollidedHorizontally;
    entityExtras.isCollidedVertically = this.isCollidedVertically;
    return this;
  }

  public clone(): HorseState {
    const other = new HorseState(
      this.ctx,
      this.height,
      this.halfWidth,
      this.pos.clone(),
      this.vel.clone(),
      this.onGround,
      this.yaw,
      this.pitch,
      this.control.clone(),
      this.settings,
    );
    other.movementSpeed = this.movementSpeed;
    other.jumpStrength = this.jumpStrength;
    other.jumpChargeTicks = this.jumpChargeTicks;
    other.jumpChargeScale = this.jumpChargeScale;
    other.jumpPendingScale = this.jumpPendingScale;
    other.previousJumpInput = this.previousJumpInput;
    other.isJumping = this.isJumping;
    other.allowStandSliding = this.allowStandSliding;
    other.saddled = this.saddled;
    other.worldReady = this.worldReady;
    other.attributesReady = this.attributesReady;
    other.riderYaw = this.riderYaw;
    other.riderPitch = this.riderPitch;
    other.age = this.age;
    other.isCollidedHorizontally = this.isCollidedHorizontally;
    other.isCollidedVertically = this.isCollidedVertically;
    other.isInWater = this.isInWater;
    other.isInLava = this.isInLava;
    other.supportingBlockPos = this.supportingBlockPos?.clone() ?? null;
    other.jumpBoost = this.jumpBoost;
    return other;
  }
}
