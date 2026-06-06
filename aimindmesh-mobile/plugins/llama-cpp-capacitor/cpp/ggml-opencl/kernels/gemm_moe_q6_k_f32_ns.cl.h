R"(#pragma OPENCL EXTENSION cl_khr_fp16 : enable
)"
R"(#pragma OPENCL EXTENSION cl_khr_subgroups : enable
)"
R"(#pragma OPENCL EXTENSION cl_qcom_subgroup_uniform_load: enable
)"
R"(#pragma OPENCL EXTENSION cl_qcom_subgroup_constant_load: enable
)"
R"(#pragma OPENCL EXTENSION cl_qcom_extra_vector_types : enable
)"
R"(
)"
R"(#define TILESIZE_K 16
)"
R"(#define TILESIZE_M 64
)"
R"(#define TILESIZE_N 32
)"
R"(#define QK_K 256
)"
R"(
)"
R"(#define dequantize_q6_k(qs16, qh16, a_f16, scale) \
)"
R"(    a_f16.s0 = (half)(((float)(( qs16.s0 & 0x000F)        | ((uint)(( qh16       ) & 0x3) << 4)) - 32.f) * scale); \
)"
R"(    a_f16.s1 = (half)(((float)((( qs16.s0 >> 4) & 0x000F) | ((uint)(( qh16 >>  2) & 0x3) << 4)) - 32.f) * scale); \
)"
R"(    a_f16.s2 = (half)(((float)((( qs16.s0 >> 8) & 0x000F) | ((uint)(( qh16 >>  4) & 0x3) << 4)) - 32.f) * scale); \
)"
R"(    a_f16.s3 = (half)(((float)((( qs16.s0 >>12) & 0x000F) | ((uint)(( qh16 >>  6) & 0x3) << 4)) - 32.f) * scale); \
)"
R"(    a_f16.s4 = (half)(((float)(( qs16.s1 & 0x000F)        | ((uint)(( qh16 >>  8) & 0x3) << 4)) - 32.f) * scale); \
)"
R"(    a_f16.s5 = (half)(((float)((( qs16.s1 >> 4) & 0x000F) | ((uint)(( qh16 >> 10) & 0x3) << 4)) - 32.f) * scale); \
)"
R"(    a_f16.s6 = (half)(((float)((( qs16.s1 >> 8) & 0x000F) | ((uint)(( qh16 >> 12) & 0x3) << 4)) - 32.f) * scale); \
)"
R"(    a_f16.s7 = (half)(((float)((( qs16.s1 >>12) & 0x000F) | ((uint)(( qh16 >> 14) & 0x3) << 4)) - 32.f) * scale); \
)"
R"(    a_f16.s8 = (half)(((float)(( qs16.s2 & 0x000F)        | ((uint)(( qh16 >> 16) & 0x3) << 4)) - 32.f) * scale); \
)"
R"(    a_f16.s9 = (half)(((float)((( qs16.s2 >> 4) & 0x000F) | ((uint)(( qh16 >> 18) & 0x3) << 4)) - 32.f) * scale); \
)"
R"(    a_f16.sa = (half)(((float)((( qs16.s2 >> 8) & 0x000F) | ((uint)(( qh16 >> 20) & 0x3) << 4)) - 32.f) * scale); \
)"
R"(    a_f16.sb = (half)(((float)((( qs16.s2 >>12) & 0x000F) | ((uint)(( qh16 >> 22) & 0x3) << 4)) - 32.f) * scale); \
)"
R"(    a_f16.sc = (half)(((float)(( qs16.s3 & 0x000F)        | ((uint)(( qh16 >> 24) & 0x3) << 4)) - 32.f) * scale); \
)"
R"(    a_f16.sd = (half)(((float)((( qs16.s3 >> 4) & 0x000F) | ((uint)(( qh16 >> 26) & 0x3) << 4)) - 32.f) * scale); \
)"
R"(    a_f16.se = (half)(((float)((( qs16.s3 >> 8) & 0x000F) | ((uint)(( qh16 >> 28) & 0x3) << 4)) - 32.f) * scale); \
)"
R"(    a_f16.sf = (half)(((float)((( qs16.s3 >>12) & 0x000F) | ((uint)(( qh16 >> 30) & 0x3) << 4)) - 32.f) * scale); \
)"
R"(
)"
R"(
)"
R"(#define dotx16_reduce8(a_reg, b_lm, c_reg, lm_offset) \
)"
R"(    acc.s0 = dot(a_reg.s0123, b_lm[lm_offset + 0]); \
)"
R"(    acc.s1 = dot(a_reg.s0123, b_lm[lm_offset + 1]); \
)"
R"(    acc.s2 = dot(a_reg.s0123, b_lm[lm_offset + 2]); \
)"
R"(    acc.s3 = dot(a_reg.s0123, b_lm[lm_offset + 3]); \
)"
R"(    acc.s4 = dot(a_reg.s0123, b_lm[lm_offset + 4]); \
)"
R"(    acc.s5 = dot(a_reg.s0123, b_lm[lm_offset + 5]); \
)"
R"(    acc.s6 = dot(a_reg.s0123, b_lm[lm_offset + 6]); \
)"
R"(    acc.s7 = dot(a_reg.s0123, b_lm[lm_offset + 7]); \
)"
R"(    acc.s8 = dot(a_reg.s0123, b_lm[lm_offset + 8]); \
)"
R"(    acc.s9 = dot(a_reg.s0123, b_lm[lm_offset + 9]); \
)"
R"(    acc.sa = dot(a_reg.s0123, b_lm[lm_offset + 10]); \
)"
R"(    acc.sb = dot(a_reg.s0123, b_lm[lm_offset + 11]); \
)"
R"(    acc.sc = dot(a_reg.s0123, b_lm[lm_offset + 12]); \
)"
R"(    acc.sd = dot(a_reg.s0123, b_lm[lm_offset + 13]); \
)"
R"(    acc.se = dot(a_reg.s0123, b_lm[lm_offset + 14]); \
)"
R"(    acc.sf = dot(a_reg.s0123, b_lm[lm_offset + 15]); \
)"
R"(    acc.s0 += dot(a_reg.s4567, b_lm[lm_offset + 32]); \
)"
R"(    acc.s1 += dot(a_reg.s4567, b_lm[lm_offset + 33]); \
)"
R"(    acc.s2 += dot(a_reg.s4567, b_lm[lm_offset + 34]); \
)"
R"(    acc.s3 += dot(a_reg.s4567, b_lm[lm_offset + 35]); \
)"
R"(    acc.s4 += dot(a_reg.s4567, b_lm[lm_offset + 36]); \
)"
R"(    acc.s5 += dot(a_reg.s4567, b_lm[lm_offset + 37]); \
)"
R"(    acc.s6 += dot(a_reg.s4567, b_lm[lm_offset + 38]); \
)"
R"(    acc.s7 += dot(a_reg.s4567, b_lm[lm_offset + 39]); \
)"
R"(    acc.s8 += dot(a_reg.s4567, b_lm[lm_offset + 40]); \
)"
R"(    acc.s9 += dot(a_reg.s4567, b_lm[lm_offset + 41]); \
)"
R"(    acc.sa += dot(a_reg.s4567, b_lm[lm_offset + 42]); \
)"
R"(    acc.sb += dot(a_reg.s4567, b_lm[lm_offset + 43]); \
)"
R"(    acc.sc += dot(a_reg.s4567, b_lm[lm_offset + 44]); \
)"
R"(    acc.sd += dot(a_reg.s4567, b_lm[lm_offset + 45]); \
)"
R"(    acc.se += dot(a_reg.s4567, b_lm[lm_offset + 46]); \
)"
R"(    acc.sf += dot(a_reg.s4567, b_lm[lm_offset + 47]); \
)"
R"(    c_reg.lo += convert_float8(acc.lo); \
)"
R"(    c_reg.hi += convert_float8(acc.hi); \
)"
R"(    acc.s0 = dot(a_reg.s89ab, b_lm[lm_offset + 64]); \
)"
R"(    acc.s1 = dot(a_reg.s89ab, b_lm[lm_offset + 65]); \
)"
R"(    acc.s2 = dot(a_reg.s89ab, b_lm[lm_offset + 66]); \
)"
R"(    acc.s3 = dot(a_reg.s89ab, b_lm[lm_offset + 67]); \
)"
R"(    acc.s4 = dot(a_reg.s89ab, b_lm[lm_offset + 68]); \
)"
R"(    acc.s5 = dot(a_reg.s89ab, b_lm[lm_offset + 69]); \
)"
R"(    acc.s6 = dot(a_reg.s89ab, b_lm[lm_offset + 70]); \
)"
R"(    acc.s7 = dot(a_reg.s89ab, b_lm[lm_offset + 71]); \
)"
R"(    acc.s8 = dot(a_reg.s89ab, b_lm[lm_offset + 72]); \
)"
R"(    acc.s9 = dot(a_reg.s89ab, b_lm[lm_offset + 73]); \
)"
R"(    acc.sa = dot(a_reg.s89ab, b_lm[lm_offset + 74]); \
)"
R"(    acc.sb = dot(a_reg.s89ab, b_lm[lm_offset + 75]); \
)"
R"(    acc.sc = dot(a_reg.s89ab, b_lm[lm_offset + 76]); \
)"
R"(    acc.sd = dot(a_reg.s89ab, b_lm[lm_offset + 77]); \
)"
R"(    acc.se = dot(a_reg.s89ab, b_lm[lm_offset + 78]); \
)"
R"(    acc.sf = dot(a_reg.s89ab, b_lm[lm_offset + 79]); \
)"
R"(    acc.s0 += dot(a_reg.scdef, b_lm[lm_offset + 96]); \
)"
R"(    acc.s1 += dot(a_reg.scdef, b_lm[lm_offset + 97]); \
)"
R"(    acc.s2 += dot(a_reg.scdef, b_lm[lm_offset + 98]); \
)"
R"(    acc.s3 += dot(a_reg.scdef, b_lm[lm_offset + 99]); \
)"
R"(    acc.s4 += dot(a_reg.scdef, b_lm[lm_offset + 100]); \
)"
R"(    acc.s5 += dot(a_reg.scdef, b_lm[lm_offset + 101]); \
)"
R"(    acc.s6 += dot(a_reg.scdef, b_lm[lm_offset + 102]); \
)"
R"(    acc.s7 += dot(a_reg.scdef, b_lm[lm_offset + 103]); \
)"
R"(    acc.s8 += dot(a_reg.scdef, b_lm[lm_offset + 104]); \
)"
R"(    acc.s9 += dot(a_reg.scdef, b_lm[lm_offset + 105]); \
)"
R"(    acc.sa += dot(a_reg.scdef, b_lm[lm_offset + 106]); \
)"
R"(    acc.sb += dot(a_reg.scdef, b_lm[lm_offset + 107]); \
)"
R"(    acc.sc += dot(a_reg.scdef, b_lm[lm_offset + 108]); \
)"
R"(    acc.sd += dot(a_reg.scdef, b_lm[lm_offset + 109]); \
)"
R"(    acc.se += dot(a_reg.scdef, b_lm[lm_offset + 110]); \
)"
R"(    acc.sf += dot(a_reg.scdef, b_lm[lm_offset + 111]); \
)"
R"(    c_reg.lo += convert_float8(acc.lo); \
)"
R"(    c_reg.hi += convert_float8(acc.hi); \
)"
R"(
)"
R"(
)"
R"(__attribute__((qcom_wave_pair_mode(1)))
)"
R"(kernel void kernel_gemm_moe_q6_k_f32_ns(
)"
R"(        __read_only  image1d_buffer_t src0_ql,
)"
R"(        __global     uint *           src0_qh,
)"
R"(        __global     char *           src0_s,
)"
R"(        __global     half *           src0_d,
)"
R"(        __read_only  image1d_buffer_t src1,
)"
R"(        __global     uint *           src2,
)"
R"(        __global     ushort *         src2_emap,
)"
R"(        __write_only image1d_buffer_t dst,
)"
R"(        __global     int *            total_tiles,
)"
R"(        uint ne00,
)"
R"(        uint ne01
)"
R"() {
)"
R"(    uint block_id_m = get_global_id(1); // m_tile
)"
R"(    uint block_id_n = get_global_id(2); // n_tile
)"
R"(
)"
R"(    // Boundary check
)"
R"(    if (block_id_n >= total_tiles[0]) {
)"
R"(        return;
)"
R"(    }
)"
R"(
)"
R"(    __private half16 reg_a;
)"
R"(    __private float32 reg_c = (float32)(0);
)"
R"(    __local half4 shared_b[128];
)"
R"(
)"
R"(    const ushort expert_id = src2_emap[block_id_n];
)"
R"(
)"
R"(    const uint row = block_id_m * TILESIZE_M;
)"
R"(    const uint col = block_id_n * TILESIZE_N;
)"
R"(
)"
R"(    uint sub_block_id_m = get_local_id(0);
)"
R"(    uint2 b_global_offset;
)"
R"(    b_global_offset.x = ((sub_block_id_m & 3) << 2) + (sub_block_id_m >> 2) * ne00;
)"
R"(    b_global_offset.y = b_global_offset.x + (16 * ne00);
)"
R"(    uint2 b_local_offset;
)"
R"(    b_local_offset.x = (sub_block_id_m & 3) * 32 + (sub_block_id_m >> 2);
)"
R"(    b_local_offset.y = b_local_offset.x + 16;
)"
R"(
)"
R"(    uint num_superblocks = ne00 / QK_K;
)"
R"(    uint scales_per_row = num_superblocks * 16;
)"
R"(    uint row_idx = row + get_global_id(0);
)"
R"(
)"
R"(    // Loop along K axis, 32 elements per iteration (one sub-block), divided into 2 halves of 16
)"
R"(    for (uint step = 0; step < ne00; step += TILESIZE_K * 2) {
)"
R"(        uint sub = step / 32;  // 32-element group index
)"
R"(        uint sb = sub / 8;     // super-block index
)"
R"(        uint j = sub % 8;      // group within super-block
)"
R"(
)"
R"(        // Load d for super-block
)"
R"(        uint d_offset = row + sb * ne01 + expert_id * num_superblocks * ne01 + get_global_id(0);
)"
R"(        half d_val = src0_d[d_offset];
)"
R"(
)"
R"(        // Load sub-block scales
)"
R"(        global const char * sc = src0_s + (expert_id * ne01 + row_idx) * scales_per_row + sb * 16;
)"
R"(        float scale0 = (float)d_val * (float)sc[j * 2];
)"
R"(        float scale1 = (float)d_val * (float)sc[j * 2 + 1];
)"
R"(
)"
R"(        uint qh_base = row + (sub * 2) * ne01 + expert_id * (num_superblocks * 16) * ne01 + get_global_id(0);
)"
R"(        uint qh_first16 = src0_qh[qh_base];
)"
R"(        uint qh_second16 = src0_qh[qh_base + ne01];
)"
R"(
)"
R"(        // First half (16 elements)
)"
R"(        uint q_sub_offset = row + ((ne01 * step) >> 3) + ((expert_id * ne00 * ne01) >> 3);
)"
R"(        uint b_sub_offset = col * ne00 + step;
)"
R"(
)"
R"(        // Load 16 ql nibbles (2 uints) from image
)"
R"(        uint2 q4x16;
)"
R"(        q4x16.x = read_imageui(src0_ql, q_sub_offset + sub_block_id_m).x;
)"
R"(        q4x16.y = read_imageui(src0_ql, q_sub_offset + sub_block_id_m + ne01).x;
)"
R"(
)"
R"(        // Load 16x32 floats from matrix B
)"
R"(        float8 bx8_f32;
)"
R"(        bx8_f32.lo = read_imagef(src1, (b_sub_offset + b_global_offset.x) / 4);
)"
R"(        bx8_f32.hi = read_imagef(src1, (b_sub_offset + b_global_offset.y) / 4);
)"
R"(        half8 bx8_f16 = convert_half8(bx8_f32);
)"
R"(        shared_b[b_local_offset.x] = bx8_f16.lo;
)"
R"(        shared_b[b_local_offset.y] = bx8_f16.hi;
)"
R"(
)"
R"(        // Dequantize first 16 elements (scale0)
)"
R"(        dequantize_q6_k(as_ushort4(q4x16), qh_first16, reg_a, scale0);
)"
R"(
)"
R"(        sub_group_barrier(CLK_LOCAL_MEM_FENCE);
)"
R"(
)"
R"(        half16 acc;
)"
R"(        dotx16_reduce8(reg_a, shared_b, reg_c.lo, 0);
)"
R"(        dotx16_reduce8(reg_a, shared_b, reg_c.hi, 16);
)"
R"(
)"
R"(        // Second half
)"
R"(        uint half_step = step + TILESIZE_K;
)"
R"(        q_sub_offset = row + ((ne01 * half_step) >> 3) + ((expert_id * ne00 * ne01) >> 3);
)"
R"(        b_sub_offset = col * ne00 + half_step;
)"
R"(
)"
R"(        q4x16.x = read_imageui(src0_ql, q_sub_offset + sub_block_id_m).x;
)"
R"(        q4x16.y = read_imageui(src0_ql, q_sub_offset + sub_block_id_m + ne01).x;
)"
R"(
)"
R"(        bx8_f32.lo = read_imagef(src1, (b_sub_offset + b_global_offset.x) / 4);
)"
R"(        bx8_f32.hi = read_imagef(src1, (b_sub_offset + b_global_offset.y) / 4);
)"
R"(        bx8_f16 = convert_half8(bx8_f32);
)"
R"(        shared_b[b_local_offset.x] = bx8_f16.lo;
)"
R"(        shared_b[b_local_offset.y] = bx8_f16.hi;
)"
R"(
)"
R"(        dequantize_q6_k(as_ushort4(q4x16), qh_second16, reg_a, scale1);
)"
R"(
)"
R"(        sub_group_barrier(CLK_LOCAL_MEM_FENCE);
)"
R"(
)"
R"(        dotx16_reduce8(reg_a, shared_b, reg_c.lo, 0);
)"
R"(        dotx16_reduce8(reg_a, shared_b, reg_c.hi, 16);
)"
R"(    }
)"
R"(
)"
R"(    if ((get_global_id(0) + block_id_m * TILESIZE_M) >= ne01) {
)"
R"(        return;
)"
R"(    }
)"
R"(
)"
R"(    // Load post router and share in LM
)"
R"(    __local uint out_idx[TILESIZE_N];
)"
R"(
)"
R"(    if (get_local_id(0) < TILESIZE_N) {
)"
R"(        uint idx = src2[block_id_n * TILESIZE_N + get_local_id(0)];
)"
R"(        if (idx == 0xFFFFFFFF) {
)"
R"(            idx = src2[block_id_n * TILESIZE_N + 0];
)"
R"(        }
)"
R"(        out_idx[get_local_id(0)] = idx * ne01;
)"
R"(    }
)"
R"(
)"
R"(    barrier(CLK_LOCAL_MEM_FENCE);
)"
R"(
)"
R"(    // Scatter results back to original position in output grid
)"
R"(    uint m_offset = row + get_local_id(0);
)"
R"(
)"
R"(    write_imagef(dst, out_idx[1] + m_offset, (reg_c.s1));
)"
R"(    write_imagef(dst, out_idx[2] + m_offset, (reg_c.s2));
)"
R"(    write_imagef(dst, out_idx[3] + m_offset, (reg_c.s3));
)"
R"(    write_imagef(dst, out_idx[4] + m_offset, (reg_c.s4));
)"
R"(    write_imagef(dst, out_idx[5] + m_offset, (reg_c.s5));
)"
R"(    write_imagef(dst, out_idx[6] + m_offset, (reg_c.s6));
)"
R"(    write_imagef(dst, out_idx[7] + m_offset, (reg_c.s7));
)"
R"(    write_imagef(dst, out_idx[8] + m_offset, (reg_c.s8));
)"
R"(    write_imagef(dst, out_idx[9] + m_offset, (reg_c.s9));
)"
R"(    write_imagef(dst, out_idx[10] + m_offset, (reg_c.sa));
)"
R"(    write_imagef(dst, out_idx[11] + m_offset, (reg_c.sb));
)"
R"(    write_imagef(dst, out_idx[12] + m_offset, (reg_c.sc));
)"
R"(    write_imagef(dst, out_idx[13] + m_offset, (reg_c.sd));
)"
R"(    write_imagef(dst, out_idx[14] + m_offset, (reg_c.se));
)"
R"(    write_imagef(dst, out_idx[15] + m_offset, (reg_c.sf));
)"
R"(    write_imagef(dst, out_idx[16] + m_offset, (reg_c.sg));
)"
R"(    write_imagef(dst, out_idx[17] + m_offset, (reg_c.sh));
)"
R"(    write_imagef(dst, out_idx[18] + m_offset, (reg_c.si));
)"
R"(    write_imagef(dst, out_idx[19] + m_offset, (reg_c.sj));
)"
R"(    write_imagef(dst, out_idx[20] + m_offset, (reg_c.sk));
)"
R"(    write_imagef(dst, out_idx[21] + m_offset, (reg_c.sl));
)"
R"(    write_imagef(dst, out_idx[22] + m_offset, (reg_c.sm));
)"
R"(    write_imagef(dst, out_idx[23] + m_offset, (reg_c.sn));
)"
R"(    write_imagef(dst, out_idx[24] + m_offset, (reg_c.so));
)"
R"(    write_imagef(dst, out_idx[25] + m_offset, (reg_c.sp));
)"
R"(    write_imagef(dst, out_idx[26] + m_offset, (reg_c.sq));
)"
R"(    write_imagef(dst, out_idx[27] + m_offset, (reg_c.sr));
)"
R"(    write_imagef(dst, out_idx[28] + m_offset, (reg_c.ss));
)"
R"(    write_imagef(dst, out_idx[29] + m_offset, (reg_c.st));
)"
R"(    write_imagef(dst, out_idx[30] + m_offset, (reg_c.su));
)"
R"(    write_imagef(dst, out_idx[31] + m_offset, (reg_c.sv));
)"
R"(
)"
R"(    // Store zero padding parts to the index of first output in tile
)"
R"(    barrier(CLK_GLOBAL_MEM_FENCE);
)"
R"(    write_imagef(dst, out_idx[0] + m_offset, (reg_c.s0));
)"
R"(}
)"
