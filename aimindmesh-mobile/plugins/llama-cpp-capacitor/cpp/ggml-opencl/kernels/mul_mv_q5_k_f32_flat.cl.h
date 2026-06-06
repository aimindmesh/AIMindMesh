R"(#pragma OPENCL EXTENSION cl_khr_fp16 : enable
)"
R"(
)"
R"(#ifdef cl_intel_subgroups
)"
R"(#pragma OPENCL EXTENSION cl_intel_subgroups : enable
)"
R"(#else
)"
R"(#pragma OPENCL EXTENSION cl_khr_subgroups : enable
)"
R"(#endif
)"
R"(
)"
R"(#ifdef cl_intel_required_subgroup_size
)"
R"(#pragma OPENCL EXTENSION cl_intel_required_subgroup_size : enable
)"
R"(#define INTEL_GPU 1
)"
R"(#define REQD_SUBGROUP_SIZE_16 __attribute__((intel_reqd_sub_group_size(16)))
)"
R"(#define REQD_SUBGROUP_SIZE_32 __attribute__((intel_reqd_sub_group_size(32)))
)"
R"(#elif defined(cl_qcom_reqd_sub_group_size)
)"
R"(#pragma OPENCL EXTENSION cl_qcom_reqd_sub_group_size : enable
)"
R"(#define ADRENO_GPU 1
)"
R"(#define REQD_SUBGROUP_SIZE_64  __attribute__((qcom_reqd_sub_group_size("half")))
)"
R"(#define REQD_SUBGROUP_SIZE_128 __attribute__((qcom_reqd_sub_group_size("full")))
)"
R"(#endif
)"
R"(
)"
R"(//------------------------------------------------------------------------------
)"
R"(// block_q5_K
)"
R"(//------------------------------------------------------------------------------
)"
R"(#define QK_K            256
)"
R"(#define BLOCK_Q5K_SIZE  176
)"
R"(#define K_SCALE_SIZE    12
)"
R"(
)"
R"(typedef struct {
)"
R"(    half  d;                    // super-block scale for quantized scales
)"
R"(    half  dmin;                 // super-block scale for quantized mins
)"
R"(    uchar scales[K_SCALE_SIZE]; // scales and mins, quantized with 6 bits
)"
R"(    uchar qh[QK_K/8];           // quants, high bit (1 bit per value, packed 8 per byte)
)"
R"(    uchar qs[QK_K/2];           // quants, low 4 bits (2 values per byte)
)"
R"(} block_q5_K;
)"
R"(
)"
R"(#undef N_DST
)"
R"(#undef N_SIMDGROUP
)"
R"(#undef N_SIMDWIDTH
)"
R"(
)"
R"(#ifdef INTEL_GPU
)"
R"(#define N_DST       4
)"
R"(#define N_SIMDGROUP 1
)"
R"(#define N_SIMDWIDTH 16
)"
R"(#elif defined(ADRENO_GPU)
)"
R"(#define N_DST       16
)"
R"(#define N_SIMDGROUP 2
)"
R"(#define N_SIMDWIDTH 64
)"
R"(#endif
)"
R"(
)"
R"(#undef  BLOCK_STRIDE
)"
R"(// number of (super) blocks each subgroup processes
)"
R"(// each thread in a subgroup processes a block (32 weights)
)"
R"(#define BLOCK_STRIDE (N_SIMDWIDTH/8)
)"
R"(
)"
R"(#ifdef INTEL_GPU
)"
R"(REQD_SUBGROUP_SIZE_16
)"
R"(#elif defined (ADRENO_GPU)
)"
R"(REQD_SUBGROUP_SIZE_64
)"
R"(#endif
)"
R"(kernel void kernel_mul_mv_q5_K_f32_flat(
)"
R"(    global uchar * src0_q,
)"
R"(    global uchar * src0_qh,
)"
R"(    global uchar * src0_s,
)"
R"(    global half  * src0_d,
)"
R"(    global half  * src0_dm,
)"
R"(    global char  * src1,
)"
R"(    int offset1,
)"
R"(    global char  * dst,
)"
R"(    int offsetd,
)"
R"(    int ne00,
)"
R"(    int ne01,
)"
R"(    ulong nb01,
)"
R"(    ulong nb02,
)"
R"(    ulong nb03,
)"
R"(    int ne12,
)"
R"(    ulong nb11,
)"
R"(    ulong nb12,
)"
R"(    ulong nb13,
)"
R"(    int ne0,
)"
R"(    int ne1,
)"
R"(    int r2,
)"
R"(    int r3
)"
R"() {
)"
R"(    src1 = src1 + offset1;
)"
R"(    dst  = dst  + offsetd;
)"
R"(
)"
R"(    ushort kmask1 = 0x3f3f;
)"
R"(    ushort kmask2 = 0x0f0f;
)"
R"(    ushort kmask3 = 0xc0c0;
)"
R"(
)"
R"(    int ix = get_sub_group_local_id()/8;
)"
R"(    int it = get_sub_group_local_id()%8;
)"
R"(    int iq = it/4;
)"
R"(    int ir = it%4;
)"
R"(
)"
R"(    int nb = ne00/QK_K;
)"
R"(
)"
R"(    int r0 = get_group_id(0);
)"
R"(    int r1 = get_group_id(1);
)"
R"(    int im = get_group_id(2);
)"
R"(    int first_row = (r0 * N_SIMDGROUP + get_sub_group_id()) * N_DST;
)"
R"(
)"
R"(    int i12 = im%ne12;
)"
R"(    int i13 = im/ne12;
)"
R"(
)"
R"(    int offset_src0 = (first_row*nb01 + (i12/r2)*nb02 + (i13/r3)*nb03)/BLOCK_Q5K_SIZE;
)"
R"(    uint blk = nb01 / BLOCK_Q5K_SIZE;
)"
R"(    global uchar * blk_q  = (global uchar *)src0_q  + offset_src0*(QK_K/2);
)"
R"(    global uchar * blk_qh = (global uchar *)src0_qh + offset_src0*(QK_K/8);
)"
R"(    global uchar * blk_s  = (global uchar *)src0_s  + offset_src0*K_SCALE_SIZE;
)"
R"(    global half  * blk_d  = (global half  *)src0_d  + offset_src0;
)"
R"(    global half  * blk_dm = (global half  *)src0_dm + offset_src0;
)"
R"(
)"
R"(    int offset_src1 = r1*nb11 + (i12)*nb12 + (i13)*nb13;
)"
R"(    global float * y = (global float *)(src1 + offset_src1);
)"
R"(
)"
R"(    float yl[16];
)"
R"(    float yh[16];
)"
R"(    float sumf[N_DST] = {0.f};
)"
R"(    float all_sum;
)"
R"(
)"
R"(    global float * y4 = y + ix * QK_K + 64 * iq + 8 * ir;
)"
R"(
)"
R"(    uchar u1_lo = (uchar)(1 << (2*iq));
)"
R"(    uchar u2_lo = (uchar)(2 << (2*iq));
)"
R"(    uchar u1_hi = (uchar)(1 << (2*iq + 4));
)"
R"(    uchar u2_hi = (uchar)(2 << (2*iq + 4));
)"
R"(
)"
R"(    ushort  sc16[4];
)"
R"(    uchar * sc8 = (uchar *)sc16;
)"
R"(
)"
R"(    for (int ib = ix; ib < nb; ib += BLOCK_STRIDE) {
)"
R"(        float4 sumy = {0.f, 0.f, 0.f, 0.f};
)"
R"(        for (int i = 0; i < 8; ++i) {
)"
R"(            yl[i+0] = y4[i+0];
)"
R"(            sumy.s0 += yl[i+0];
)"
R"(
)"
R"(            yl[i+8] = y4[i+32];
)"
R"(            sumy.s1 += yl[i+8];
)"
R"(
)"
R"(            yh[i+0] = y4[i+128];
)"
R"(            sumy.s2 += yh[i+0];
)"
R"(
)"
R"(            yh[i+8] = y4[i+160];
)"
R"(            sumy.s3 += yh[i+8];
)"
R"(        }
)"
R"(
)"
R"(        global ushort * q1 = (global ushort *)(blk_q  + ib * (QK_K/2)) + (16 * iq + 4 * ir);
)"
R"(        global uchar  * qh = (global uchar  *)(blk_qh + ib * (QK_K/8)) + 8 * ir;
)"
R"(        global ushort * sc = (global ushort *)(blk_s  + ib * K_SCALE_SIZE) + iq;
)"
R"(        global half   * d  = blk_d  + ib;
)"
R"(        global half   * dm = blk_dm + ib;
)"
R"(
)"
R"(        for (int row = 0; row < N_DST; row++) {
)"
R"(            sc16[0] = sc[0] & kmask1;
)"
R"(            sc16[1] = sc[2] & kmask1;
)"
R"(            sc16[2] = ((sc[4] >> 0) & kmask2) | ((sc[0] & kmask3) >> 2);
)"
R"(            sc16[3] = ((sc[4] >> 4) & kmask2) | ((sc[2] & kmask3) >> 2);
)"
R"(
)"
R"(            global ushort * q2 = q1 + 32;
)"
R"(
)"
R"(            float4 acc1 = {0.f, 0.f, 0.f, 0.f};
)"
R"(            float4 acc2 = {0.f, 0.f, 0.f, 0.f};
)"
R"(            for (int i = 0; i < 8; i += 2) {
)"
R"(                acc1.s0 += yl[i+0] * ((q1[i/2] & 0x000F) + (qh[i+0] & u1_lo ? 16.f       : 0.f));
)"
R"(                acc1.s1 += yl[i+1] * ((q1[i/2] & 0x0F00) + (qh[i+1] & u1_lo ? 16.f*256.f : 0.f));
)"
R"(                acc1.s2 += yl[i+8] * ((q1[i/2] & 0x00F0) + (qh[i+0] & u2_lo ? 16.f*16.f  : 0.f));
)"
R"(                acc1.s3 += yl[i+9] * ((q1[i/2] & 0xF000) + (qh[i+1] & u2_lo ? 16.f*4096.f: 0.f));
)"
R"(                acc2.s0 += yh[i+0] * ((q2[i/2] & 0x000F) + (qh[i+0] & u1_hi ? 16.f       : 0.f));
)"
R"(                acc2.s1 += yh[i+1] * ((q2[i/2] & 0x0F00) + (qh[i+1] & u1_hi ? 16.f*256.f : 0.f));
)"
R"(                acc2.s2 += yh[i+8] * ((q2[i/2] & 0x00F0) + (qh[i+0] & u2_hi ? 16.f*16.f  : 0.f));
)"
R"(                acc2.s3 += yh[i+9] * ((q2[i/2] & 0xF000) + (qh[i+1] & u2_hi ? 16.f*4096.f: 0.f));
)"
R"(            }
)"
R"(
)"
R"(            float dall = *d;
)"
R"(            float dmin = *dm;
)"
R"(            sumf[row] += dall * ((acc1.s0 + 1.f/256.f * acc1.s1) * sc8[0] +
)"
R"(                                 (acc1.s2 + 1.f/256.f * acc1.s3) * sc8[1] * 1.f/16.f +
)"
R"(                                 (acc2.s0 + 1.f/256.f * acc2.s1) * sc8[4] +
)"
R"(                                 (acc2.s2 + 1.f/256.f * acc2.s3) * sc8[5] * 1.f/16.f) -
)"
R"(                         dmin * (sumy.s0 * sc8[2] + sumy.s1 * sc8[3] + sumy.s2 * sc8[6] + sumy.s3 * sc8[7]);
)"
R"(
)"
R"(            q1 += blk*64;
)"
R"(            qh += blk*32;
)"
R"(            sc += blk*6;
)"
R"(            d  += blk;
)"
R"(            dm += blk;
)"
R"(        }
)"
R"(
)"
R"(        y4 += BLOCK_STRIDE * QK_K;
)"
R"(    }
)"
R"(
)"
R"(    global float * dst_f32 = (global float *) dst + im*ne0*ne1 + r1*ne0;
)"
R"(
)"
R"(    for (int row = 0; row < N_DST; ++row) {
)"
R"(        all_sum = sub_group_reduce_add(sumf[row]);
)"
R"(        if (first_row + row < ne01) {
)"
R"(            if (get_sub_group_local_id() == 0) {
)"
R"(                dst_f32[first_row + row] = all_sum;
)"
R"(            }
)"
R"(        }
)"
R"(    }
)"
R"(}
)"
