#![deny(clippy::all)]

use napi::bindgen_prelude::Float64ArraySlice;
use napi_derive::napi;

const AABB_WIDTH: usize = 6;
const COLLISION_EPSILON: f64 = 1.0e-7;

#[derive(Clone, Copy)]
struct Aabb {
    min: [f64; 3],
    max: [f64; 3],
}

impl Aabb {
    #[inline(always)]
    fn from_slice(values: &[f64]) -> Self {
        Self {
            min: [values[0], values[1], values[2]],
            max: [values[3], values[4], values[5]],
        }
    }

    #[inline(always)]
    fn translate(&mut self, axis: usize, amount: f64) {
        self.min[axis] += amount;
        self.max[axis] += amount;
    }
}

#[inline(always)]
fn classic_axis_offset<const AXIS: usize>(bb: Aabb, colliders: &[f64], movement: f64) -> f64 {
    let axis1 = (AXIS + 1) % 3;
    let axis2 = (AXIS + 2) % 3;
    let mut adjusted = movement;

    for collider in colliders.as_chunks::<AABB_WIDTH>().0 {
        if bb.max[axis1] > collider[axis1]
            && bb.min[axis1] < collider[axis1 + 3]
            && bb.max[axis2] > collider[axis2]
            && bb.min[axis2] < collider[axis2 + 3]
        {
            if movement > 0.0 && bb.max[AXIS] <= collider[AXIS] {
                adjusted = adjusted.min(collider[AXIS] - bb.max[AXIS]);
            } else if movement < 0.0 && bb.min[AXIS] >= collider[AXIS + 3] {
                adjusted = adjusted.max(collider[AXIS + 3] - bb.min[AXIS]);
            }
        }
    }

    adjusted
}

#[inline(always)]
fn voxel_axis_offset<const AXIS: usize>(bb: Aabb, colliders: &[f64], movement: f64) -> f64 {
    if movement.abs() < COLLISION_EPSILON {
        return 0.0;
    }

    let axis1 = (AXIS + 1) % 3;
    let axis2 = (AXIS + 2) % 3;
    let mut adjusted = movement;

    for collider in colliders.as_chunks::<AABB_WIDTH>().0 {
        let overlaps_axis1 = bb.max[axis1] - COLLISION_EPSILON > collider[axis1]
            && bb.min[axis1] + COLLISION_EPSILON < collider[axis1 + 3];
        let overlaps_axis2 = bb.max[axis2] - COLLISION_EPSILON > collider[axis2]
            && bb.min[axis2] + COLLISION_EPSILON < collider[axis2 + 3];

        if overlaps_axis1 && overlaps_axis2 {
            if movement > 0.0 {
                let gap = collider[AXIS] - bb.max[AXIS];
                if gap >= -COLLISION_EPSILON {
                    adjusted = adjusted.min(gap);
                }
            } else {
                let gap = collider[AXIS + 3] - bb.min[AXIS];
                if gap <= COLLISION_EPSILON {
                    adjusted = adjusted.max(gap);
                }
            }
        }
    }

    adjusted
}

/// Version of the native ABI. Useful when diagnosing a mismatched prebuild.
#[napi]
pub fn native_abi_version() -> u32 {
    1
}

/// Low-overhead classic collision ABI. The single Float64Array contains:
/// [colliderCount, box(6), movement/result(3), colliders(6 * capacity)].
#[napi]
pub fn classic_collide_packed(mut workspace: Float64ArraySlice<'_>) {
    if workspace.len() < 10 {
        return;
    }
    // SAFETY: Node-API pins the ArrayBuffer for this synchronous call.
    let data = unsafe { workspace.as_mut() };
    let collider_len = ((data[0] as usize) * AABB_WIDTH).min(data.len() - 10);
    let mut moving = Aabb::from_slice(&data[1..7]);
    let movement = [data[7], data[8], data[9]];
    let colliders = &data[10..10 + collider_len];

    let dy = classic_axis_offset::<1>(moving, colliders, movement[1]);
    moving.translate(1, dy);
    let dx = classic_axis_offset::<0>(moving, colliders, movement[0]);
    moving.translate(0, dx);
    let dz = classic_axis_offset::<2>(moving, colliders, movement[2]);

    data[7] = dx;
    data[8] = dy;
    data[9] = dz;
}

