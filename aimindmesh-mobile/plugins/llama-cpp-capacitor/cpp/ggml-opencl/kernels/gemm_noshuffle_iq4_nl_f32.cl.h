R"(#pragma OPENCL EXTENSION cl_khr_fp16 : enable
)"
R"(#pragma OPENCL EXTENSION cl_qcom_reqd_sub_group_size : enable
)"
R"(
)"
R"(#ifdef cl_qcom_reqd_sub_group_size
)"
R"(#define ADRENO_GPU 1
)"
R"(#define REQD_SUBGROUP_SIZE_128 __attribute__((qcom_reqd_sub_group_size("full")))
)"
R"(#endif
)"
R"(
)"
R"(constant half kvalues_iq4nl[16] = {
)"
R"(    (half)-127.f, (half)-104.f, (half)-83.f, (half)-65.f,
)"
R"(    (half) -49.f, (half) -35.f, (half)-22.f, (half)-10.f,
)"
R"(    (half)   1.f, (half)  13.f, (half) 25.f, (half) 38.f,
)"
R"(    (half)  53.f, (half)  69.f, (half) 89.f, (half)113.f
)"
R"(};
)"
R"(
)"
R"(// Packed LUT: 2 FP16 values per uint, 8 unique constant loads instead of 16
)"
R"(constant uint iq4nl_packed[8] = {
)"
R"(    0xD680D7F0u,  // idx 0,1: -127, -104
)"
R"(    0xD410D530u,  // idx 2,3: -83, -65
)"
R"(    0xD060D220u,  // idx 4,5: -49, -35
)"
R"(    0xC900CD80u,  // idx 6,7: -22, -10
)"
R"(    0x4A803C00u,  // idx 8,9: 1, 13
)"
R"(    0x50C04E40u,  // idx 10,11: 25, 38
)"
R"(    0x545052A0u,  // idx 12,13: 53, 69
)"
R"(    0x57105590u   // idx 14,15: 89, 113
)"
R"(};
)"
R"(
)"
R"(// Packed dequant: 1 uint constant load (8-way divergence) + shift + as_half
)"
R"(#define IQ4_NL_DEQUANT(nibble) as_half((ushort)(iq4nl_packed[(nibble) >> 1] >> (((nibble) & 1u) << 4)))
)"
R"(
)"
R"(#ifdef ADRENO_GPU
)"
R"(REQD_SUBGROUP_SIZE_128
)"
R"(#endif
)"
R"(
)"
R"(kernel void kernel_gemm_noshuffle_iq4_nl_f32(
)"
R"(        global const ushort * src0_q,
)"
R"(        global const half  * src0_d,
)"
R"(        read_only image1d_buffer_t src1,
)"
R"(        global float * dst,
)"
R"(        ulong offsetd,
)"
R"(        int m,
)"
R"(        int n,
)"
R"(        int k,
)"
R"(        int n_no_padding
)"
R"() {
)"
R"(    dst = (global float *)((global char *)dst + offsetd);
)"
R"(
)"
R"(    int m_4 = m >> 2;
)"
R"(    int n_4 = n >> 2;
)"
R"(
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
R"(    global const ushort * weight_ptr = src0_q + gx_2;
)"
R"(    global const half * scale_ptr = src0_d + gx_2;
)"
R"(
)"
R"(    for (int i = 0; i < k; i += 4) {
)"
R"(        B.s0123 = read_imageh(src1, gy*2 + (i)*(n_4));
)"
R"(        B.s4567 = read_imageh(src1, gy*2 + (i)*(n_4)+1);
)"
R"(
)"
R"(        ushort4 bits4 = vload4(0, weight_ptr + (i/4)*(m));
)"
R"(
)"
R"(        half4 scale = vload4(0, scale_ptr + (i/32)*(m));
)"
R"(
)"
R"(        // j=0
)"
R"(        dequantized_weights.s0 = IQ4_NL_DEQUANT(bits4.s0 & 0x000Fu) * scale.s0;
)"
R"(        dequantized_weights.s1 = IQ4_NL_DEQUANT(bits4.s1 & 0x000Fu) * scale.s1;
)"
R"(        dequantized_weights.s2 = IQ4_NL_DEQUANT(bits4.s2 & 0x000Fu) * scale.s2;
)"
R"(        dequantized_weights.s3 = IQ4_NL_DEQUANT(bits4.s3 & 0x000Fu) * scale.s3;
)"
R"(        c0 += B * dequantized_weights.s0;
)"
R"(        c1 += B * dequantized_weights.s1;
)"
R"(        c2 += B * dequantized_weights.s2;
)"
R"(        c3 += B * dequantized_weights.s3;
)"
R"(
)"
R"(        // j=1
)"
R"(        B.s0123 = read_imageh(src1, gy*2 + (i+1)*(n_4));
)"
R"(        B.s4567 = read_imageh(src1, gy*2 + (i+1)*(n_4)+1);
)"
R"(        dequantized_weights.s0 = IQ4_NL_DEQUANT((bits4.s0 >> 4) & 0x000Fu) * scale.s0;
)"
R"(        dequantized_weights.s1 = IQ4_NL_DEQUANT((bits4.s1 >> 4) & 0x000Fu) * scale.s1;
)"
R"(        dequantized_weights.s2 = IQ4_NL_DEQUANT((bits4.s2 >> 4) & 0x000Fu) * scale.s2;
)"
R"(        dequantized_weights.s3 = IQ4_NL_DEQUANT((bits4.s3 >> 4) & 0x000Fu) * scale.s3;
)"
R"(        c0 += B * dequantized_weights.s0;
)"
R"(        c1 += B * dequantized_weights.s1;
)"
R"(        c2 += B * dequantized_weights.s2;
)"
R"(        c3 += B * dequantized_weights.s3;
)"
R"(
)"
R"(        // j=2
)"
R"(        B.s0123 = read_imageh(src1, gy*2 + (i+2)*(n_4));
)"
R"(        B.s4567 = read_imageh(src1, gy*2 + (i+2)*(n_4)+1);
)"
R"(        dequantized_weights.s0 = IQ4_NL_DEQUANT((bits4.s0 >> 8) & 0x000Fu) * scale.s0;
)"
R"(        dequantized_weights.s1 = IQ4_NL_DEQUANT((bits4.s1 >> 8) & 0x000Fu) * scale.s1;
)"
R"(        dequantized_weights.s2 = IQ4_NL_DEQUANT((bits4.s2 >> 8) & 0x000Fu) * scale.s2;
)"
R"(        dequantized_weights.s3 = IQ4_NL_DEQUANT((bits4.s3 >> 8) & 0x000Fu) * scale.s3;
)"
R"(        c0 += B * dequantized_weights.s0;
)"
R"(        c1 += B * dequantized_weights.s1;
)"
R"(        c2 += B * dequantized_weights.s2;
)"
R"(        c3 += B * dequantized_weights.s3;
)"
R"(
)"
R"(        // j=3
)"
R"(        B.s0123 = read_imageh(src1, gy*2 + (i+3)*(n_4));
)"
R"(        B.s4567 = read_imageh(src1, gy*2 + (i+3)*(n_4)+1);
)"
R"(        dequantized_weights.s0 = IQ4_NL_DEQUANT((bits4.s0 >> 12) & 0x000Fu) * scale.s0;
)"
R"(        dequantized_weights.s1 = IQ4_NL_DEQUANT((bits4.s1 >> 12) & 0x000Fu) * scale.s1;
)"
R"(        dequantized_weights.s2 = IQ4_NL_DEQUANT((bits4.s2 >> 12) & 0x000Fu) * scale.s2;
)"
R"(        dequantized_weights.s3 = IQ4_NL_DEQUANT((bits4.s3 >> 12) & 0x000Fu) * scale.s3;
)"
R"(        c0 += B * dequantized_weights.s0;
)"
R"(        c1 += B * dequantized_weights.s1;
)"
R"(        c2 += B * dequantized_weights.s2;
)"
R"(        c3 += B * dequantized_weights.s3;
)"
R"(    }
)"
R"(
)"
R"(    int idx = (gy<<3)*m + (gx<<2);
)"
R"(
)"
R"(    if(idx+3 < m*n_no_padding){
)"
R"(        vstore4((float4)(c0.s0, c1.s0, c2.s0, c3.s0), 0, dst + idx);
)"
R"(        idx += m;
)"
R"(    }
)"
R"(    if(idx+3 < m*n_no_padding){
)"
R"(        vstore4((float4)(c0.s1, c1.s1, c2.s1, c3.s1), 0, dst + idx);
)"
R"(        idx += m;
)"
R"(    }
)"
R"(    if(idx+3 < m*n_no_padding){
)"
R"(        vstore4((float4)(c0.s2, c1.s2, c2.s2, c3.s2), 0, dst + idx);
)"
R"(        idx += m;
)"
R"(    }
)"
R"(    if(idx+3 < m*n_no_padding){
)"
R"(        vstore4((float4)(c0.s3, c1.s3, c2.s3, c3.s3), 0, dst + idx);
)"
R"(        idx += m;
)"
R"(    }
)"
R"(    if(idx+3 < m*n_no_padding){
)"
R"(        vstore4((float4)(c0.s4, c1.s4, c2.s4, c3.s4), 0, dst + idx);
)"
R"(        idx += m;
)"
R"(    }
)"
R"(    if(idx+3 < m*n_no_padding){
)"
R"(        vstore4((float4)(c0.s5, c1.s5, c2.s5, c3.s5), 0, dst + idx);
)"
R"(        idx += m;
)"
R"(    }
)"
R"(    if(idx+3 < m*n_no_padding){
)"
R"(        vstore4((float4)(c0.s6, c1.s6, c2.s6, c3.s6), 0, dst + idx);
)"
R"(        idx += m;
)"
R"(    }
)"
R"(    if(idx+3 < m*n_no_padding){
)"
R"(        vstore4((float4)(c0.s7, c1.s7, c2.s7, c3.s7), 0, dst + idx);
)"
R"(    }
)"
R"(}
)"
