R"(#pragma OPENCL EXTENSION cl_khr_fp16 : enable
)"
R"(
)"
R"(#ifdef cl_qcom_reqd_sub_group_size
)"
R"(#pragma OPENCL EXTENSION cl_qcom_reqd_sub_group_size : enable
)"
R"(#define ADRENO_GPU 1
)"
R"(#define REQD_SUBGROUP_SIZE_128 __attribute__((qcom_reqd_sub_group_size("full")))
)"
R"(#endif
)"
R"(#define QK_K         256
)"
R"(#define K_SCALE_SIZE 12
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
R"(    uchar * m,
)"
R"(    uchar mask_d6,
)"
R"(    uchar mask_d4,
)"
R"(    uchar mask_hi2
)"
R"() {
)"
R"(    if (j < 4) {
)"
R"(        *d = q[j]   & mask_d6;
)"
R"(        *m = q[j+4] & mask_d6;
)"
R"(    } else {
)"
R"(        *d = (q[j+4] & mask_d4) | ((q[j-4] & mask_hi2) >> 2);
)"
R"(        *m = ((q[j+4] >> 4) & mask_d4) | ((q[j]   & mask_hi2) >> 2);
)"
R"(    }
)"
R"(}
)"
R"(
)"
R"(#ifdef ADRENO_GPU
)"
R"(REQD_SUBGROUP_SIZE_128
)"
R"(#endif
)"
R"(kernel void kernel_gemm_noshuffle_q4_k_f32(
)"
R"(    global const ushort * src0_q,
)"
R"(    global const uchar  * src0_s,
)"
R"(    global const half   * src0_d,
)"
R"(    global const half   * src0_dm,
)"
R"(    read_only image1d_buffer_t src1,
)"
R"(    global float * dst,
)"
R"(    ulong offsetd,
)"
R"(    int m,
)"
R"(    int n,
)"
R"(    int k,
)"
R"(    int n_no_padding,
)"
R"(    uchar mask_d6,
)"
R"(    uchar mask_d4,
)"
R"(    uchar mask_hi2
)"
R"() {
)"
R"(    dst = (global float *)((global char *)dst + offsetd);
)"
R"(    int n_4 = n >> 2;
)"
R"(    int gy = get_global_id(0);
)"
R"(    int gx = get_global_id(1);
)"
R"(    int gx_2 = gx << 2;
)"
R"(
)"
R"(    half8 c0 = 0, c1 = 0, c2 = 0, c3 = 0;
)"
R"(    half8 B;
)"
R"(    half4 dequantized_weights;
)"
R"(
)"
R"(    int num_blocks_K = k / QK_K;
)"
R"(
)"
R"(    global const ushort * weight_ptr = src0_q + gx_2;
)"
R"(    global const half   * d_ptr      = src0_d  + gx_2;
)"
R"(    global const half   * dm_ptr     = src0_dm + gx_2;
)"
R"(
)"
R"(    for (int i = 0; i < k; i += 32) {
)"
R"(        int sb_idx  = i / QK_K;
)"
R"(        int sub_idx = (i / 32) % 8;
)"
R"(
)"
R"(        half4 d  = vload4(0, d_ptr  + sb_idx * m);
)"
R"(        half4 dm = vload4(0, dm_ptr + sb_idx * m);
)"
R"(
)"
R"(        global const uchar * sc0 = src0_s + (gx_2+0) * num_blocks_K * K_SCALE_SIZE + sb_idx * K_SCALE_SIZE;
)"
R"(        global const uchar * sc1 = src0_s + (gx_2+1) * num_blocks_K * K_SCALE_SIZE + sb_idx * K_SCALE_SIZE;
)"
R"(        global const uchar * sc2 = src0_s + (gx_2+2) * num_blocks_K * K_SCALE_SIZE + sb_idx * K_SCALE_SIZE;
)"
R"(        global const uchar * sc3 = src0_s + (gx_2+3) * num_blocks_K * K_SCALE_SIZE + sb_idx * K_SCALE_SIZE;
)"
R"(
)"
R"(        uchar sv0, mn0, sv1, mn1, sv2, mn2, sv3, mn3;
)"
R"(        get_scale_min_k4(sub_idx, sc0, &sv0, &mn0, mask_d6, mask_d4, mask_hi2);
)"
R"(        get_scale_min_k4(sub_idx, sc1, &sv1, &mn1, mask_d6, mask_d4, mask_hi2);
)"
R"(        get_scale_min_k4(sub_idx, sc2, &sv2, &mn2, mask_d6, mask_d4, mask_hi2);
)"
R"(        get_scale_min_k4(sub_idx, sc3, &sv3, &mn3, mask_d6, mask_d4, mask_hi2);
)"
R"(
)"
R"(        half4 scale = convert_half4(convert_float4(d)  * convert_float4((uchar4)(sv0, sv1, sv2, sv3)));
)"
R"(        half4 mval  = convert_half4(convert_float4(dm) * convert_float4((uchar4)(mn0, mn1, mn2, mn3)));
)"
R"(
)"
R"(        for (int l = 0; l < 32; l += 4) {
)"
R"(            int ki = i + l;
)"
R"(            ushort4 bits4 = vload4(0, weight_ptr + (ki/4) * m);
)"
R"(
)"
R"(            // j=0
)"
R"(            B.s0123 = read_imageh(src1, gy*2   + (ki+0) * n_4);
)"
R"(            B.s4567 = read_imageh(src1, gy*2+1 + (ki+0) * n_4);
)"
R"(            dequantized_weights.s0 = (bits4.s0 & 0x000F) * scale.s0 - mval.s0;
)"
R"(            dequantized_weights.s1 = (bits4.s1 & 0x000F) * scale.s1 - mval.s1;
)"
R"(            dequantized_weights.s2 = (bits4.s2 & 0x000F) * scale.s2 - mval.s2;
)"
R"(            dequantized_weights.s3 = (bits4.s3 & 0x000F) * scale.s3 - mval.s3;
)"
R"(            c0 += B * dequantized_weights.s0;
)"
R"(            c1 += B * dequantized_weights.s1;
)"
R"(            c2 += B * dequantized_weights.s2;
)"
R"(            c3 += B * dequantized_weights.s3;
)"
R"(
)"
R"(            // j=1
)"
R"(            B.s0123 = read_imageh(src1, gy*2   + (ki+1) * n_4);
)"
R"(            B.s4567 = read_imageh(src1, gy*2+1 + (ki+1) * n_4);
)"
R"(            dequantized_weights.s0 = ((bits4.s0 & 0x00F0) >> 4) * scale.s0 - mval.s0;
)"
R"(            dequantized_weights.s1 = ((bits4.s1 & 0x00F0) >> 4) * scale.s1 - mval.s1;
)"
R"(            dequantized_weights.s2 = ((bits4.s2 & 0x00F0) >> 4) * scale.s2 - mval.s2;
)"
R"(            dequantized_weights.s3 = ((bits4.s3 & 0x00F0) >> 4) * scale.s3 - mval.s3;
)"
R"(            c0 += B * dequantized_weights.s0;
)"
R"(            c1 += B * dequantized_weights.s1;
)"
R"(            c2 += B * dequantized_weights.s2;
)"
R"(            c3 += B * dequantized_weights.s3;
)"
R"(
)"
R"(            // j=2
)"
R"(            B.s0123 = read_imageh(src1, gy*2   + (ki+2) * n_4);
)"
R"(            B.s4567 = read_imageh(src1, gy*2+1 + (ki+2) * n_4);
)"
R"(            dequantized_weights.s0 = ((bits4.s0 & 0x0F00) >> 8) * scale.s0 - mval.s0;
)"
R"(            dequantized_weights.s1 = ((bits4.s1 & 0x0F00) >> 8) * scale.s1 - mval.s1;
)"
R"(            dequantized_weights.s2 = ((bits4.s2 & 0x0F00) >> 8) * scale.s2 - mval.s2;
)"
R"(            dequantized_weights.s3 = ((bits4.s3 & 0x0F00) >> 8) * scale.s3 - mval.s3;
)"
R"(            c0 += B * dequantized_weights.s0;
)"
R"(            c1 += B * dequantized_weights.s1;
)"
R"(            c2 += B * dequantized_weights.s2;
)"
R"(            c3 += B * dequantized_weights.s3;
)"
R"(
)"
R"(            // j=3
)"
R"(            B.s0123 = read_imageh(src1, gy*2   + (ki+3) * n_4);
)"
R"(            B.s4567 = read_imageh(src1, gy*2+1 + (ki+3) * n_4);
)"
R"(            dequantized_weights.s0 = ((bits4.s0 & 0xF000) >> 12) * scale.s0 - mval.s0;
)"
R"(            dequantized_weights.s1 = ((bits4.s1 & 0xF000) >> 12) * scale.s1 - mval.s1;
)"
R"(            dequantized_weights.s2 = ((bits4.s2 & 0xF000) >> 12) * scale.s2 - mval.s2;
)"
R"(            dequantized_weights.s3 = ((bits4.s3 & 0xF000) >> 12) * scale.s3 - mval.s3;
)"
R"(            c0 += B * dequantized_weights.s0;
)"
R"(            c1 += B * dequantized_weights.s1;
)"
R"(            c2 += B * dequantized_weights.s2;
)"
R"(            c3 += B * dequantized_weights.s3;
)"
R"(        }
)"
R"(    }
)"
R"(
)"
R"(    int idx = (gy<<3)*m + (gx<<2);
)"
R"(
)"
R"(    if (idx+3 < m*n_no_padding) {
)"
R"(        vstore4((float4)(c0.s0, c1.s0, c2.s0, c3.s0), 0, dst + idx);
)"
R"(        idx += m;
)"
R"(    }
)"
R"(    if (idx+3 < m*n_no_padding) {
)"
R"(        vstore4((float4)(c0.s1, c1.s1, c2.s1, c3.s1), 0, dst + idx);
)"
R"(        idx += m;
)"
R"(    }
)"
R"(    if (idx+3 < m*n_no_padding) {
)"
R"(        vstore4((float4)(c0.s2, c1.s2, c2.s2, c3.s2), 0, dst + idx);
)"
R"(        idx += m;
)"
R"(    }
)"
R"(    if (idx+3 < m*n_no_padding) {
)"
R"(        vstore4((float4)(c0.s3, c1.s3, c2.s3, c3.s3), 0, dst + idx);
)"
R"(        idx += m;
)"
R"(    }
)"
R"(    if (idx+3 < m*n_no_padding) {
)"
R"(        vstore4((float4)(c0.s4, c1.s4, c2.s4, c3.s4), 0, dst + idx);
)"
R"(        idx += m;
)"
R"(    }
)"
R"(    if (idx+3 < m*n_no_padding) {
)"
R"(        vstore4((float4)(c0.s5, c1.s5, c2.s5, c3.s5), 0, dst + idx);
)"
R"(        idx += m;
)"
R"(    }
)"
R"(    if (idx+3 < m*n_no_padding) {
)"
R"(        vstore4((float4)(c0.s6, c1.s6, c2.s6, c3.s6), 0, dst + idx);
)"
R"(        idx += m;
)"
R"(    }
)"
R"(    if (idx+3 < m*n_no_padding) {
)"
R"(        vstore4((float4)(c0.s7, c1.s7, c2.s7, c3.s7), 0, dst + idx);
)"
R"(    }
)"
R"(}
)"
