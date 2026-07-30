import md from "minecraft-data";
import type { Entity } from "prismarine-entity";
import * as attributes from "../info/attributes";
import info from "../info/entity_physics.json";

/**
 * Precision model (JSON field → Java type → fround site):
 *
 * | JSON field                    | Java (vanilla)     | fround when resolved |
 * |-------------------------------|--------------------|----------------------|
 * | defaultMovementSpeed          | 0.225F             | settings             |
 * | defaultJumpStrength           | 0.7D default attr  | never (double)       |
 * | inputForwardScale             | 0.98F              | settings             |
 * | inputStrafeScale              | 0.49F              | settings             |
 * | inputBackwardScale            | 0.25F              | settings             |
 * | forwardJumpImpulse            | 0.4F               | settings             |
 * | honeyJumpFactor               | 0.5F               | settings             |
 * | stepHeight                    | 1.0F               | settings             |
 * | airborneAccelFactor           | 0.1F               | settings             |
 * | groundFrictionMultiplier      | 0.91F              | settings             |
 * | frictionInfluencedSpeedFactor | 0.21600002F        | settings             |
 * | defaultBlockFriction          | 0.6F               | settings             |
 * | verticalDrag                  | 0.98F              | settings             |
 * | airborneInertia               | 0.91F              | settings             |
 * | liquidVerticalInertia         | 0.8F               | settings             |
 * | waterHorizontalSlowDown       | 0.8F               | settings             |
 * | liquidAccel                   | 0.02F              | settings             |
 * | lavaHorizontalInertia         | 0.5F               | settings             |
 * | gravity                       | 0.08D              | never                |
 * | lavaShallowThreshold          | 0.4D (threshold)   | never                |
 *
 * Runtime (not JSON):
 * | movementSpeed attribute       | float in getRiddenSpeed | extractor (always fround) |
 * | jumpStrength attribute        | double pre-1.21; float cast in getJumpPower 1.21+ | extractor fround 1.21+ only |
 * | jump power chain              | double pre-1.21    | computeHorseJumpPower version branch |
 * | jumpBoostPower                | 0.1F * level       | computeJumpBoostPower |
 * | charge/pending scale          | float literals     | computeChargeScale / computePendingJumpScale |
 * | block slipperiness          | float per block    | fround at read in physics |
 *
 * Vec3 results: double arithmetic; never fround final position/velocity.
 */

/** Horse-specific tuning from AbstractHorse (input, jump). */
export interface HorsePhysicsSettings {
  /** Default MOVEMENT_SPEED attribute (AbstractHorse 1.17.1:705). */
  defaultMovementSpeed: number;
  /** Default JUMP_STRENGTH attribute (AbstractHorse 1.17.1). */
  defaultJumpStrength: number;
  /** Forward input scale from getRiddenInput (0.98F). */
  inputForwardScale: number;
  /** Strafe input scale (= inputForwardScale * 0.5). */
  inputStrafeScale: number;
  /** Backward input multiplier when forward <= 0 (0.25F). */
  inputBackwardScale: number;
  /** Forward jump impulse coefficient (executeRidersJump 0.4F). */
  forwardJumpImpulse: number;
  /** getBlockJumpFactor for honey blocks (1.15+). */
  honeyJumpFactor: number;
  /** Step height while ridden (1.0). */
  stepHeight: number;
  /** Scoped LivingEntity travel profile — gravity per tick (double). */
  gravity: number;
  /** Scoped LivingEntity travel profile — ground horizontal inertia multiplier (0.91F). */
  groundFrictionMultiplier: number;
  /** Scoped LivingEntity travel profile — 0.1627714/triple-slip (0.21600002F). */
  frictionInfluencedSpeedFactor: number;
  /** Scoped LivingEntity travel profile — default block slipperiness fallback (0.6F). */
  defaultBlockFriction: number;
  /** Scoped LivingEntity travel profile — Y drag after gravity in air (0.98F). */
  verticalDrag: number;
  /** Scoped LivingEntity travel profile — ground/air horizontal inertia in air branch (0.91F). */
  airborneInertia: number;
  /** Scoped LivingEntity travel profile — air acceleration factor (* movementSpeed, 0.1F). */
  airborneAccelFactor: number;
  /** Scoped LivingEntity travel profile — water Y and shallow-lava Y drag (0.8F). */
  liquidVerticalInertia: number;
  /** LivingEntity#getWaterSlowDown horizontal scale for water X/Z (0.8F; skeleton horse 0.96F). */
  waterHorizontalSlowDown: number;
  /** Scoped LivingEntity travel profile — liquid input acceleration (0.02F). */
  liquidAccel: number;
  /** Scoped LivingEntity travel profile — getFluidJumpThreshold when eyeHeight > 0.4 (double). */
  lavaShallowThreshold: number;
  /** Scoped LivingEntity travel profile — lava horizontal/deep scale (0.5F). */
  lavaHorizontalInertia: number;
}

export interface HorseDimensions {
  height: number;
  width: number;
}

