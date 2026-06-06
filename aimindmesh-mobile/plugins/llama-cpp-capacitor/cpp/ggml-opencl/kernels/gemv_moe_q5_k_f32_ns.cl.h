R"(#pragma OPENCL EXTENSION cl_khr_fp16 : enable
)"
R"(#pragma OPENCL EXTENSION cl_khr_subgroups : enable
)"
R"(#pragma OPENCL EXTENSION cl_qcom_reqd_sub_group_size : enable
)"
R"(
)"
R"(#define QK_K 256
)"
R"(#define K_SCALE_SIZE 12
)"
R"(#define N_SIMDGROUP 4
)"
R"(#define SIMDGROUP_WIDTH 64
)"
R"(
)"
R"(inline void get_scale_min_k4(
)"
R"(    int j,
)"
R"(    global const uchar * q,
)"
R"(    uchar * d,
)"
R"(    uchar * m
)"
R"() {
)"
R"(    if (j < 4) {
)"
R"(        *d = q[j]   & 63;
)"
R"(        *m = q[j+4] & 63;
)"
R"(    } else {
)"
R"(        *d = (q[j+4] & 0x0F) | ((q[j-4] & 0xC0) >> 2);
)"
R"(        *m = ((q[j+4] >> 4) & 0x0F) | ((q[j]   & 0xC0) >> 2);
)"
R"(    }
)"
R"(}
)"
R"(
)"
R"(static inline float8 q5_k_to_fp32_packed8(ushort2 qs5x8, uchar qh5x8, half s, half m) {
)"
R"(    float8 fp32x8;
)"
R"(    fp32x8.s0 = (float)((( qs5x8.s0 & 0x000F)        | (( qh5x8       & 0x01) << 4)) * s + m);
)"
R"(    fp32x8.s1 = (float)((((qs5x8.s0 & 0x00F0) >> 4 ) | (((qh5x8 >> 1) & 0x01) << 4)) * s + m);
)"
R"(    fp32x8.s2 = (float)((((qs5x8.s0 & 0x0F00) >> 8 ) | (((qh5x8 >> 2) & 0x01) << 4)) * s + m);
)"
R"(    fp32x8.s3 = (float)((((qs5x8.s0 & 0xF000) >> 12) | (((qh5x8 >> 3) & 0x01) << 4)) * s + m);
)"
R"(    fp32x8.s4 = (float)((( qs5x8.s1 & 0x000F)        | (((qh5x8 >> 4) & 0x01) << 4)) * s + m);
)"
R"(    fp32x8.s5 = (float)((((qs5x8.s1 & 0x00F0) >> 4 ) | (((qh5x8 >> 5) & 0x01) << 4)) * s + m);
)"
R"(    fp32x8.s6 = (float)((((qs5x8.s1 & 0x0F00) >> 8 ) | (((qh5x8 >> 6) & 0x01) << 4)) * s + m);
)"
R"(    fp32x8.s7 = (float)((((qs5x8.s1 & 0xF000) >> 12) | (((qh5x8 >> 7) & 0x01) << 4)) * s + m);
)"
R"(    return fp32x8;
)"
R"(}
)"
R"(
)"
R"(__attribute__((qcom_reqd_sub_group_size("half")))
)"
R"(__kernel void kernel_gemv_moe_q5_k_f32_ns(
)"
R"(    __global uint *         src0_q,
)"
R"(    __global uint *         src0_qh,
)"
R"(    __global half *         src0_d,
)"
R"(    __global half *         src0_dm,
)"
R"(    __global uchar *        src0_s,
)"
R"(    __read_only image1d_buffer_t src1,
)"
R"(    __global uint *         src2,
)"
R"(    __global float *        dst,
)"
R"(    ulong                   offsetd,
)"
R"(    int                     ne00,
)"
R"(    int                     ne01,
)"
R"(    int                     ne11
)"
R"() {
)"
R"(    uint i01  = get_global_id(0);
)"
R"(    uint i20  = get_global_id(2);
)"
R"(    uint sgid = get_local_id(1);
)"
R"(    uint slid = get_sub_group_local_id();
)"
R"(
)"
R"(    if (i01 >= ne01) {
)"
R"(        return;
)"
R"(    }
)"
R"(
)"
R"(    uint i11 = i20 % ne11;
)"
R"(
)"
R"(    uint expert_id = src2[i20];
)"
R"(
)"
R"(    int num_superblocks = ne00 / QK_K;
)"
R"(    int num_subblocks = ne00 / 32;
)"
R"(    int scales_per_row = num_superblocks * K_SCALE_SIZE;
)"
R"(
)"
R"(    // Expert offsets in the transposed noshuffle layout
)"
R"(    uint expert_q_offset = expert_id * (ne00 / 8) * ne01;
)"
R"(    uint expert_d_offset = expert_id * num_superblocks * ne01;
)"
R"(
)"
R"(    __private float sum = 0.0f;
)"
R"(
)"
R"(    // Loop over sub-blocks of 32 elements, N_SIMDGROUP sub-blocks per iter
)"
R"(    for (uint ib = sgid; ib < num_subblocks; ib += N_SIMDGROUP) {
)"
R"(        uint sb = ib / 8;
)"
R"(        uint j  = ib % 8;
)"
R"(
)"
R"(        // Load d and dmin for this super-block
)"
R"(        half d_val   = src0_d[expert_d_offset + sb * ne01 + i01];
)"
R"(        half dm_val  = src0_dm[expert_d_offset + sb * ne01 + i01];
)"
R"(
)"
R"(        // sub_block index = sb * 8 + j
)"
R"(        uint expert_qh_offset = expert_id * num_superblocks * 8 * ne01;
)"
R"(        uchar4 regQh = as_uchar4(src0_qh[expert_qh_offset + (sb * 8 + j) * ne01 + i01]);
)"
R"(
)"
R"(        // Load sub-block scale and min
)"
R"(        global const uchar * sc = src0_s + (expert_id * ne01 + i01) * scales_per_row + sb * K_SCALE_SIZE;
)"
R"(        uchar sv, mn;
)"
R"(        get_scale_min_k4(j, sc, &sv, &mn);
)"
R"(
)"
R"(        float scale = (float)d_val * (float)sv;
)"
R"(        float minv  = -(float)dm_val * (float)mn;
)"
R"(
)"
R"(        // Load 4 uints of quants (32 nibbles = 32 elements)
)"
R"(        uint q_base = expert_q_offset + ib * ne01 * 4 + i01;
)"
R"(
)"
R"(        uint4 regQ;
)"
R"(        regQ.s0 = src0_q[q_base];
)"
R"(        regQ.s1 = src0_q[q_base + ne01];
)"
R"(        regQ.s2 = src0_q[q_base + ne01 * 2];
)"
R"(        regQ.s3 = src0_q[q_base + ne01 * 3];
)"
R"(
)"
R"(        // Load activations: 32 floats = 8 float4s
)"
R"(        uint y_offset = i11 * ne00 / 4 + ib * 8;
)"
R"(
)"
R"(        float8 fp32x8 = q5_k_to_fp32_packed8(as_ushort2(regQ.s0), regQh.s0, scale, minv);
)"
R"(
)"
R"(        float4 shared_y4;
)"
R"(        shared_y4 = read_imagef(src1, (y_offset + 0));
)"
R"(        float4 acc = shared_y4 * fp32x8.lo;
)"
R"(
)"
R"(        shared_y4 = read_imagef(src1, (y_offset + 1));
)"
R"(        acc += shared_y4 * fp32x8.hi;
)"
R"(
)"
R"(        fp32x8 = q5_k_to_fp32_packed8(as_ushort2(regQ.s1), regQh.s1, scale, minv);
)"
R"(
)"
R"(        shared_y4 = read_imagef(src1, (y_offset + 2));
)"
R"(        acc += shared_y4 * fp32x8.lo;
)"
R"(
)"
R"(        shared_y4 = read_imagef(src1, (y_offset + 3));
)"
R"(        acc += shared_y4 * fp32x8.hi;
)"
R"(
)"
R"(        fp32x8 = q5_k_to_fp32_packed8(as_ushort2(regQ.s2), regQh.s2, scale, minv);
)"
R"(
)"
R"(        shared_y4 = read_imagef(src1, (y_offset + 4));
)"
R"(        acc += shared_y4 * fp32x8.lo;
)"
R"(
)"
R"(        shared_y4 = read_imagef(src1, (y_offset + 5));
)"
R"(        acc += shared_y4 * fp32x8.hi;
)"
R"(
)"
R"(        fp32x8 = q5_k_to_fp32_packed8(as_ushort2(regQ.s3), regQh.s3, scale, minv);
)"
R"(
)"
R"(        shared_y4 = read_imagef(src1, (y_offset + 6));
)"
R"(        acc += shared_y4 * fp32x8.lo;
)"
R"(
)"
R"(        shared_y4 = read_imagef(src1, (y_offset + 7));
)"
R"(        acc += shared_y4 * fp32x8.hi;
)"
R"(
)"
R"(        sum += ((acc.s0 + acc.s1) + (acc.s2 + acc.s3));
)"
R"(    }
)"
R"(
)"
R"(    // reduction in local memory, assumes #subgroups=4
)"
R"(    __local float reduceLM[SIMDGROUP_WIDTH * (N_SIMDGROUP - 1)];
)"
R"(    if (sgid == 1) reduceLM[SIMDGROUP_WIDTH * 0 + slid] = sum;
)"
R"(    if (sgid == 2) reduceLM[SIMDGROUP_WIDTH * 1 + slid] = sum;
)"
R"(    if (sgid == 3) reduceLM[SIMDGROUP_WIDTH * 2 + slid] = sum;
)"
R"(    barrier(CLK_LOCAL_MEM_FENCE);
)"
R"(    if (sgid == 0) sum += reduceLM[SIMDGROUP_WIDTH * 0 + slid];
)"
R"(    if (sgid == 0) sum += reduceLM[SIMDGROUP_WIDTH * 1 + slid];
)"
R"(    if (sgid == 0) sum += reduceLM[SIMDGROUP_WIDTH * 2 + slid];
)"
R"(
)"
R"(    // 1 output per thread in subgroup 0
)"
R"(    if (sgid == 0) {
)"
R"(        dst = dst + (offsetd >> 2);
)"
R"(        dst[i01 + i20 * ne01] = sum;
)"
R"(    }
)"
R"(}
)"
