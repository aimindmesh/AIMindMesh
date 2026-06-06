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
R"(
)"
R"(
)"
R"(#define dequantize_q5_1(qs5x16, qh5x16, a_f16, scale, m) \
)"
R"(    a_f16.s0 = (half)((( qs5x16.s0 & 0x000F)        | (( qh5x16.s0       & 0x01) << 4)) * scale + m); \
)"
R"(    a_f16.s1 = (half)((((qs5x16.s0 & 0x00F0) >> 4 ) | (((qh5x16.s0 >> 1) & 0x01) << 4)) * scale + m); \
)"
R"(    a_f16.s2 = (half)((((qs5x16.s0 & 0x0F00) >> 8 ) | (((qh5x16.s0 >> 2) & 0x01) << 4)) * scale + m); \
)"
R"(    a_f16.s3 = (half)((((qs5x16.s0 & 0xF000) >> 12) | (((qh5x16.s0 >> 3) & 0x01) << 4)) * scale + m); \
)"
R"(    a_f16.s4 = (half)((( qs5x16.s1 & 0x000F)        | (((qh5x16.s0 >> 4) & 0x01) << 4)) * scale + m); \
)"
R"(    a_f16.s5 = (half)((((qs5x16.s1 & 0x00F0) >> 4 ) | (((qh5x16.s0 >> 5) & 0x01) << 4)) * scale + m); \
)"
R"(    a_f16.s6 = (half)((((qs5x16.s1 & 0x0F00) >> 8 ) | (((qh5x16.s0 >> 6) & 0x01) << 4)) * scale + m); \
)"
R"(    a_f16.s7 = (half)((((qs5x16.s1 & 0xF000) >> 12) | (((qh5x16.s0 >> 7) & 0x01) << 4)) * scale + m); \
)"
R"(    a_f16.s8 = (half)((( qs5x16.s2 & 0x000F)        | (( qh5x16.s1       & 0x01) << 4)) * scale + m); \
)"
R"(    a_f16.s9 = (half)((((qs5x16.s2 & 0x00F0) >> 4 ) | (((qh5x16.s1 >> 1) & 0x01) << 4)) * scale + m); \
)"
R"(    a_f16.sa = (half)((((qs5x16.s2 & 0x0F00) >> 8 ) | (((qh5x16.s1 >> 2) & 0x01) << 4)) * scale + m); \
)"
R"(    a_f16.sb = (half)((((qs5x16.s2 & 0xF000) >> 12) | (((qh5x16.s1 >> 3) & 0x01) << 4)) * scale + m); \
)"
R"(    a_f16.sc = (half)((( qs5x16.s3 & 0x000F)        | (((qh5x16.s1 >> 4) & 0x01) << 4)) * scale + m); \
)"
R"(    a_f16.sd = (half)((((qs5x16.s3 & 0x00F0) >> 4 ) | (((qh5x16.s1 >> 5) & 0x01) << 4)) * scale + m); \
)"
R"(    a_f16.se = (half)((((qs5x16.s3 & 0x0F00) >> 8 ) | (((qh5x16.s1 >> 6) & 0x01) << 4)) * scale + m); \
)"
R"(    a_f16.sf = (half)((((qs5x16.s3 & 0xF000) >> 12) | (((qh5x16.s1 >> 7) & 0x01) << 4)) * scale + m); \
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
R"(__attribute__((qcom_wave_pair_mode(1))) // 1=force single 2=force pair
)"
R"(kernel void kernel_gemm_moe_q5_1_f32_ns(
)"
R"(        __read_only  image1d_buffer_t src0_qs,
)"
R"(        __global     uint *           src0_qh,
)"
R"(        __global     half *           src0_d,
)"
R"(        __global     half *           src0_m,
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
R"(    // Loop along K axis, 32 elements (one block) for each iteration, divided into 2 sub-blocks
)"
R"(    for (uint step = 0; step < ne00; step += TILESIZE_K * 2) {
)"
R"(        // First sub-block
)"
R"(        uint q_sub_offset = row + ((ne01 * step) >> 3) + ((expert_id * ne00 * ne01) >> 3);
)"
R"(        uint s_sub_offset = row + ((ne01 * step) >> 5) + ((expert_id * ne00 * ne01) >> 5);
)"
R"(        uint b_sub_offset = col * ne00 + step;
)"
R"(
)"
R"(        // Load scale and m for current Q5_1 block
)"
R"(        uint blk_offset = s_sub_offset + get_global_id(0);
)"
R"(        half s = src0_d[blk_offset];
)"
R"(        half m = src0_m[blk_offset];
)"
R"(
)"
R"(        // Load 32 qh (5-th bit of each Q5) for the entire block
)"
R"(        uchar4 qhx32 = as_uchar4(src0_qh[blk_offset]);
)"
R"(
)"
R"(        // Load 16 qs (half block) in transposed layout
)"
R"(        uint2 qsx16;
)"
R"(        qsx16.x = read_imageui(src0_qs, q_sub_offset + sub_block_id_m).x;
)"
R"(        qsx16.y = read_imageui(src0_qs, q_sub_offset + sub_block_id_m + ne01).x;
)"
R"(
)"
R"(        // Load 16x32 floats from matrix B, each fiber out of 64 in a sub-group loads 8 elements
)"
R"(        float8 bx8_f32;
)"
R"(        bx8_f32.lo = read_imagef(src1, (b_sub_offset + b_global_offset.x) / 4);
)"
R"(        bx8_f32.hi = read_imagef(src1, (b_sub_offset + b_global_offset.y) / 4);
)"
R"(        // Convert to half and store to LM to share within the subgroup
)"
R"(        half8 bx8_f16 = convert_half8(bx8_f32);
)"
R"(        shared_b[b_local_offset.x] = bx8_f16.lo;
)"
R"(        shared_b[b_local_offset.y] = bx8_f16.hi;
)"
R"(
)"
R"(        // Dequantization
)"
R"(        dequantize_q5_1(as_ushort4(qsx16), qhx32.lo, reg_a, s, m);
)"
R"(
)"
R"(        sub_group_barrier(CLK_LOCAL_MEM_FENCE);
)"
R"(
)"
R"(        // 32 16x16 fp16 dot product with 8 elements reduction for better precision
)"
R"(        half16 acc;
)"
R"(        dotx16_reduce8(reg_a, shared_b, reg_c.lo, 0);
)"
R"(        dotx16_reduce8(reg_a, shared_b, reg_c.hi, 16);
)"
R"(
)"
R"(        // Repeat for second sub-block
)"
R"(        uint half_step = step + TILESIZE_K;
)"
R"(        q_sub_offset = row + ((ne01 * half_step) >> 3) + ((expert_id * ne00 * ne01) >> 3);
)"
R"(        b_sub_offset = col * ne00 + half_step;
)"
R"(
)"
R"(        // Load next 16 qs in transposed layout
)"
R"(        qsx16.x = read_imageui(src0_qs, q_sub_offset + sub_block_id_m).x;
)"
R"(        qsx16.y = read_imageui(src0_qs, q_sub_offset + sub_block_id_m + ne01).x;
)"
R"(
)"
R"(        // Load 16x32 floats from matrix B, each fiber out of 64 in a sub-group loads 8 elements
)"
R"(        bx8_f32.lo = read_imagef(src1, (b_sub_offset + b_global_offset.x) / 4);
)"
R"(        bx8_f32.hi = read_imagef(src1, (b_sub_offset + b_global_offset.y) / 4);
)"
R"(        // Convert to half and store to LM to share within the subgroup
)"
R"(        bx8_f16 = convert_half8(bx8_f32);
)"
R"(        shared_b[b_local_offset.x] = bx8_f16.lo;
)"
R"(        shared_b[b_local_offset.y] = bx8_f16.hi;
)"
R"(
)"
R"(        // Dequantization
)"
R"(        dequantize_q5_1(as_ushort4(qsx16), qhx32.hi, reg_a, s, m);
)"
R"(
)"
R"(        sub_group_barrier(CLK_LOCAL_MEM_FENCE);
)"
R"(
)"
R"(        // 32 16x16 fp16 dot product with 3-levels reduction for better precision
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
R"(    // Load poster router and share in LM
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
R"(    // Store zero padding parts to the index of first output in tile, override correct result in the end
)"
R"(    barrier(CLK_GLOBAL_MEM_FENCE);
)"
R"(    write_imagef(dst, out_idx[0] + m_offset, (reg_c.s0));
)"
R"(}
)"