export type HorseSpecies = "horse" | "skeleton_horse" | "zombie_horse" | "donkey" | "mule";

export interface HorseSpeciesOverride {
  waterHorizontalSlowDown?: number;
}

export interface HorseSettingsSection {
  default: HorsePhysicsSettings;
  fallbackDimensions: HorseDimensions;
  speciesOverrides?: Partial<Record<HorseSpecies, HorseSpeciesOverride>>;
  overrides: Array<{ versions: string[]; values: Partial<HorsePhysicsSettings> }>;
}

/** Float32 literals — normalized via Math.fround at settings resolve. */
export const FLOAT32_FIELDS = [
  "defaultMovementSpeed",
  "inputForwardScale",
  "inputStrafeScale",
  "inputBackwardScale",
  "forwardJumpImpulse",
  "honeyJumpFactor",
  "stepHeight",
  "airborneAccelFactor",
  "groundFrictionMultiplier",
  "frictionInfluencedSpeedFactor",
  "defaultBlockFriction",
  "verticalDrag",
  "airborneInertia",
  "liquidVerticalInertia",
  "waterHorizontalSlowDown",
  "liquidAccel",
  "lavaHorizontalInertia",
] as const;

const horseSection = info.horses as unknown as HorseSettingsSection;

const HORSE_ENTITY_NAMES = ["horse", "skeleton_horse", "zombie_horse", "donkey", "mule"] as const;

export function parseHorseSpecies(entityName?: string): HorseSpecies {
  if (entityName === "skeleton_horse" || entityName === "zombie_horse" || entityName === "donkey" || entityName === "mule") {
    return entityName;
  }
  return "horse";
}

/** Species-aware horizontal water slowdown (SkeletonHorse#getWaterSlowDown). */
export function resolveWaterHorizontalSlowDown(
  species: HorseSpecies,
  mcData: md.IndexedData,
  section: HorseSettingsSection = horseSection,
): number {
  const settings = resolveHorseSettingsFromSection(mcData, section);
  const override = section.speciesOverrides?.[species]?.waterHorizontalSlowDown;
  if (override != null) {
    return Math.fround(override);
  }
  return settings.waterHorizontalSlowDown;
}

const MOVEMENT_SPEED_ALIASES = [
  "generic.movementSpeed",
  "generic.movement_speed",
  "minecraft:generic.movement_speed",
  "minecraft:movement_speed",
] as const;

const JUMP_STRENGTH_ALIASES = [
  "horse.jumpStrength",
  "horse.jump_strength",
  "generic.jump_strength",
  "minecraft:generic.jump_strength",
  "minecraft:jump_strength",
  "minecraft:horse.jump_strength",
] as const;

type AttributeProp = {
  value: number;
  modifiers: Array<{ uuid: string; operation: number; amount: number }>;
};

export function usesFloatJumpStrengthPrecision(mcData: md.IndexedData): boolean {
  const parts = mcData.version.majorVersion!.split(".").map(Number);
  const major = parts[0] ?? 0;
  const minor = parts[1] ?? 0;
  return major > 1 || (major === 1 && minor >= 21);
}

/** AbstractHorse.getRiddenSpeed casts MOVEMENT_SPEED to float. */
export function applyMovementSpeedPrecision(value: number): number {
  return Math.fround(value);
}

/** JUMP_STRENGTH attribute: fround on read from 1.21+; default fallback stays double. */
export function applyJumpStrengthPrecision(value: number, mcData: md.IndexedData): number {
  if (usesFloatJumpStrengthPrecision(mcData)) {
    return Math.fround(value);
  }
  return value;
}

/** LocalPlayer jumpRidingScale while held: ticks*0.1F or 0.8F + 2.0F/(ticks-9)*0.1F. */
export function computeChargeScale(ticks: number): number {
  const f = Math.fround;
  if (ticks < 10) {
    return f(f(ticks) * f(0.1));
  }
  const divided = f(f(2.0) / f(ticks - 9));
  const product = f(divided * f(0.1));
  return f(f(0.8) + product);
}

/** AbstractHorse.getPlayerJumpPendingScale(i): 0.4F + 0.4F * i / 90.0F. */
export function computePendingJumpScale(chargeIndex: number): number {
  const f = Math.fround;
  if (chargeIndex >= 90) {
    return f(1.0);
  }
  const quotient = f(f(f(0.4) * f(chargeIndex)) / f(90.0));
  return f(f(0.4) + quotient);
}

/** LivingEntity.getJumpBoostPower: 0.1F * effectLevel. */
export function computeJumpBoostPower(jumpBoostEffectLevel: number): number {
  if (jumpBoostEffectLevel <= 0) {
    return 0;
  }
  const f = Math.fround;
  return f(f(0.1) * f(jumpBoostEffectLevel));
}

/**
 * LivingEntity.getJumpPower(scale): double chain pre-1.21; full float32 chain from 1.21+.
 * jumpStrength is already attribute-resolved; blockJumpFactor should be frounded by caller when read.
 */
