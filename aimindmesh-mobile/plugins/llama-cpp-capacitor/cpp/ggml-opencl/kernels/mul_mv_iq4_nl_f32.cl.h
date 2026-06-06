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
R"(//------------------------------------------------------------------------------
)"
R"(// mul_vec_q_n_f32
)"
R"(//------------------------------------------------------------------------------
)"
R"(// Compute inner product between half a block of iq4_nl and 16 floats (yl).
)"
R"(// il indicates where the quants begin (0 or 8).
)"
R"(inline float block_iq4_nl_dot_y(
)"
R"(        global struct block_iq4_nl * qb_curr,
)"
R"(        private float * yl,
)"
R"(        int il
)"
R"() {
)"
R"(    float d = qb_curr->d;
)"
R"(    float acc = 0.f;
)"
R"(    global uchar * qs = qb_curr->qs + il;
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
R"(#ifdef INTEL_GPU
)"
R"(#define N_DST 4 // each subgroup group works on 4 rows
)"
R"(#define N_SUBGROUP 1 // number of subgroups in a thread group
)"
R"(#define N_SUBGROUP_SIZE 16 // assuming subgroup size is 16
)"
R"(#elif defined (ADRENO_GPU)
)"
R"(#define N_DST 4
)"
R"(#define N_SUBGROUP 1
)"
R"(#define N_SUBGROUP_SIZE 64
)"
R"(#endif
)"
R"(
)"
R"(inline void mul_vec_q_n_f32(
)"
R"(        global void * src0,
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
R"(
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
R"(    ulong offset0 = first_row * nb + (i12/r2)*(nb*ne01) + (i13/r3)*(nb*ne01*ne02);
)"
R"(
)"
R"(    global struct block_iq4_nl * x = (global struct block_iq4_nl *) src0 + offset0;
)"
R"(    global float               * y = (global float               *) src1 + r1*ne10 + im*ne00*ne1;
)"
R"(
)"
R"(    float yl[16];       // src1 vector cache
)"
R"(    float sumf[N_DST]={0.f};
)"
R"(
)"
R"(    int ix = get_sub_group_local_id()/2;
)"
R"(    int il = 8*(get_sub_group_local_id()%2);
)"
R"(
)"
R"(    global float * yb = y + ix * QK4_NL + il;
)"
R"(
)"
R"(    // each thread in a SIMD group deals with half a block.
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
R"(        for (int row = 0; row < N_DST; row++) {
)"
R"(            sumf[row] += block_iq4_nl_dot_y(x+ib+row*nb, yl, il);
)"
R"(        }
)"
R"(
)"
R"(        yb += QK4_NL * (N_SUBGROUP_SIZE/2);
)"
R"(    }
)"
R"(
)"
R"(    float tot[N_DST] = {
)"
R"(        sub_group_reduce_add(sumf[0]), sub_group_reduce_add(sumf[1]),
)"
R"(        sub_group_reduce_add(sumf[2]), sub_group_reduce_add(sumf[3])};
)"
R"(    for (int row = 0; row < N_DST; ++row) {
)"
R"(        if (get_sub_group_local_id() == 0 && first_row + row < ne01) {
)"
R"(            dst[r1*ne0 + im*ne0*ne1 + first_row + row] = tot[row];
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
R"(kernel void kernel_mul_mv_iq4_nl_f32(
)"
R"(        global void * src0,
)"
R"(        ulong offset0,
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
R"(    src0 = (global void*)((global char*)src0 + offset0);
)"
R"(    src1 = (global float*)((global char*)src1 + offset1);
)"
R"(    dst = (global float*)((global char*)dst + offsetd);
)"
R"(
)"
R"(    mul_vec_q_n_f32(src0, src1, dst, ne00, ne01, ne02, ne10, ne12, ne0, ne1, r2, r3);
)"
R"(}
)"
