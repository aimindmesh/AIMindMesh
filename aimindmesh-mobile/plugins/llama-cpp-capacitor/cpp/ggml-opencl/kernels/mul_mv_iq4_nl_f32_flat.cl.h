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
R"(#define QK4_NL 32
)"
R"(
)"
R"(typedef char int8_t;
)"
R"(typedef uchar uint8_t;
)"
R"(typedef short int16_t;
)"
R"(typedef ushort uint16_t;
)"
R"(typedef int int32_t;
)"
R"(typedef uint uint32_t;
)"
R"(
)"
R"(constant float kvalues_iq4nl[16] = {
)"
R"(    -127.f, -104.f, -83.f, -65.f, -49.f, -35.f, -22.f, -10.f,
)"
R"(      1.f,   13.f,  25.f,  38.f,  53.f,  69.f,  89.f, 113.f
)"
R"(};
)"
R"(
)"
R"(//------------------------------------------------------------------------------
)"
R"(// block_iq4_nl
)"
R"(//------------------------------------------------------------------------------
)"
R"(struct block_iq4_nl
)"
R"({
)"
R"(    half d;
)"
R"(    uint8_t qs[QK4_NL / 2];
)"
R"(};
)"
R"(
)"
R"(// Compute dot product between half a block of iq4_nl quants and activations.
)"
R"(// x points to the quant bytes, dh points to the scale.
)"
R"(// yl has 16 activation values: [0..7] for low nibbles, [8..15] for high nibbles.
)"
R"(// il indicates offset into the quant bytes (0 or 8).
)"
R"(inline float block_iq4_nl_dot_y_flat(
)"
R"(        global uchar * x,
)"
R"(        global half  * dh,
)"
R"(        private float * yl,
)"
R"(        int il
)"
R"() {
)"
R"(    float d = *dh;
)"
R"(    global uchar * qs = x + il;
)"
R"(    float acc = 0.f;
)"
R"(    for (int i = 0; i < 8; ++i) {
)"
R"(        acc += yl[i]   * kvalues_iq4nl[qs[i] & 0x0F];
)"
R"(        acc += yl[i+8] * kvalues_iq4nl[qs[i] >> 4];
)"
R"(    }
)"
R"(    return d * acc;
)"
R"(}
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
R"(#define N_DST 8 // each subgroup works on 8 rows
)"
R"(#define N_SUBGROUP 1 // number of subgroups in a thread group
)"
R"(#define N_SUBGROUP_SIZE 16 // assuming subgroup size is 16
)"
R"(#elif defined (ADRENO_GPU)
)"
R"(#define N_DST 8
)"
R"(#define N_SUBGROUP 1
)"
R"(#define N_SUBGROUP_SIZE 64
)"
R"(#endif
)"
R"(
)"
R"(inline void mul_vec_q_n_f32_8x_flat(
)"
R"(        global uchar * src0_q,
)"
R"(        global half  * src0_d,
)"
R"(        global float * src1,
)"
R"(        global float * dst,
)"
R"(        int ne00,
)"
R"(        int ne01,
)"
R"(        int ne02,
)"
R"(        int ne10,
)"
R"(        int ne12,
)"
R"(        int ne0,
)"
R"(        int ne1,
)"
R"(        int r2,
)"
R"(        int r3
)"
R"() {
)"
R"(    const ulong nb = ne00/QK4_NL;
)"
R"(
)"
R"(    int r0 = get_group_id(0);
)"
R"(    int r1 = get_group_id(1);
)"
R"(    int im = get_group_id(2);
)"
R"(
)"
R"(    int first_row = (r0 * N_SUBGROUP + get_sub_group_id()) * N_DST;
)"
R"(
)"
R"(    int i12 = im%ne12;
)"
R"(    int i13 = im/ne12;
)"
R"(
)"
R"(    // The number of scales is the same as the number of blocks.
)"
R"(    ulong offset0_d = first_row * nb + (i12/r2)*(nb*ne01) + (i13/r3)*(nb*ne01*ne02);
)"
R"(    // Each block contains QK4_NL/2 uchars, hence offset for qs is as follows.
)"
R"(    ulong offset0_q = (first_row * nb + (i12/r2)*(nb*ne01) + (i13/r3)*(nb*ne01*ne02)) * QK4_NL/2;
)"
R"(
)"
R"(    global uchar * x = (global uchar *) src0_q + offset0_q;
)"
R"(    global half  * d = (global half  *) src0_d + offset0_d;
)"
R"(    global float * y = (global float *) src1   + r1*ne10 + im*ne00*ne1;
)"
R"(
)"
R"(    float yl[16];
)"
R"(    float8 sumf = 0.f;
)"
R"(
)"
R"(    int ix = get_sub_group_local_id()/2;
)"
R"(    int il = 8*(get_sub_group_local_id()%2);
)"
R"(
)"
R"(    global float * yb = y + ix*QK4_NL + il;
)"
R"(
)"
R"(    for (int ib = ix; ib < nb; ib += N_SUBGROUP_SIZE/2) {
)"
R"(        for (int i = 0; i < 8; ++i) {
)"
R"(            yl[i]   = yb[i];
)"
R"(            yl[i+8] = yb[i+16];
)"
R"(        }
)"
R"(
)"
R"(        sumf.s0 += block_iq4_nl_dot_y_flat(x + ib*QK4_NL/2 + 0*nb*QK4_NL/2, d + ib + 0*nb, yl, il);
)"
R"(        sumf.s1 += block_iq4_nl_dot_y_flat(x + ib*QK4_NL/2 + 1*nb*QK4_NL/2, d + ib + 1*nb, yl, il);
)"
R"(        sumf.s2 += block_iq4_nl_dot_y_flat(x + ib*QK4_NL/2 + 2*nb*QK4_NL/2, d + ib + 2*nb, yl, il);
)"
R"(        sumf.s3 += block_iq4_nl_dot_y_flat(x + ib*QK4_NL/2 + 3*nb*QK4_NL/2, d + ib + 3*nb, yl, il);
)"
R"(
)"
R"(        sumf.s4 += block_iq4_nl_dot_y_flat(x + ib*QK4_NL/2 + 4*nb*QK4_NL/2, d + ib + 4*nb, yl, il);
)"
R"(        sumf.s5 += block_iq4_nl_dot_y_flat(x + ib*QK4_NL/2 + 5*nb*QK4_NL/2, d + ib + 5*nb, yl, il);
)"
R"(        sumf.s6 += block_iq4_nl_dot_y_flat(x + ib*QK4_NL/2 + 6*nb*QK4_NL/2, d + ib + 6*nb, yl, il);
)"
R"(        sumf.s7 += block_iq4_nl_dot_y_flat(x + ib*QK4_NL/2 + 7*nb*QK4_NL/2, d + ib + 7*nb, yl, il);
)"
R"(
)"
R"(        yb += QK4_NL * (N_SUBGROUP_SIZE/2);
)"
R"(    }
)"
R"(
)"
R"(    float8 tot = (float8)(
)"
R"(        sub_group_reduce_add(sumf.s0), sub_group_reduce_add(sumf.s1),
)"
R"(        sub_group_reduce_add(sumf.s2), sub_group_reduce_add(sumf.s3),
)"
R"(        sub_group_reduce_add(sumf.s4), sub_group_reduce_add(sumf.s5),
)"
R"(        sub_group_reduce_add(sumf.s6), sub_group_reduce_add(sumf.s7)
)"
R"(    );
)"
R"(
)"
R"(    if (get_sub_group_local_id() == 0) {
)"
R"(        if (first_row + 0 < ne01) {
)"
R"(            dst[r1*ne0 + im*ne0*ne1 + first_row + 0] = tot.s0;
)"
R"(        }
)"
R"(        if (first_row + 1 < ne01) {
)"
R"(            dst[r1*ne0 + im*ne0*ne1 + first_row + 1] = tot.s1;
)"
R"(        }
)"
R"(        if (first_row + 2 < ne01) {
)"
R"(            dst[r1*ne0 + im*ne0*ne1 + first_row + 2] = tot.s2;
)"
R"(        }
)"
R"(        if (first_row + 3 < ne01) {
)"
R"(            dst[r1*ne0 + im*ne0*ne1 + first_row + 3] = tot.s3;
)"
R"(        }
)"
R"(
)"
R"(        if (first_row + 4 < ne01) {
)"
R"(            dst[r1*ne0 + im*ne0*ne1 + first_row + 4] = tot.s4;
)"
R"(        }
)"
R"(        if (first_row + 5 < ne01) {
)"
R"(            dst[r1*ne0 + im*ne0*ne1 + first_row + 5] = tot.s5;
)"
R"(        }
)"
R"(        if (first_row + 6 < ne01) {
)"
R"(            dst[r1*ne0 + im*ne0*ne1 + first_row + 6] = tot.s6;
)"
R"(        }
)"
R"(        if (first_row + 7 < ne01) {
)"
R"(            dst[r1*ne0 + im*ne0*ne1 + first_row + 7] = tot.s7;
)"
R"(        }
)"
R"(    }
)"
R"(}
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
R"(kernel void kernel_mul_mv_iq4_nl_f32_flat(
)"
R"(        global uchar * src0_q,
)"
R"(        global half  * src0_d,
)"
R"(        global float * src1,
)"
R"(        ulong offset1,
)"
R"(        global float * dst,
)"
R"(        ulong offsetd,
)"
R"(        int ne00,
)"
R"(        int ne01,
)"
R"(        int ne02,
)"
R"(        int ne10,
)"
R"(        int ne12,
)"
R"(        int ne0,
)"
R"(        int ne1,
)"
R"(        int r2,
)"
R"(        int r3
)"
R"() {
)"
R"(    src1 = (global float*)((global char*)src1 + offset1);
)"
R"(    dst = (global float*)((global char*)dst + offsetd);
)"
R"(
)"
R"(    mul_vec_q_n_f32_8x_flat(src0_q, src0_d, src1, dst, ne00, ne01, ne02, ne10, ne12, ne0, ne1, r2, r3);
)"
R"(}
)"
