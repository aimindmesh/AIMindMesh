R"(#pragma OPENCL EXTENSION cl_khr_fp16 : enable
)"
R"(
)"
R"(__kernel void kernel_moe_histogram(
)"
R"(    __global const int * input,
)"
R"(    __global int * hist,
)"
R"(    uint N,
)"
R"(    uint topK,
)"
R"(    uint n_experts
)"
R"() {
)"
R"(    uint n = get_global_id(0);
)"
R"(    uint k = get_global_id(1);
)"
R"(
)"
R"(    if (n >= N || k >= topK) {
)"
R"(        return;
)"
R"(    }
)"
R"(
)"
R"(    int expert_id = input[n * n_experts + k];
)"
R"(    atomic_inc(&hist[expert_id]);
)"
R"(}
)"
R"(
)"
R"(__kernel void kernel_moe_scan(
)"
R"(    __global int * hist,
)"
R"(    __global int * tile_offset,
)"
R"(    __global int * total_tiles,
)"
R"(    __global int * slot_counter,
)"
R"(    int tile_size,
)"
R"(    uint n_experts
)"
R"() {
)"
R"(    int offset = 0;
)"
R"(    for (int v = 0; v < n_experts; v++) {
)"
R"(        int count = hist[v];
)"
R"(        int tiles = (count + tile_size - 1) / tile_size;
)"
R"(        tile_offset[v] = offset;
)"
R"(        offset += tiles;
)"
R"(        hist[v] = 0;
)"
R"(        slot_counter[v] = 0;
)"
R"(    }
)"
R"(
)"
R"(    *total_tiles = offset;
)"
R"(}
)"
R"(
)"
R"(__kernel void kernel_moe_scatter(
)"
R"(    __global const int * input,
)"
R"(    __global int * post_router,
)"
R"(    __global ushort * emap,
)"
R"(    __global const int * tile_offset,
)"
R"(    __global int * slot_counter,
)"
R"(    int N,
)"
R"(    int topK,
)"
R"(    uint n_experts
)"
R"() {
)"
R"(    uint n = get_global_id(0);
)"
R"(    uint k = get_global_id(1);
)"
R"(
)"
R"(    if (n >= N || k >= topK) {
)"
R"(        return;
)"
R"(    }
)"
R"(
)"
R"(    int val = input[n * n_experts + k];
)"
R"(
)"
R"(    int local_slot = atomic_inc(&slot_counter[val]);
)"
R"(
)"
R"(    int tile_idx  = tile_offset[val] + (local_slot / 32);
)"
R"(    int lane      = local_slot % 32;
)"
R"(    int out_pos   = tile_idx * 32 + lane;
)"
R"(
)"
R"(    post_router[out_pos] = n * topK + k;
)"
R"(    emap[tile_idx] = val;
)"
R"(}
)"
R"(
)"
R"(__kernel void kernel_moe_fill(
)"
R"(    __global int * post_router,
)"
R"(    __global int * total_tiles,
)"
R"(    int tile_size
)"
R"() {
)"
R"(    int tile_id = get_global_id(0);
)"
R"(    int vec_id_in_tile = get_global_id(1);
)"
R"(
)"
R"(    if (tile_id < total_tiles[0]) {
)"
R"(        post_router[tile_id * tile_size + vec_id_in_tile] = 0xFFFFFFFF;
)"
R"(    }
)"
R"(}
)"
