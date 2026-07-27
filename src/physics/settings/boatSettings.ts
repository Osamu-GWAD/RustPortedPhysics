import md from "minecraft-data";
import info from "../info/entity_physics.json";

/** Boat physics tuning parameters. Dimensions are resolved separately. */
export interface BoatPhysicsSettings {
  /** Downward acceleration per tick (float32 in vanilla). */
  gravity: number;
  /** Buoyancy force when fully submerged (float32). */
  buoyancyUnderWater: number;
  /** Vertical acceleration under flowing water (float32). */
  flowingWaterVerticalAccel: number;
  /** Yaw change per tick when turning; equals Math.PI / 180 (double). */
  rotationPerTick: number;
  /** Default block slipperiness when block type is unknown (double). */
  defaultBlockFriction: number;
  /** Forward control acceleration (float32). */
  forwardAcceleration: number;
  /** Backward control acceleration, stored positive (float32). */
  backwardAcceleration: number;
  /** Turn-only acceleration when not moving forward/back (float32). */
  turnOnlyAcceleration: number;
  /** Inv-friction fallback before status is known (float32). */
  fallbackInvFriction: number;
  /** Inv-friction in calm water (float32). */
  inWaterInvFriction: number;
  /** Inv-friction under flowing water (float32). */
  underFlowingWaterInvFriction: number;
  /** Inv-friction when fully submerged (float32). */
  underWaterInvFriction: number;
  /** Inv-friction in air (float32). */
  inAirInvFriction: number;
  /** Divisor applied to land friction when a player controls the boat (double). */
  controlledLandFrictionDivisor: number;
  /** Divisor for gravity in buoyancy formula (double). */
  buoyancyGravityDivisor: number;
  /** Damping multiplier after buoyancy (double). */
  buoyancyDamping: number;
  /** Y offset when snapping into water from air (double). */
  waterEntryYOffset: number;
}

export interface BoatDimensions {
  height: number;
  width: number;
}

export interface BoatSettingsSection {
  default: BoatPhysicsSettings;
  fallbackDimensions: BoatDimensions;
  overrides: Array<{ versions: string[]; values: Partial<BoatPhysicsSettings> }>;
}

/** Fields that pass through float32 in vanilla boat arithmetic. */
export const FLOAT32_FIELDS = [
  "gravity",
  "buoyancyUnderWater",
  "flowingWaterVerticalAccel",
  "forwardAcceleration",
  "backwardAcceleration",
  "turnOnlyAcceleration",
  "fallbackInvFriction",
  "inWaterInvFriction",
  "underFlowingWaterInvFriction",
  "underWaterInvFriction",
  "inAirInvFriction",
] as const;

const boatSection = info.boats as unknown as BoatSettingsSection;

function hasValidDimensions(entity: md.Entity | undefined): entity is md.Entity & { height: number; width: number } {
  return (
    entity != null &&
    typeof entity.height === "number" &&
    !Number.isNaN(entity.height) &&
    typeof entity.width === "number" &&
    !Number.isNaN(entity.width)
  );
}

function applyFloat32Normalization(settings: BoatPhysicsSettings): BoatPhysicsSettings {
  const result = { ...settings };
  for (const field of FLOAT32_FIELDS) {
    result[field] = Math.fround(result[field]);
  }
  return result;
}

/** Pure function — exported for override tests. */
export function resolveBoatSettingsFromSection(
  mcData: md.IndexedData,
  section: BoatSettingsSection,
): BoatPhysicsSettings {
  const majorVersion = mcData.version.majorVersion!;
  let settings: BoatPhysicsSettings = { ...section.default };

  for (const override of section.overrides) {
    if (override.versions.includes(majorVersion)) {
      settings = { ...settings, ...override.values };
    }
  }

  return applyFloat32Normalization(settings);
}

/** Resolve boat physics from the `boats` section of entity_physics.json. */
export function resolveBoatSettings(mcData: md.IndexedData): BoatPhysicsSettings {
  return resolveBoatSettingsFromSection(mcData, boatSection);
}

/** Resolve boat dimensions from minecraft-data, falling back when missing. */
export function resolveBoatDimensions(
  mcData: md.IndexedData,
  entityName?: string,
  fallback: BoatDimensions = boatSection.fallbackDimensions,
): BoatDimensions {
  if (entityName) {
    const named = mcData.entitiesByName[entityName];
    if (hasValidDimensions(named)) {
      return { height: named.height, width: named.width };
    }
  }

  const genericBoat = mcData.entitiesByName.boat;
  if (hasValidDimensions(genericBoat)) {
    return { height: genericBoat.height, width: genericBoat.width };
  }

  for (const name of Object.keys(mcData.entitiesByName)) {
    if (name.endsWith("_boat") || name.endsWith("_raft")) {
      const candidate = mcData.entitiesByName[name];
      if (hasValidDimensions(candidate)) {
        return { height: candidate.height, width: candidate.width };
      }
    }
  }

  return { ...fallback };
}