/// Low-overhead Botcraft collision ABI. Layout matches
/// `classic_collide_packed`, and movement is overwritten with the result.
#[napi]
pub fn voxel_collide_packed(mut workspace: Float64ArraySlice<'_>) {
    if workspace.len() < 10 {
        return;
    }
    // SAFETY: Node-API pins the ArrayBuffer for this synchronous call.
    let data = unsafe { workspace.as_mut() };
    let collider_len = ((data[0] as usize) * AABB_WIDTH).min(data.len() - 10);
    let mut moving = Aabb::from_slice(&data[1..7]);
    let mut dx = data[7];
    let dy_input = data[8];
    let mut dz = data[9];
    let colliders = &data[10..10 + collider_len];

    let mut dy = dy_input;
    if dy != 0.0 {
        dy = voxel_axis_offset::<1>(moving, colliders, dy);
        if dy != 0.0 {
            moving.translate(1, dy);
        }
    }

    let prioritize_z = dx.abs() < dz.abs();
    if prioritize_z && dz != 0.0 {
        dz = voxel_axis_offset::<2>(moving, colliders, dz);
        if dz != 0.0 {
            moving.translate(2, dz);
        }
    }
    if dx != 0.0 {
        dx = voxel_axis_offset::<0>(moving, colliders, dx);
        if !prioritize_z && dx != 0.0 {
            moving.translate(0, dx);
        }
    }
    if !prioritize_z && dz != 0.0 {
        dz = voxel_axis_offset::<2>(moving, colliders, dz);
    }

    data[7] = dx;
    data[8] = dy;
    data[9] = dz;
}

/// Resolve classic prismarine/node-aabb movement on all three axes in one call.
/// Inputs and output use [minX,minY,minZ,maxX,maxY,maxZ] and [x,y,z] layouts.
#[napi]
pub fn classic_collide_into(
    bb: &[f64],
    movement: &[f64],
    colliders: &[f64],
    collider_count: u32,
    mut output: Float64ArraySlice<'_>,
) {
    if bb.len() < AABB_WIDTH || movement.len() < 3 || output.len() < 3 {
        return;
    }

    let collider_len = (collider_count as usize * AABB_WIDTH).min(colliders.len());
    let colliders = &colliders[..collider_len];
    let mut moving = Aabb::from_slice(bb);
    let mut dy = classic_axis_offset::<1>(moving, colliders, movement[1]);
    moving.translate(1, dy);
    let mut dx = classic_axis_offset::<0>(moving, colliders, movement[0]);
    moving.translate(0, dx);
    let mut dz = classic_axis_offset::<2>(moving, colliders, movement[2]);

    // Preserve JavaScript's signed zero behavior at the ABI boundary.
    if movement[0] == 0.0 {
        dx = movement[0];
    }
    if movement[1] == 0.0 {
        dy = movement[1];
    }
    if movement[2] == 0.0 {
        dz = movement[2];
    }

    // SAFETY: Node-API keeps the backing ArrayBuffer alive for this call, and
    // JavaScript cannot run concurrently while this synchronous function holds it.
    let output = unsafe { output.as_mut() };
    output[0] = dx;
    output[1] = dy;
    output[2] = dz;
}

/// Resolve Botcraft/vanilla voxel-shape movement using its epsilon semantics.
#[napi]
pub fn voxel_collide_into(
    bb: &[f64],
    movement: &[f64],
    colliders: &[f64],
    collider_count: u32,
    mut output: Float64ArraySlice<'_>,
) {
    if bb.len() < AABB_WIDTH || movement.len() < 3 || output.len() < 3 {
        return;
    }

    let collider_len = (collider_count as usize * AABB_WIDTH).min(colliders.len());
    let colliders = &colliders[..collider_len];
    let mut moving = Aabb::from_slice(bb);
    let dx_input = movement[0];
    let dy_input = movement[1];
    let dz_input = movement[2];

    let mut dy = dy_input;
    if dy != 0.0 {
        dy = voxel_axis_offset::<1>(moving, colliders, dy);
        if dy != 0.0 {
            moving.translate(1, dy);
        }
    }

    let prioritize_z = dx_input.abs() < dz_input.abs();
    let mut dz = dz_input;
    if prioritize_z && dz != 0.0 {
        dz = voxel_axis_offset::<2>(moving, colliders, dz);
        if dz != 0.0 {
            moving.translate(2, dz);
        }
    }

    let mut dx = dx_input;
    if dx != 0.0 {
        dx = voxel_axis_offset::<0>(moving, colliders, dx);
        if !prioritize_z && dx != 0.0 {
            moving.translate(0, dx);
        }
    }

    if !prioritize_z && dz != 0.0 {
        dz = voxel_axis_offset::<2>(moving, colliders, dz);
    }

    // SAFETY: see `classic_collide_into`.
    let output = unsafe { output.as_mut() };
    output[0] = dx;
    output[1] = dy;
    output[2] = dz;
}

