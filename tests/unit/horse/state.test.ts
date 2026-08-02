import { describe, it } from "mocha";
import expect from "expect";
import { Vec3 } from "vec3";
import type { Entity } from "prismarine-entity";
import { createHorseRig } from "../../helpers/unit/botcraftTestSupport";

const version = "1.17.1";
const groundY = 64;

describe("HorseState entity sync", () => {
  it("applyToEntity keeps headYaw aligned with yaw", () => {
    const rig = createHorseRig({
      version,
      position: new Vec3(0, groundY, 0),
      floorY: groundY - 1,
    });
    rig.horseState.updateControls(rig.horseState.control, Math.PI / 3, -Math.PI / 8);

    const entity = {
      position: new Vec3(0, groundY, 0),
      velocity: new Vec3(0, 0, 0),
      yaw: 0,
      pitch: 0,
      headYaw: 0,
      onGround: true,
    } as Entity & { headYaw: number };

    rig.horseState.applyToEntity(entity);

    expect(entity.yaw).toBeCloseTo(Math.PI / 3, 5);
    expect(entity.pitch).toBeCloseTo(-Math.PI / 16, 5);
    expect(entity.headYaw).toBeCloseTo(Math.PI / 3, 5);
  });
});
