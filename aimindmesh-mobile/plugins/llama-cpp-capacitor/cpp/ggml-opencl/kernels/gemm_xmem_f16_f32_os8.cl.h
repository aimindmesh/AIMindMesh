R"(#pragma OPENCL EXTENSION cl_khr_fp16 : enable
)"
R"(#pragma OPENCL EXTENSION cl_qcom_subgroup_uniform_load : enable
)"
R"(#pragma OPENCL EXTENSION cl_qcom_subgroup_constant_load : enable
)"
R"(
)"
R"(__constant sampler_t smp_zero = CLK_NORMALIZED_COORDS_FALSE | CLK_ADDRESS_CLAMP | CLK_FILTER_NEAREST;
)"
R"(
)"
R"(__kernel void adreno_xmem_pack_src_f32(
)"
R"(    __global const void * src_void,
)"
R"(    ulong offset,
)"
R"(    __write_only image2d_t src_img,
)"
R"(    int K,
)"
R"(    int N) {
)"
R"(    const int x = get_global_id(0);
)"
R"(    const int y = get_global_id(1);
)"
R"(    const int kpack = K / 4;
)"
R"(
)"
R"(    if (x >= N || y >= kpack) {
)"
R"(        return;
)"
R"(    }
)"
R"(
)"
R"(    __global const float * src = (__global const float *)((__global const char *)src_void + offset);
)"
R"(    const int base = x*K + y*4;
)"
R"(    const half4 v = (half4)((half)src[base + 0], (half)src[base + 1], (half)src[base + 2], (half)src[base + 3]);
)"
R"(    write_imageh(src_img, (int2)(x, y), v);
)"
R"(}
)"
R"(
)"
R"(__kernel void adreno_xmem_prepack_weight_f16(
)"
R"(    __global half4 * dst,
)"
R"(    __global const void * src_void,
)"
R"(    ulong offset,
)"
R"(    int K,
)"
R"(    int M,
)"
R"(    int kpack,
)"
R"(    int npack,
)"
R"(    int os) {
)"
R"(    const int linear = get_global_id(0);
)"
R"(    const int total = kpack*npack;
)"
R"(    if (linear >= total) {
)"
R"(        return;
)"
R"(    }
)"
R"(
)"
R"(    __global const half * src = (__global const half *)((__global const char *)src_void + offset);
)"
R"(
)"
R"(    const int dst_ogroup = linear % os;
)"
R"(    const int dst_o_sp_i = linear / os;
)"
R"(    const int dst_i = dst_o_sp_i % kpack;
)"
R"(    const int dst_o = dst_o_sp_i / kpack;
)"
R"(    const int o_slice = dst_o*os + dst_ogroup;
)"
R"(    const int k_base = dst_i*4;
)"
R"(
)"
R"(    half4 w0 = (half4)(0.0h);
)"
R"(    half4 w1 = (half4)(0.0h);
)"
R"(    half4 w2 = (half4)(0.0h);
)"
R"(    half4 w3 = (half4)(0.0h);
)"
R"(
)"
R"(    const int o0 = o_slice*4 + 0;
)"
R"(    const int o1 = o_slice*4 + 1;
)"
R"(    const int o2 = o_slice*4 + 2;
)"
R"(    const int o3 = o_slice*4 + 3;
)"
R"(
)"
R"(    if (k_base + 0 < K) {
)"
R"(        if (o0 < M) w0.s0 = src[o0*K + k_base + 0];
)"
R"(        if (o1 < M) w0.s1 = src[o1*K + k_base + 0];
)"
R"(        if (o2 < M) w0.s2 = src[o2*K + k_base + 0];
)"
R"(        if (o3 < M) w0.s3 = src[o3*K + k_base + 0];
)"
R"(    }
)"
R"(    if (k_base + 1 < K) {
)"
R"(        if (o0 < M) w1.s0 = src[o0*K + k_base + 1];
)"
R"(        if (o1 < M) w1.s1 = src[o1*K + k_base + 1];
)"
R"(        if (o2 < M) w1.s2 = src[o2*K + k_base + 1];
)"
R"(        if (o3 < M) w1.s3 = src[o3*K + k_base + 1];
)"
R"(    }
)"
R"(    if (k_base + 2 < K) {
)"
R"(        if (o0 < M) w2.s0 = src[o0*K + k_base + 2];
)"
R"(        if (o1 < M) w2.s1 = src[o1*K + k_base + 2];
)"
R"(        if (o2 < M) w2.s2 = src[o2*K + k_base + 2];
)"
R"(        if (o3 < M) w2.s3 = src[o3*K + k_base + 2];
)"
R"(    }
)"
R"(    if (k_base + 3 < K) {
)"
R"(        if (o0 < M) w3.s0 = src[o0*K + k_base + 3];
)"
R"(        if (o1 < M) w3.s1 = src[o1*K + k_base + 3];
)"
R"(        if (o2 < M) w3.s2 = src[o2*K + k_base + 3];
)"
R"(        if (o3 < M) w3.s3 = src[o3*K + k_base + 3];
)"
R"(    }
)"
R"(
)"
R"(    dst[linear*4 + 0] = w0;
)"
R"(    dst[linear*4 + 1] = w1;
)"
R"(    dst[linear*4 + 2] = w2;
)"
R"(    dst[linear*4 + 3] = w3;
)"
R"(}
)"
R"(
)"
R"(__attribute__((qcom_max_concurrent_subgroups(12)))
)"
R"(__kernel void kernel_gemm_xmem_f16_f32_os8(
)"
R"(    __constant half8 * weights_buffer __attribute__((sub_group_uniform)),
)"
R"(    __constant half8 * xmem_buffer __attribute__((max_constant_size((6144)))),
)"
R"(    __read_only image2d_t src_img,
)"
R"(    __write_only image2d_t dst_img,
)"
R"(    int N,
)"
R"(    int npack,
)"
R"(    int kpack) {
)"
R"(    const int X = get_group_id(1)*get_local_size(0) + get_local_id(0);
)"
R"(    const int Z = get_group_id(0)*get_local_size(2) + get_local_id(2);
)"
R"(
)"
R"(    if (X >= N || Z*8 >= npack) {
)"
R"(        return;
)"
R"(    }
)"
R"(
)"
R"(    half4 r0 = (half4)(0.0h);
)"
R"(    half4 r1 = (half4)(0.0h);
)"
R"(    half4 r2 = (half4)(0.0h);
)"
R"(    half4 r3 = (half4)(0.0h);
)"
R"(    half4 r4 = (half4)(0.0h);
)"
R"(    half4 r5 = (half4)(0.0h);
)"
R"(    half4 r6 = (half4)(0.0h);
)"
R"(    half4 r7 = (half4)(0.0h);
)"
R"(
)"
R"(    int f_offset = Z*kpack*32;
)"
R"(    int subgroup_id = (int)(0x1F & qcom_get_physical_sub_group_id());
)"
R"(    subgroup_id = subgroup_id % 12;
)"
R"(    const int c_offset = subgroup_id*32;
)"
R"(    __constant half16 * weights_cache = (__constant half16 *)&xmem_buffer[c_offset];
)"
R"(
)"
R"(    int coord_s = 0;
)"
R"(    do {
)"
R"(        const half4 src0 = read_imageh(src_img, smp_zero, (int2)(X, coord_s));
)"
R"(        coord_s++;
)"
R"(        const half4 src1 = read_imageh(src_img, smp_zero, (int2)(X, coord_s));
)"
R"(        coord_s++;
)"
R"(
)"
R"(        qcom_sub_group_constant_load8(xmem_buffer, weights_buffer, c_offset, f_offset >> 1, 32);
)"
R"(        f_offset += 64;
)"
R"(        qcom_sub_group_sync(QCOM_CLK_CONST_LOAD_SYNC);
)"
R"(
)"
R"(        r0 += src0.x * weights_cache[0].s0123;
)"
R"(        r0 += src0.y * weights_cache[0].s4567;
)"
R"(        r0 += src0.z * weights_cache[0].s89ab;
)"
R"(        r0 += src0.w * weights_cache[0].scdef;
)"
R"(        r1 += src0.x * weights_cache[1].s0123;
)"
R"(        r1 += src0.y * weights_cache[1].s4567;
)"
R"(        r1 += src0.z * weights_cache[1].s89ab;
)"
R"(        r1 += src0.w * weights_cache[1].scdef;
)"
R"(        r2 += src0.x * weights_cache[2].s0123;
)"
R"(        r2 += src0.y * weights_cache[2].s4567;
)"
R"(        r2 += src0.z * weights_cache[2].s89ab;
)"
R"(        r2 += src0.w * weights_cache[2].scdef;
)"
R"(        r3 += src0.x * weights_cache[3].s0123;
)"
R"(        r3 += src0.y * weights_cache[3].s4567;
)"
R"(        r3 += src0.z * weights_cache[3].s89ab;
)"
R"(        r3 += src0.w * weights_cache[3].scdef;
)"
R"(        r4 += src0.x * weights_cache[4].s0123;
)"
R"(        r4 += src0.y * weights_cache[4].s4567;
)"
R"(        r4 += src0.z * weights_cache[4].s89ab;
)"
R"(        r4 += src0.w * weights_cache[4].scdef;
)"
R"(        r5 += src0.x * weights_cache[5].s0123;
)"
R"(        r5 += src0.y * weights_cache[5].s4567;
)"
R"(        r5 += src0.z * weights_cache[5].s89ab;
)"
R"(        r5 += src0.w * weights_cache[5].scdef;
)"
R"(        r6 += src0.x * weights_cache[6].s0123;
)"
R"(        r6 += src0.y * weights_cache[6].s4567;
)"
R"(        r6 += src0.z * weights_cache[6].s89ab;
)"
R"(        r6 += src0.w * weights_cache[6].scdef;
)"
R"(        r7 += src0.x * weights_cache[7].s0123;
)"
R"(        r7 += src0.y * weights_cache[7].s4567;
)"
R"(        r7 += src0.z * weights_cache[7].s89ab;
)"
R"(        r7 += src0.w * weights_cache[7].scdef;
)"
R"(
)"
R"(        r0 += src1.x * weights_cache[8].s0123;
)"
R"(        r0 += src1.y * weights_cache[8].s4567;
)"
R"(        r0 += src1.z * weights_cache[8].s89ab;
)"
R"(        r0 += src1.w * weights_cache[8].scdef;
)"
R"(        r1 += src1.x * weights_cache[9].s0123;
)"
R"(        r1 += src1.y * weights_cache[9].s4567;
)"
R"(        r1 += src1.z * weights_cache[9].s89ab;
)"
R"(        r1 += src1.w * weights_cache[9].scdef;
)"
R"(        r2 += src1.x * weights_cache[10].s0123;
)"
R"(        r2 += src1.y * weights_cache[10].s4567;
)"
R"(        r2 += src1.z * weights_cache[10].s89ab;
)"
R"(        r2 += src1.w * weights_cache[10].scdef;
)"
R"(        r3 += src1.x * weights_cache[11].s0123;
)"
R"(        r3 += src1.y * weights_cache[11].s4567;
)"
R"(        r3 += src1.z * weights_cache[11].s89ab;
)"
R"(        r3 += src1.w * weights_cache[11].scdef;
)"
R"(        r4 += src1.x * weights_cache[12].s0123;
)"
R"(        r4 += src1.y * weights_cache[12].s4567;
)"
R"(        r4 += src1.z * weights_cache[12].s89ab;
)"
R"(        r4 += src1.w * weights_cache[12].scdef;
)"
R"(        r5 += src1.x * weights_cache[13].s0123;
)"
R"(        r5 += src1.y * weights_cache[13].s4567;
)"
R"(        r5 += src1.z * weights_cache[13].s89ab;
)"
R"(        r5 += src1.w * weights_cache[13].scdef;
)"
R"(        r6 += src1.x * weights_cache[14].s0123;
)"
R"(        r6 += src1.y * weights_cache[14].s4567;
)"
R"(        r6 += src1.z * weights_cache[14].s89ab;
)"
R"(        r6 += src1.w * weights_cache[14].scdef;
)"
R"(        r7 += src1.x * weights_cache[15].s0123;
)"
R"(        r7 += src1.y * weights_cache[15].s4567;
)"
R"(        r7 += src1.z * weights_cache[15].s89ab;
)"
R"(        r7 += src1.w * weights_cache[15].scdef;
)"
R"(    } while (coord_s < kpack);
)"
R"(
)"
R"(    int coord_s_out = Z*8;
)"
R"(    if (coord_s_out < npack) { write_imageh(dst_img, (int2)(X, coord_s_out), r0); coord_s_out++; }
)"
R"(    if (coord_s_out < npack) { write_imageh(dst_img, (int2)(X, coord_s_out), r1); coord_s_out++; }
)"
R"(    if (coord_s_out < npack) { write_imageh(dst_img, (int2)(X, coord_s_out), r2); coord_s_out++; }
)"
R"(    if (coord_s_out < npack) { write_imageh(dst_img, (int2)(X, coord_s_out), r3); coord_s_out++; }
)"
R"(    if (coord_s_out < npack) { write_imageh(dst_img, (int2)(X, coord_s_out), r4); coord_s_out++; }
)"
R"(    if (coord_s_out < npack) { write_imageh(dst_img, (int2)(X, coord_s_out), r5); coord_s_out++; }
)"
R"(    if (coord_s_out < npack) { write_imageh(dst_img, (int2)(X, coord_s_out), r6); coord_s_out++; }
)"
R"(    if (coord_s_out < npack) { write_imageh(dst_img, (int2)(X, coord_s_out), r7); }
)"
R"(}
)"
R"(
)"
R"(__kernel void adreno_xmem_store_dst_f32(
)"
R"(    __read_only image2d_t dst_img,
)"
R"(    __global void * dst_void,
)"
R"(    ulong offset,
)"
R"(    int M,
)"
R"(    int N) {
)"
R"(    const int x = get_global_id(0);
)"
R"(    const int y = get_global_id(1);
)"
R"(    const int npack = (M + 3) / 4;
)"
R"(
)"
R"(    if (x >= N || y >= npack) {
)"
R"(        return;
)"
R"(    }
)"
R"(
)"
R"(    __global float * dst = (__global float *)((__global char *)dst_void + offset);
)"
R"(    const half4 hv = read_imageh(dst_img, smp_zero, (int2)(x, y));
)"
R"(    const int m = y*4;
)"
R"(    if (m + 0 < M) dst[x*M + m + 0] = (float)hv.s0;
)"
R"(    if (m + 1 < M) dst[x*M + m + 1] = (float)hv.s1;
)"
R"(    if (m + 2 < M) dst[x*M + m + 2] = (float)hv.s2;
)"
R"(    if (m + 3 < M) dst[x*M + m + 3] = (float)hv.s3;
)"
R"(}
)"
