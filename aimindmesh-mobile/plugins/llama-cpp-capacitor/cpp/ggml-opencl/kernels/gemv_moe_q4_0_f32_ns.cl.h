R"(#pragma OPENCL EXTENSION cl_khr_fp16 : enable
)"
R"(#pragma OPENCL EXTENSION cl_khr_subgroups : enable
)"
R"(#pragma OPENCL EXTENSION cl_qcom_reqd_sub_group_size : enable
)"
R"(
)"
R"(#define QK_Q4_0 32
)"
R"(#define N_SIMDGROUP 4
)"
R"(#define SIMDGROUP_WIDTH 64
)"
R"(
)"
R"(static inline float8 q4_0_to_fp32_packed8(ushort2 q4x8) {
)"
R"(    float8 fp32x8;
)"
R"(    fp32x8.s0 = (float)((q4x8.s0 & 0x000F) - 8);
)"
R"(    fp32x8.s1 = (float)(((q4x8.s0 & 0x00F0) >> 4) - 8);
)"
R"(    fp32x8.s2 = (float)(((q4x8.s0 & 0x0F00) >> 8) - 8);
)"
R"(    fp32x8.s3 = (float)(((q4x8.s0 & 0xF000) >> 12) - 8);
)"
R"(    fp32x8.s4 = (float)((q4x8.s1 & 0x000F) - 8);
)"
R"(    fp32x8.s5 = (float)(((q4x8.s1 & 0x00F0) >> 4) - 8);
)"
R"(    fp32x8.s6 = (float)(((q4x8.s1 & 0x0F00) >> 8) - 8);
)"
R"(    fp32x8.s7 = (float)(((q4x8.s1 & 0xF000) >> 12) - 8);
)"
R"(    return fp32x8;
)"
R"(}
)"
R"(
)"
R"(
)"
R"(__attribute__((qcom_reqd_sub_group_size("half")))
)"
R"(__kernel void kernel_gemv_moe_q4_0_f32_ns(
)"
R"(    __global uint * src0_q,
)"
R"(    __global half * src0_d,
)"
R"(    __read_only image1d_buffer_t src1,
)"
R"(    __global uint * src2,
)"
R"(    __global float * dst,
)"
R"(    ulong         offsetd,
)"
R"(    int           ne00,
)"
R"(    int           ne01,
)"
R"(    int           ne11
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
R"(    uint expert_offset = expert_id * ne00 * ne01 / 32;
)"
R"(
)"
R"(    __private float sum = 0.0f; // each thread calculate partial sum of one output
)"
R"(
)"
R"(    // loop along ne00 in block granularity, skip 4 blocks every iter
)"
R"(    for (uint ib00 = sgid; ib00 < (ne00 / QK_Q4_0); ib00 += N_SIMDGROUP) {
)"
R"(
)"
R"(        // load one block of q
)"
R"(        uint4 regQ;
)"
R"(        uint block_offset = expert_offset * 4 + ib00 * ne01 * 4 + i01;
)"
R"(
)"
R"(        regQ.s0 = src0_q[block_offset];
)"
R"(        regQ.s1 = src0_q[block_offset + ne01];
)"
R"(        regQ.s2 = src0_q[block_offset + ne01 * 2];
)"
R"(        regQ.s3 = src0_q[block_offset + ne01 * 3];
)"
R"(
)"
R"(        uint offset = i11 * ne00 / 4 + ib00 * 8;
)"
R"(
)"
R"(        float8 fp32x8 = q4_0_to_fp32_packed8(as_ushort2(regQ.s0));
)"
R"(
)"
R"(        float4 shared_y4;
)"
R"(        shared_y4 = read_imagef(src1, (offset + 0));
)"
R"(        float4 acc = shared_y4 * fp32x8.lo;
)"
R"(
)"
R"(        shared_y4 = read_imagef(src1, (offset + 1));
)"
R"(        acc += shared_y4 * fp32x8.hi;
)"
R"(
)"
R"(        fp32x8 = q4_0_to_fp32_packed8(as_ushort2(regQ.s1));
)"
R"(
)"
R"(        shared_y4 = read_imagef(src1, (offset + 2));
)"
R"(        acc += shared_y4 * fp32x8.lo;
)"
R"(
)"
R"(        shared_y4 = read_imagef(src1, (offset + 3));
)"
R"(        acc += shared_y4 * fp32x8.hi;
)"
R"(
)"
R"(
)"
R"(        fp32x8 = q4_0_to_fp32_packed8(as_ushort2(regQ.s2));
)"
R"(
)"
R"(        shared_y4 = read_imagef(src1, (offset + 4));
)"
R"(        acc += shared_y4 * fp32x8.lo;
)"
R"(
)"
R"(        shared_y4 = read_imagef(src1, (offset + 5));
)"
R"(        acc += shared_y4 * fp32x8.hi;
)"
R"(
)"
R"(
)"
R"(        fp32x8 = q4_0_to_fp32_packed8(as_ushort2(regQ.s3));
)"
R"(
)"
R"(        shared_y4 = read_imagef(src1, (offset + 6));
)"
R"(        acc += shared_y4 * fp32x8.lo;
)"
R"(
)"
R"(        shared_y4 = read_imagef(src1, (offset + 7));
)"
R"(        acc += shared_y4 * fp32x8.hi;
)"
R"(
)"
R"(        half regS = src0_d[ib00 * ne01 + i01 + expert_offset];
)"
R"(        sum += (float)(regS) * ((acc.s0 + acc.s1) + (acc.s2 + acc.s3));
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
R"(    // 1 outputs per thread in subgroup 0
)"
R"(    if (sgid == 0) {
)"
R"(        dst = dst + (offsetd >> 2);
)"
R"(        dst[i01 + i20 * ne01] = sum;
)"
R"(    }
)"
R"(
)"
R"(}
)"