export function computeHorseJumpPower(
  jumpStrength: number,
  scale: number,
  blockJumpFactor: number,
  jumpBoostEffectLevel: number,
  mcData: md.IndexedData,
): number {
  const boost = computeJumpBoostPower(jumpBoostEffectLevel);
  if (usesFloatJumpStrengthPrecision(mcData)) {
    const f = Math.fround;
    const scaled = f(f(jumpStrength) * f(scale));
    const factored = f(scaled * f(blockJumpFactor));
    return f(factored + boost);
  }
  return jumpStrength * scale * blockJumpFactor + boost;
}

/** Floor riding charge index sent to onPlayerJump: Mth.floor(scale * 100.0F). */
export function floorRidingChargeIndex(chargeScale: number): number {
  const f = Math.fround;
  return Math.floor(f(f(chargeScale) * f(100.0)));
}

export function hasValidDimensions(entity: md.Entity | undefined): entity is md.Entity & { height: number; width: number } {
  return (
    entity != null &&
    typeof entity.height === "number" &&
    Number.isFinite(entity.height) &&
    entity.height > 0 &&
    typeof entity.width === "number" &&
    Number.isFinite(entity.width) &&
    entity.width > 0
  );
}

/** Prefer runtime entity dimensions when finite and positive. */
export function pickRuntimeDimension(entityValue: number | undefined, fallback: number): number {
  if (typeof entityValue === "number" && Number.isFinite(entityValue) && entityValue > 0) {
    return entityValue;
  }
  return fallback;
}

function applyFloat32Normalization(settings: HorsePhysicsSettings): HorsePhysicsSettings {
  const result = { ...settings };
  for (const field of FLOAT32_FIELDS) {
    result[field] = Math.fround(result[field]);
  }
  return result;
}

function resourceKeysFromMcData(mcData: md.IndexedData, names: string[]): string[] {
  const keys: string[] = [];
  for (const name of names) {
    const descriptor = mcData.attributesByName[name] as { resource?: string } | undefined;
    if (descriptor?.resource) {
      keys.push(descriptor.resource);
    }
  }
  return keys;
}

function lookupAttribute(
  entityAttributes: Entity["attributes"] | undefined,
  mcData: md.IndexedData,
  mcDataNames: string[],
  historicalAliases: readonly string[],
): AttributeProp | undefined {
  if (!entityAttributes) return undefined;

  const orderedKeys = [...resourceKeysFromMcData(mcData, mcDataNames), ...historicalAliases];
  for (const key of orderedKeys) {
    const attr = entityAttributes[key] as AttributeProp | undefined;
    if (attr) return attr;
  }
  return undefined;
}

/** Pure function — exported for override tests. */
export function resolveHorseSettingsFromSection(
  mcData: md.IndexedData,
  section: HorseSettingsSection,
): HorsePhysicsSettings {
  const majorVersion = mcData.version.majorVersion!;
  let settings: HorsePhysicsSettings = { ...section.default };

  for (const override of section.overrides) {
    if (override.versions.includes(majorVersion)) {
      settings = { ...settings, ...override.values };
    }
  }

  return applyFloat32Normalization(settings);
}

/** Resolve horse physics from the `horses` section of entity_physics.json. */
export function resolveHorseSettings(mcData: md.IndexedData): HorsePhysicsSettings {
  return resolveHorseSettingsFromSection(mcData, horseSection);
}

/** Resolve horse dimensions from minecraft-data, falling back when missing. */
export function resolveHorseDimensions(
  mcData: md.IndexedData,
  entityName?: string,
  fallback: HorseDimensions = horseSection.fallbackDimensions,
): HorseDimensions {
  if (entityName) {
    const named = mcData.entitiesByName[entityName];
    if (hasValidDimensions(named)) {
      return { height: named.height, width: named.width };
    }
  }

  for (const name of HORSE_ENTITY_NAMES) {
    const candidate = mcData.entitiesByName[name];
    if (hasValidDimensions(candidate)) {
      return { height: candidate.height, width: candidate.width };
    }
  }

  return { ...fallback };
}

export function getHorseMovementSpeedAttribute(
  entityAttributes: Entity["attributes"] | undefined,
  mcData: md.IndexedData,
  defaultValue: number = resolveHorseSettings(mcData).defaultMovementSpeed,
): number {
  const attr = lookupAttribute(entityAttributes, mcData, ["movementSpeed", "generic_movement_speed"], MOVEMENT_SPEED_ALIASES);
  if (!attr) return defaultValue;
  return applyMovementSpeedPrecision(attributes.getAttributeValue(attr));
}

export function getHorseJumpStrengthAttribute(
  entityAttributes: Entity["attributes"] | undefined,
  mcData: md.IndexedData,
  defaultValue: number = resolveHorseSettings(mcData).defaultJumpStrength,
): number {
  const attr = lookupAttribute(
    entityAttributes,
    mcData,
    ["horseJumpStrength", "jumpStrength"],
    JUMP_STRENGTH_ALIASES,
  );
  if (!attr) return defaultValue;
  return applyJumpStrengthPrecision(attributes.getAttributeValue(attr), mcData);
}
