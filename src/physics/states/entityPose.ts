import type { Entity } from "prismarine-entity";
import { PlayerPoses } from "./poses";

export type Heading = {
  forward: number;
  strafe: number;
};

export function getPose(entity: Entity) {
  const pose = entity.metadata.find((e) => (e as any)?.type === 18);
  return pose ? ((pose as any).value as number) : PlayerPoses.STANDING;
}
