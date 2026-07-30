import md from "minecraft-data";
import type { Block } from "prismarine-block";
import { Vec3 } from "vec3";

/** Vanilla Entity.getOnPos(0.500001F) offset for 1.20+. */
export const HORSE_BLOCK_BELOW_OFFSET_MODERN = 0.500001;
/** Vanilla pre-1.20 getBlockPosBelowThatAffectsMyMovement equivalent. */
export const HORSE_BLOCK_BELOW_OFFSET_1_15 = 0.5000001;
/** Vanilla 1.14.x block-below lookup uses a full-block step. */
export const HORSE_BLOCK_BELOW_OFFSET_1_14 = 1.0;

export type HorseBlockBelowMode = "legacy_1_14" | "offset_0_5" | "modern_supporting";

export function getHorseBlockBelowMode(mcData: md.IndexedData): HorseBlockBelowMode {
  const parts = mcData.version.majorVersion!.split(".").map(Number);
  const major = parts[0] ?? 0;
  const minor = parts[1] ?? 0;
  if (major < 1 || (major === 1 && minor <= 14)) {
    return "legacy_1_14";
  }
  if (major === 1 && minor < 20) {
    return "offset_0_5";
  }
  return "modern_supporting";
}

/** BlockTags.FENCES membership (vanilla getOnPos gate). */
export function isVanillaFenceBlock(block: Block | null | undefined): boolean {
  const name = block?.name ?? "";
  return name.includes("fence") && !name.includes("fence_gate");
}

/** BlockTags.WALLS membership (vanilla getOnPos gate). */
export function isVanillaWallBlock(block: Block | null | undefined): boolean {
  const name = block?.name ?? "";
  return name.endsWith("_wall") || name === "cobblestone_wall";
}

/** FenceGateBlock instances (vanilla getOnPos gate). */
export function isVanillaFenceGateBlock(block: Block | null | undefined): boolean {
  const name = block?.name ?? "";
  return name.includes("fence_gate");
}

function usesSupportingBlockPosY(
  supportingBlock: Block | null | undefined,
  offset: number,
): boolean {
  if (offset <= 0.5 && isVanillaFenceBlock(supportingBlock)) {
    return false;
  }
  if (isVanillaWallBlock(supportingBlock)) {
    return false;
  }
  if (isVanillaFenceGateBlock(supportingBlock)) {
    return false;
  }
  return true;
}

/**
 * Version-aware block below entity feet used for friction/jump factor.
 * Mirrors Entity.getBlockPosBelowThatAffectsMyMovement / historical offsets.
 */
export function getHorseBlockBelowAffectingMovementPos(
  mcData: md.IndexedData,
  pos: Vec3,
  bbMinY: number,
  supportingBlockPos: Vec3 | null,
  getBlock: (pos: Vec3) => Block | null | undefined,
): Vec3 {
  const mode = getHorseBlockBelowMode(mcData);

  if (mode === "legacy_1_14") {
    return new Vec3(Math.floor(pos.x), Math.floor(bbMinY - HORSE_BLOCK_BELOW_OFFSET_1_14), Math.floor(pos.z));
  }

  if (mode === "offset_0_5") {
    return new Vec3(Math.floor(pos.x), Math.floor(bbMinY - HORSE_BLOCK_BELOW_OFFSET_1_15), Math.floor(pos.z));
  }

  const offset = Math.fround(HORSE_BLOCK_BELOW_OFFSET_MODERN);
  if (supportingBlockPos != null) {
    const supportingBlock = getBlock(supportingBlockPos);
    if (usesSupportingBlockPosY(supportingBlock, offset)) {
      return new Vec3(supportingBlockPos.x, Math.floor(pos.y - offset), supportingBlockPos.z);
    }
    return supportingBlockPos.clone();
  }

  return new Vec3(Math.floor(pos.x), Math.floor(pos.y - offset), Math.floor(pos.z));
}
