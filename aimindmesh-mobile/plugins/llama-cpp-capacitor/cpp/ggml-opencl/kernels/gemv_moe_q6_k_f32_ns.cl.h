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
R"(#define N_SIMDGROUP 4
)"
R"(#define SIMDGROUP_WIDTH 64
)"
R"(
)"
R"(static inline float8 q6_k_to_fp32_packed8(ushort2 ql8, ushort qh8, float d_scale) {
)"
R"(    float8 fp32x8;
)"
R"(    fp32x8.s0 = ((float)(( ql8.s0 & 0x000F)        | ((uint)((qh8      ) & 0x3) << 4)) - 32.f) * d_scale;
)"
R"(    fp32x8.s1 = ((float)((( ql8.s0 >> 4) & 0x000F) | ((uint)((qh8 >> 2) & 0x3) << 4)) - 32.f) * d_scale;
)"
R"(    fp32x8.s2 = ((float)((( ql8.s0 >> 8) & 0x000F) | ((uint)((qh8 >> 4) & 0x3) << 4)) - 32.f) * d_scale;
)"
R"(    fp32x8.s3 = ((float)((( ql8.s0 >> 12)& 0x000F) | ((uint)((qh8 >> 6) & 0x3) << 4)) - 32.f) * d_scale;
)"
R"(    fp32x8.s4 = ((float)(( ql8.s1 & 0x000F)        | ((uint)((qh8 >> 8) & 0x3) << 4)) - 32.f) * d_scale;
)"
R"(    fp32x8.s5 = ((float)((( ql8.s1 >> 4) & 0x000F) | ((uint)((qh8 >>10) & 0x3) << 4)) - 32.f) * d_scale;
)"
R"(    fp32x8.s6 = ((float)((( ql8.s1 >> 8) & 0x000F) | ((uint)((qh8 >>12) & 0x3) << 4)) - 32.f) * d_scale;
)"
R"(    fp32x8.s7 = ((float)((( ql8.s1 >> 12)& 0x000F) | ((uint)((qh8 >>14) & 0x3) << 4)) - 32.f) * d_scale;
)"
R"(    return fp32x8;
)"
R"(}
)"
R"(
)"
R"(__attribute__((qcom_reqd_sub_group_size("half")))
)"
R"(__kernel void kernel_gemv_moe_q6_k_f32_ns(
)"
R"(    __global uint *         src0_ql,
)"
R"(    __global uint *         src0_qh,
)"
R"(    __global char *         src0_s,
)"
R"(    __global half *         src0_d,
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
R"(    int num_subblocks = ne00 / 32;  // 8 sub-blocks of 32 per super-block
)"
R"(    int scales_per_row = num_superblocks * 16;
)"
R"(
)"
R"(    // Expert offsets in the transposed noshuffle layout
)"
R"(    uint expert_ql_offset = expert_id * (ne00 / 8) * ne01;   // 32 uints per super-block
)"
R"(    uint expert_qh_offset = expert_id * (ne00 / 16) * ne01;  // 16 uints per super-block
)"
R"(    uint expert_d_offset  = expert_id * num_superblocks * ne01;
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
R"(        uint sb = ib / 8;   // super-block index
)"
R"(        uint j  = ib % 8;   // 32-element group within super-block
)"
R"(
)"
R"(        // Load d for this super-block
)"
R"(        half d_val = src0_d[expert_d_offset + sb * ne01 + i01];
)"
R"(
)"
R"(        // Load 2 sub-block scales
)"
R"(        global const char * sc = src0_s + (expert_id * ne01 + i01) * scales_per_row + sb * 16;
)"
R"(        float scale0 = (float)d_val * (float)sc[j * 2];
)"
R"(        float scale1 = (float)d_val * (float)sc[j * 2 + 1];
)"
R"(
)"
R"(        // Load 4 uints of ql
)"
R"(        uint ql_base = expert_ql_offset + (ib * 4) * ne01 + i01;
)"
R"(        uint4 regQL;
)"
R"(        regQL.s0 = src0_ql[ql_base];
)"
R"(        regQL.s1 = src0_ql[ql_base + ne01];
)"
R"(        regQL.s2 = src0_ql[ql_base + ne01 * 2];
)"
R"(        regQL.s3 = src0_ql[ql_base + ne01 * 3];
)"
R"(
)"
R"(        // Load 2 uints of qh
)"
R"(        uint qh_base = expert_qh_offset + (ib * 2) * ne01 + i01;
)"
R"(        uint2 regQH;
)"
R"(        regQH.s0 = src0_qh[qh_base];
)"
R"(        regQH.s1 = src0_qh[qh_base + ne01];
)"
R"(
)"
R"(        // Load activations: 32 floats = 8 float4s
)"
R"(        uint y_offset = i11 * ne00 / 4 + ib * 8;
)"
R"(
)"
R"(        float8 fp32x8 = q6_k_to_fp32_packed8(as_ushort2(regQL.s0), (ushort)(regQH.s0 & 0xFFFF), scale0);
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
R"(        fp32x8 = q6_k_to_fp32_packed8(as_ushort2(regQL.s1), (ushort)(regQH.s0 >> 16), scale0);
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
R"(        fp32x8 = q6_k_to_fp32_packed8(as_ushort2(regQL.s2), (ushort)(regQH.s1 & 0xFFFF), scale1);
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
R"(        fp32x8 = q6_k_to_fp32_packed8(as_ushort2(regQL.s3), (ushort)(regQH.s1 >> 16), scale1);
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
