import type { Effect, Entity } from "prismarine-entity";
import type { Vec3 } from "vec3";
import type { AABB } from "@nxg-org/mineflayer-util-plugin";
import type { ControlStateHandler } from "../player/playerControls";
import type { PlayerPoses } from "./poses";

export interface IEntityState {
  age: number;
  height: number;
  halfWidth: number;
  pos: Vec3;
  vel: Vec3;
  pitch: number;
  yaw: number;
  pose: PlayerPoses;
  control: ControlStateHandler;
  onGround: boolean;
  onClimbable: boolean;

  attributes: Entity["attributes"];

  isUsingItem: boolean;
  isInWater: boolean;
  isInLava: boolean;
  isInWeb: boolean;
  fallFlying: boolean;
  elytraFlying: boolean;
  validElytraEquipped: boolean;
  fireworkRocketDuration: number;
  sneakCollision: boolean;
  isCollidedHorizontally: boolean;
  isCollidedVertically: boolean;

  effects: Effect[];
  jumpBoost: number;
  speed: number;
  slowness: number;
  dolphinsGrace: number;
  slowFalling: number;
  levitation: number;
  depthStrider: number;

  jumpTicks: number;
  jumpQueued: boolean;

  supportingBlockPos: Vec3 | null;

  clone(): IEntityState;

  getBB(): AABB;
}