/// Resolve many independent Botcraft collision queries with one Node-API crossing.
/// Each query occupies 6 AABB doubles, 3 movement doubles, and two u32 range
/// entries (collider start and collider count). Colliders are packed as AABBs.
#[napi]
pub fn voxel_collide_batch_into(
    boxes: &[f64],
    movements: &[f64],
    colliders: &[f64],
    collider_ranges: &[u32],
    mut output: Float64ArraySlice<'_>,
) {
    let query_count = boxes.len() / AABB_WIDTH;
    if movements.len() < query_count * 3
        || collider_ranges.len() < query_count * 2
        || output.len() < query_count * 3
    {
        return;
    }

    // SAFETY: see `classic_collide_into`.
    let output = unsafe { output.as_mut() };
    for index in 0..query_count {
        let bb_offset = index * AABB_WIDTH;
        let movement_offset = index * 3;
        let range_offset = index * 2;
        let collider_start = collider_ranges[range_offset] as usize * AABB_WIDTH;
        let collider_end = collider_start + collider_ranges[range_offset + 1] as usize * AABB_WIDTH;
        if collider_end > colliders.len() {
            continue;
        }

        let mut moving = Aabb::from_slice(&boxes[bb_offset..bb_offset + AABB_WIDTH]);
        let collider_slice = &colliders[collider_start..collider_end];
        let dx_input = movements[movement_offset];
        let dy_input = movements[movement_offset + 1];
        let dz_input = movements[movement_offset + 2];

        let mut dy = dy_input;
        if dy != 0.0 {
            dy = voxel_axis_offset::<1>(moving, collider_slice, dy);
            if dy != 0.0 {
                moving.translate(1, dy);
            }
        }

        let prioritize_z = dx_input.abs() < dz_input.abs();
        let mut dz = dz_input;
        if prioritize_z && dz != 0.0 {
            dz = voxel_axis_offset::<2>(moving, collider_slice, dz);
            if dz != 0.0 {
                moving.translate(2, dz);
            }
        }

        let mut dx = dx_input;
        if dx != 0.0 {
            dx = voxel_axis_offset::<0>(moving, collider_slice, dx);
            if !prioritize_z && dx != 0.0 {
                moving.translate(0, dx);
            }
        }
        if !prioritize_z && dz != 0.0 {
            dz = voxel_axis_offset::<2>(moving, collider_slice, dz);
        }

        output[movement_offset] = dx;
        output[movement_offset + 1] = dy;
        output[movement_offset + 2] = dz;
    }
}

/// Normalize strafe/forward input, rotate it by Minecraft yaw, and add it to
/// velocity without allocating any JavaScript objects.
#[napi]
pub fn apply_heading_into(
    strafe: f64,
    forward: f64,
    multiplier: f64,
    yaw: f64,
    mut velocity: Float64ArraySlice<'_>,
) {
    if velocity.len() < 3 {
        return;
    }

    let length_squared = strafe * strafe + forward * forward;
    if length_squared < 1.0e-7 {
        return;
    }

    let inverse_length = if length_squared > 1.0 {
        length_squared.sqrt().recip()
    } else {
        1.0
    };
    let norm_strafe = strafe * inverse_length * multiplier;
    let norm_forward = forward * inverse_length * multiplier;
    let angle = std::f64::consts::PI - yaw;
    let (sin_yaw, cos_yaw) = angle.sin_cos();

    // SAFETY: see `classic_collide_into`.
    let velocity = unsafe { velocity.as_mut() };
    velocity[0] += norm_strafe * cos_yaw - norm_forward * sin_yaw;
    velocity[2] += norm_forward * cos_yaw + norm_strafe * sin_yaw;
}
