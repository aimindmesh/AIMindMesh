R"(#pragma OPENCL EXTENSION cl_khr_fp16 : enable
)"
R"(#pragma OPENCL EXTENSION cl_khr_subgroups : enable
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
R"(#define NSUBGROUPS 4
)"
R"(#define SUBGROUP_SIZE 64
)"
R"(
)"
R"(#define dequantize_block_acc_bcast_8_hi(total_sum, bits4, bits2, scale_d, scale_s, y) \
)"
R"(    float8 shared_y; \
)"
R"(    shared_y = sub_group_broadcast(y, 0); \
)"
R"(    total_sum.s0 += ((float)(((bits4.s0 & 0x000F)      ) | ((bits2.s0 & 0x03) << 4)) - 32.f) * scale_s.s0 * scale_d.s0 * shared_y.s0; \
)"
R"(    total_sum.s0 += ((float)(((bits4.s0 & 0x00F0) >>  4) | ((bits2.s0 & 0x0C) << 2)) - 32.f) * scale_s.s0 * scale_d.s0 * shared_y.s1; \
)"
R"(    total_sum.s0 += ((float)(((bits4.s0 & 0x0F00) >>  8) | ((bits2.s0 & 0x30)     )) - 32.f) * scale_s.s0 * scale_d.s0 * shared_y.s2; \
)"
R"(    total_sum.s0 += ((float)(((bits4.s0 & 0xF000) >> 12) | ((bits2.s0 & 0xC0) >> 2)) - 32.f) * scale_s.s0 * scale_d.s0 * shared_y.s3; \
)"
R"(    total_sum.s0 += ((float)(((bits4.s2 & 0x000F)      ) | ((bits2.s2 & 0x03) << 4)) - 32.f) * scale_s.s0 * scale_d.s0 * shared_y.s4; \
)"
R"(    total_sum.s0 += ((float)(((bits4.s2 & 0x00F0) >>  4) | ((bits2.s2 & 0x0C) << 2)) - 32.f) * scale_s.s0 * scale_d.s0 * shared_y.s5; \
)"
R"(    total_sum.s0 += ((float)(((bits4.s2 & 0x0F00) >>  8) | ((bits2.s2 & 0x30)     )) - 32.f) * scale_s.s0 * scale_d.s0 * shared_y.s6; \
)"
R"(    total_sum.s0 += ((float)(((bits4.s2 & 0xF000) >> 12) | ((bits2.s2 & 0xC0) >> 2)) - 32.f) * scale_s.s0 * scale_d.s0 * shared_y.s7; \
)"
R"(    total_sum.s1 += ((float)(((bits4.s1 & 0x000F)      ) | ((bits2.s1 & 0x03) << 4)) - 32.f) * scale_s.s2 * scale_d.s1 * shared_y.s0; \
)"
R"(    total_sum.s1 += ((float)(((bits4.s1 & 0x00F0) >>  4) | ((bits2.s1 & 0x0C) << 2)) - 32.f) * scale_s.s2 * scale_d.s1 * shared_y.s1; \
)"
R"(    total_sum.s1 += ((float)(((bits4.s1 & 0x0F00) >>  8) | ((bits2.s1 & 0x30)     )) - 32.f) * scale_s.s2 * scale_d.s1 * shared_y.s2; \
)"
R"(    total_sum.s1 += ((float)(((bits4.s1 & 0xF000) >> 12) | ((bits2.s1 & 0xC0) >> 2)) - 32.f) * scale_s.s2 * scale_d.s1 * shared_y.s3; \
)"
R"(    total_sum.s1 += ((float)(((bits4.s3 & 0x000F)      ) | ((bits2.s3 & 0x03) << 4)) - 32.f) * scale_s.s2 * scale_d.s1 * shared_y.s4; \
)"
R"(    total_sum.s1 += ((float)(((bits4.s3 & 0x00F0) >>  4) | ((bits2.s3 & 0x0C) << 2)) - 32.f) * scale_s.s2 * scale_d.s1 * shared_y.s5; \
)"
R"(    total_sum.s1 += ((float)(((bits4.s3 & 0x0F00) >>  8) | ((bits2.s3 & 0x30)     )) - 32.f) * scale_s.s2 * scale_d.s1 * shared_y.s6; \
)"
R"(    total_sum.s1 += ((float)(((bits4.s3 & 0xF000) >> 12) | ((bits2.s3 & 0xC0) >> 2)) - 32.f) * scale_s.s2 * scale_d.s1 * shared_y.s7; \
)"
R"(    shared_y = sub_group_broadcast(y, 1); \
)"
R"(    total_sum.s0 += ((float)(((bits4.s4 & 0x000F)      ) | ((bits2.s4 & 0x03) << 4)) - 32.f) * scale_s.s0 * scale_d.s0 * shared_y.s0; \
)"
R"(    total_sum.s0 += ((float)(((bits4.s4 & 0x00F0) >>  4) | ((bits2.s4 & 0x0C) << 2)) - 32.f) * scale_s.s0 * scale_d.s0 * shared_y.s1; \
)"
R"(    total_sum.s0 += ((float)(((bits4.s4 & 0x0F00) >>  8) | ((bits2.s4 & 0x30)     )) - 32.f) * scale_s.s0 * scale_d.s0 * shared_y.s2; \
)"
R"(    total_sum.s0 += ((float)(((bits4.s4 & 0xF000) >> 12) | ((bits2.s4 & 0xC0) >> 2)) - 32.f) * scale_s.s0 * scale_d.s0 * shared_y.s3; \
)"
R"(    total_sum.s0 += ((float)(((bits4.s6 & 0x000F)      ) | ((bits2.s6 & 0x03) << 4)) - 32.f) * scale_s.s0 * scale_d.s0 * shared_y.s4; \
)"
R"(    total_sum.s0 += ((float)(((bits4.s6 & 0x00F0) >>  4) | ((bits2.s6 & 0x0C) << 2)) - 32.f) * scale_s.s0 * scale_d.s0 * shared_y.s5; \
)"
R"(    total_sum.s0 += ((float)(((bits4.s6 & 0x0F00) >>  8) | ((bits2.s6 & 0x30)     )) - 32.f) * scale_s.s0 * scale_d.s0 * shared_y.s6; \
)"
R"(    total_sum.s0 += ((float)(((bits4.s6 & 0xF000) >> 12) | ((bits2.s6 & 0xC0) >> 2)) - 32.f) * scale_s.s0 * scale_d.s0 * shared_y.s7; \
)"
R"(    total_sum.s1 += ((float)(((bits4.s5 & 0x000F)      ) | ((bits2.s5 & 0x03) << 4)) - 32.f) * scale_s.s2 * scale_d.s1 * shared_y.s0; \
)"
R"(    total_sum.s1 += ((float)(((bits4.s5 & 0x00F0) >>  4) | ((bits2.s5 & 0x0C) << 2)) - 32.f) * scale_s.s2 * scale_d.s1 * shared_y.s1; \
)"
R"(    total_sum.s1 += ((float)(((bits4.s5 & 0x0F00) >>  8) | ((bits2.s5 & 0x30)     )) - 32.f) * scale_s.s2 * scale_d.s1 * shared_y.s2; \
)"
R"(    total_sum.s1 += ((float)(((bits4.s5 & 0xF000) >> 12) | ((bits2.s5 & 0xC0) >> 2)) - 32.f) * scale_s.s2 * scale_d.s1 * shared_y.s3; \
)"
R"(    total_sum.s1 += ((float)(((bits4.s7 & 0x000F)      ) | ((bits2.s7 & 0x03) << 4)) - 32.f) * scale_s.s2 * scale_d.s1 * shared_y.s4; \
)"
R"(    total_sum.s1 += ((float)(((bits4.s7 & 0x00F0) >>  4) | ((bits2.s7 & 0x0C) << 2)) - 32.f) * scale_s.s2 * scale_d.s1 * shared_y.s5; \
)"
R"(    total_sum.s1 += ((float)(((bits4.s7 & 0x0F00) >>  8) | ((bits2.s7 & 0x30)     )) - 32.f) * scale_s.s2 * scale_d.s1 * shared_y.s6; \
)"
R"(    total_sum.s1 += ((float)(((bits4.s7 & 0xF000) >> 12) | ((bits2.s7 & 0xC0) >> 2)) - 32.f) * scale_s.s2 * scale_d.s1 * shared_y.s7; \
)"
R"(
)"
R"(#define dequantize_block_acc_bcast_8_lo(total_sum, bits4, bits2, scale_d, scale_s, y) \
)"
R"(    shared_y = sub_group_broadcast(y, 2); \
)"
R"(    total_sum.s0 += ((float)(((bits4.s0 & 0x000F)      ) | ((bits2.s0 & 0x03) << 4)) - 32.f) * scale_s.s1 * scale_d.s0 * shared_y.s0; \
)"
R"(    total_sum.s0 += ((float)(((bits4.s0 & 0x00F0) >>  4) | ((bits2.s0 & 0x0C) << 2)) - 32.f) * scale_s.s1 * scale_d.s0 * shared_y.s1; \
)"
R"(    total_sum.s0 += ((float)(((bits4.s0 & 0x0F00) >>  8) | ((bits2.s0 & 0x30)     )) - 32.f) * scale_s.s1 * scale_d.s0 * shared_y.s2; \
)"
R"(    total_sum.s0 += ((float)(((bits4.s0 & 0xF000) >> 12) | ((bits2.s0 & 0xC0) >> 2)) - 32.f) * scale_s.s1 * scale_d.s0 * shared_y.s3; \
)"
R"(    total_sum.s0 += ((float)(((bits4.s2 & 0x000F)      ) | ((bits2.s2 & 0x03) << 4)) - 32.f) * scale_s.s1 * scale_d.s0 * shared_y.s4; \
)"
R"(    total_sum.s0 += ((float)(((bits4.s2 & 0x00F0) >>  4) | ((bits2.s2 & 0x0C) << 2)) - 32.f) * scale_s.s1 * scale_d.s0 * shared_y.s5; \
)"
R"(    total_sum.s0 += ((float)(((bits4.s2 & 0x0F00) >>  8) | ((bits2.s2 & 0x30)     )) - 32.f) * scale_s.s1 * scale_d.s0 * shared_y.s6; \
)"
R"(    total_sum.s0 += ((float)(((bits4.s2 & 0xF000) >> 12) | ((bits2.s2 & 0xC0) >> 2)) - 32.f) * scale_s.s1 * scale_d.s0 * shared_y.s7; \
)"
R"(    total_sum.s1 += ((float)(((bits4.s1 & 0x000F)      ) | ((bits2.s1 & 0x03) << 4)) - 32.f) * scale_s.s3 * scale_d.s1 * shared_y.s0; \
)"
R"(    total_sum.s1 += ((float)(((bits4.s1 & 0x00F0) >>  4) | ((bits2.s1 & 0x0C) << 2)) - 32.f) * scale_s.s3 * scale_d.s1 * shared_y.s1; \
)"
R"(    total_sum.s1 += ((float)(((bits4.s1 & 0x0F00) >>  8) | ((bits2.s1 & 0x30)     )) - 32.f) * scale_s.s3 * scale_d.s1 * shared_y.s2; \
)"
R"(    total_sum.s1 += ((float)(((bits4.s1 & 0xF000) >> 12) | ((bits2.s1 & 0xC0) >> 2)) - 32.f) * scale_s.s3 * scale_d.s1 * shared_y.s3; \
)"
R"(    total_sum.s1 += ((float)(((bits4.s3 & 0x000F)      ) | ((bits2.s3 & 0x03) << 4)) - 32.f) * scale_s.s3 * scale_d.s1 * shared_y.s4; \
)"
R"(    total_sum.s1 += ((float)(((bits4.s3 & 0x00F0) >>  4) | ((bits2.s3 & 0x0C) << 2)) - 32.f) * scale_s.s3 * scale_d.s1 * shared_y.s5; \
)"
R"(    total_sum.s1 += ((float)(((bits4.s3 & 0x0F00) >>  8) | ((bits2.s3 & 0x30)     )) - 32.f) * scale_s.s3 * scale_d.s1 * shared_y.s6; \
)"
R"(    total_sum.s1 += ((float)(((bits4.s3 & 0xF000) >> 12) | ((bits2.s3 & 0xC0) >> 2)) - 32.f) * scale_s.s3 * scale_d.s1 * shared_y.s7; \
)"
R"(    shared_y = sub_group_broadcast(y, 3); \
)"
R"(    total_sum.s0 += ((float)(((bits4.s4 & 0x000F)      ) | ((bits2.s4 & 0x03) << 4)) - 32.f) * scale_s.s1 * scale_d.s0 * shared_y.s0; \
)"
R"(    total_sum.s0 += ((float)(((bits4.s4 & 0x00F0) >>  4) | ((bits2.s4 & 0x0C) << 2)) - 32.f) * scale_s.s1 * scale_d.s0 * shared_y.s1; \
)"
R"(    total_sum.s0 += ((float)(((bits4.s4 & 0x0F00) >>  8) | ((bits2.s4 & 0x30)     )) - 32.f) * scale_s.s1 * scale_d.s0 * shared_y.s2; \
)"
R"(    total_sum.s0 += ((float)(((bits4.s4 & 0xF000) >> 12) | ((bits2.s4 & 0xC0) >> 2)) - 32.f) * scale_s.s1 * scale_d.s0 * shared_y.s3; \
)"
R"(    total_sum.s0 += ((float)(((bits4.s6 & 0x000F)      ) | ((bits2.s6 & 0x03) << 4)) - 32.f) * scale_s.s1 * scale_d.s0 * shared_y.s4; \
)"
R"(    total_sum.s0 += ((float)(((bits4.s6 & 0x00F0) >>  4) | ((bits2.s6 & 0x0C) << 2)) - 32.f) * scale_s.s1 * scale_d.s0 * shared_y.s5; \
)"
R"(    total_sum.s0 += ((float)(((bits4.s6 & 0x0F00) >>  8) | ((bits2.s6 & 0x30)     )) - 32.f) * scale_s.s1 * scale_d.s0 * shared_y.s6; \
)"
R"(    total_sum.s0 += ((float)(((bits4.s6 & 0xF000) >> 12) | ((bits2.s6 & 0xC0) >> 2)) - 32.f) * scale_s.s1 * scale_d.s0 * shared_y.s7; \
)"
R"(    total_sum.s1 += ((float)(((bits4.s5 & 0x000F)      ) | ((bits2.s5 & 0x03) << 4)) - 32.f) * scale_s.s3 * scale_d.s1 * shared_y.s0; \
)"
R"(    total_sum.s1 += ((float)(((bits4.s5 & 0x00F0) >>  4) | ((bits2.s5 & 0x0C) << 2)) - 32.f) * scale_s.s3 * scale_d.s1 * shared_y.s1; \
)"
R"(    total_sum.s1 += ((float)(((bits4.s5 & 0x0F00) >>  8) | ((bits2.s5 & 0x30)     )) - 32.f) * scale_s.s3 * scale_d.s1 * shared_y.s2; \
)"
R"(    total_sum.s1 += ((float)(((bits4.s5 & 0xF000) >> 12) | ((bits2.s5 & 0xC0) >> 2)) - 32.f) * scale_s.s3 * scale_d.s1 * shared_y.s3; \
)"
R"(    total_sum.s1 += ((float)(((bits4.s7 & 0x000F)      ) | ((bits2.s7 & 0x03) << 4)) - 32.f) * scale_s.s3 * scale_d.s1 * shared_y.s4; \
)"
R"(    total_sum.s1 += ((float)(((bits4.s7 & 0x00F0) >>  4) | ((bits2.s7 & 0x0C) << 2)) - 32.f) * scale_s.s3 * scale_d.s1 * shared_y.s5; \
)"
R"(    total_sum.s1 += ((float)(((bits4.s7 & 0x0F00) >>  8) | ((bits2.s7 & 0x30)     )) - 32.f) * scale_s.s3 * scale_d.s1 * shared_y.s6; \
)"
R"(    total_sum.s1 += ((float)(((bits4.s7 & 0xF000) >> 12) | ((bits2.s7 & 0xC0) >> 2)) - 32.f) * scale_s.s3 * scale_d.s1 * shared_y.s7; \
)"
R"(
)"
R"(#define dequantize_block_acc_bcast_1_hi(total_sum, bits4, bits2, scale_d, scale_s, y) \
)"
R"(    float shared_y; \
)"
R"(    shared_y = sub_group_broadcast(y.s0, 0); \
)"
R"(    total_sum.s0 += ((float)(((bits4.s0 & 0x000F)      ) | ((bits2.s0 & 0x03) << 4)) - 32.f) * scale_s.s0 * scale_d.s0 * shared_y; \
)"
R"(    total_sum.s1 += ((float)(((bits4.s1 & 0x000F)      ) | ((bits2.s1 & 0x03) << 4)) - 32.f) * scale_s.s2 * scale_d.s1 * shared_y; \
)"
R"(    shared_y = sub_group_broadcast(y.s1, 0); \
)"
R"(    total_sum.s0 += ((float)(((bits4.s0 & 0x00F0) >>  4) | ((bits2.s0 & 0x0C) << 2)) - 32.f) * scale_s.s0 * scale_d.s0 * shared_y; \
)"
R"(    total_sum.s1 += ((float)(((bits4.s1 & 0x00F0) >>  4) | ((bits2.s1 & 0x0C) << 2)) - 32.f) * scale_s.s2 * scale_d.s1 * shared_y; \
)"
R"(    shared_y = sub_group_broadcast(y.s2, 0); \
)"
R"(    total_sum.s0 += ((float)(((bits4.s0 & 0x0F00) >>  8) | ((bits2.s0 & 0x30)     )) - 32.f) * scale_s.s0 * scale_d.s0 * shared_y; \
)"
R"(    total_sum.s1 += ((float)(((bits4.s1 & 0x0F00) >>  8) | ((bits2.s1 & 0x30)     )) - 32.f) * scale_s.s2 * scale_d.s1 * shared_y; \
)"
R"(    shared_y = sub_group_broadcast(y.s3, 0); \
)"
R"(    total_sum.s0 += ((float)(((bits4.s0 & 0xF000) >> 12) | ((bits2.s0 & 0xC0) >> 2)) - 32.f) * scale_s.s0 * scale_d.s0 * shared_y; \
)"
R"(    total_sum.s1 += ((float)(((bits4.s1 & 0xF000) >> 12) | ((bits2.s1 & 0xC0) >> 2)) - 32.f) * scale_s.s2 * scale_d.s1 * shared_y; \
)"
R"(    shared_y = sub_group_broadcast(y.s4, 0); \
)"
R"(    total_sum.s0 += ((float)(((bits4.s2 & 0x000F)      ) | ((bits2.s2 & 0x03) << 4)) - 32.f) * scale_s.s0 * scale_d.s0 * shared_y; \
)"
R"(    total_sum.s1 += ((float)(((bits4.s3 & 0x000F)      ) | ((bits2.s3 & 0x03) << 4)) - 32.f) * scale_s.s2 * scale_d.s1 * shared_y; \
)"
R"(    shared_y = sub_group_broadcast(y.s5, 0); \
)"
R"(    total_sum.s0 += ((float)(((bits4.s2 & 0x00F0) >>  4) | ((bits2.s2 & 0x0C) << 2)) - 32.f) * scale_s.s0 * scale_d.s0 * shared_y; \
)"
R"(    total_sum.s1 += ((float)(((bits4.s3 & 0x00F0) >>  4) | ((bits2.s3 & 0x0C) << 2)) - 32.f) * scale_s.s2 * scale_d.s1 * shared_y; \
)"
R"(    shared_y = sub_group_broadcast(y.s6, 0); \
)"
R"(    total_sum.s0 += ((float)(((bits4.s2 & 0x0F00) >>  8) | ((bits2.s2 & 0x30)     )) - 32.f) * scale_s.s0 * scale_d.s0 * shared_y; \
)"
R"(    total_sum.s1 += ((float)(((bits4.s3 & 0x0F00) >>  8) | ((bits2.s3 & 0x30)     )) - 32.f) * scale_s.s2 * scale_d.s1 * shared_y; \
)"
R"(    shared_y = sub_group_broadcast(y.s7, 0); \
)"
R"(    total_sum.s0 += ((float)(((bits4.s2 & 0xF000) >> 12) | ((bits2.s2 & 0xC0) >> 2)) - 32.f) * scale_s.s0 * scale_d.s0 * shared_y; \
)"
R"(    total_sum.s1 += ((float)(((bits4.s3 & 0xF000) >> 12) | ((bits2.s3 & 0xC0) >> 2)) - 32.f) * scale_s.s2 * scale_d.s1 * shared_y; \
)"
R"(    shared_y = sub_group_broadcast(y.s0, 1); \
)"
R"(    total_sum.s0 += ((float)(((bits4.s4 & 0x000F)      ) | ((bits2.s4 & 0x03) << 4)) - 32.f) * scale_s.s0 * scale_d.s0 * shared_y; \
)"
R"(    total_sum.s1 += ((float)(((bits4.s5 & 0x000F)      ) | ((bits2.s5 & 0x03) << 4)) - 32.f) * scale_s.s2 * scale_d.s1 * shared_y; \
)"
R"(    shared_y = sub_group_broadcast(y.s1, 1); \
)"
R"(    total_sum.s0 += ((float)(((bits4.s4 & 0x00F0) >>  4) | ((bits2.s4 & 0x0C) << 2)) - 32.f) * scale_s.s0 * scale_d.s0 * shared_y; \
)"
R"(    total_sum.s1 += ((float)(((bits4.s5 & 0x00F0) >>  4) | ((bits2.s5 & 0x0C) << 2)) - 32.f) * scale_s.s2 * scale_d.s1 * shared_y; \
)"
R"(    shared_y = sub_group_broadcast(y.s2, 1); \
)"
R"(    total_sum.s0 += ((float)(((bits4.s4 & 0x0F00) >>  8) | ((bits2.s4 & 0x30)     )) - 32.f) * scale_s.s0 * scale_d.s0 * shared_y; \
)"
R"(    total_sum.s1 += ((float)(((bits4.s5 & 0x0F00) >>  8) | ((bits2.s5 & 0x30)     )) - 32.f) * scale_s.s2 * scale_d.s1 * shared_y; \
)"
R"(    shared_y = sub_group_broadcast(y.s3, 1); \
)"
R"(    total_sum.s0 += ((float)(((bits4.s4 & 0xF000) >> 12) | ((bits2.s4 & 0xC0) >> 2)) - 32.f) * scale_s.s0 * scale_d.s0 * shared_y; \
)"
R"(    total_sum.s1 += ((float)(((bits4.s5 & 0xF000) >> 12) | ((bits2.s5 & 0xC0) >> 2)) - 32.f) * scale_s.s2 * scale_d.s1 * shared_y; \
)"
R"(    shared_y = sub_group_broadcast(y.s4, 1); \
)"
R"(    total_sum.s0 += ((float)(((bits4.s6 & 0x000F)      ) | ((bits2.s6 & 0x03) << 4)) - 32.f) * scale_s.s0 * scale_d.s0 * shared_y; \
)"
R"(    total_sum.s1 += ((float)(((bits4.s7 & 0x000F)      ) | ((bits2.s7 & 0x03) << 4)) - 32.f) * scale_s.s2 * scale_d.s1 * shared_y; \
)"
R"(    shared_y = sub_group_broadcast(y.s5, 1); \
)"
R"(    total_sum.s0 += ((float)(((bits4.s6 & 0x00F0) >>  4) | ((bits2.s6 & 0x0C) << 2)) - 32.f) * scale_s.s0 * scale_d.s0 * shared_y; \
)"
R"(    total_sum.s1 += ((float)(((bits4.s7 & 0x00F0) >>  4) | ((bits2.s7 & 0x0C) << 2)) - 32.f) * scale_s.s2 * scale_d.s1 * shared_y; \
)"
R"(    shared_y = sub_group_broadcast(y.s6, 1); \
)"
R"(    total_sum.s0 += ((float)(((bits4.s6 & 0x0F00) >>  8) | ((bits2.s6 & 0x30)     )) - 32.f) * scale_s.s0 * scale_d.s0 * shared_y; \
)"
R"(    total_sum.s1 += ((float)(((bits4.s7 & 0x0F00) >>  8) | ((bits2.s7 & 0x30)     )) - 32.f) * scale_s.s2 * scale_d.s1 * shared_y; \
)"
R"(    shared_y = sub_group_broadcast(y.s7, 1); \
)"
R"(    total_sum.s0 += ((float)(((bits4.s6 & 0xF000) >> 12) | ((bits2.s6 & 0xC0) >> 2)) - 32.f) * scale_s.s0 * scale_d.s0 * shared_y; \
)"
R"(    total_sum.s1 += ((float)(((bits4.s7 & 0xF000) >> 12) | ((bits2.s7 & 0xC0) >> 2)) - 32.f) * scale_s.s2 * scale_d.s1 * shared_y; \
)"
R"(
)"
R"(#define dequantize_block_acc_bcast_1_lo(total_sum, bits4, bits2, scale_d, scale_s, y) \
)"
R"(    shared_y = sub_group_broadcast(y.s0, 2); \
)"
R"(    total_sum.s0 += ((float)(((bits4.s0 & 0x000F)      ) | ((bits2.s0 & 0x03) << 4)) - 32.f) * scale_s.s1 * scale_d.s0 * shared_y; \
)"
R"(    total_sum.s1 += ((float)(((bits4.s1 & 0x000F)      ) | ((bits2.s1 & 0x03) << 4)) - 32.f) * scale_s.s3 * scale_d.s1 * shared_y; \
)"
R"(    shared_y = sub_group_broadcast(y.s1, 2); \
)"
R"(    total_sum.s0 += ((float)(((bits4.s0 & 0x00F0) >>  4) | ((bits2.s0 & 0x0C) << 2)) - 32.f) * scale_s.s1 * scale_d.s0 * shared_y; \
)"
R"(    total_sum.s1 += ((float)(((bits4.s1 & 0x00F0) >>  4) | ((bits2.s1 & 0x0C) << 2)) - 32.f) * scale_s.s3 * scale_d.s1 * shared_y; \
)"
R"(    shared_y = sub_group_broadcast(y.s2, 2); \
)"
R"(    total_sum.s0 += ((float)(((bits4.s0 & 0x0F00) >>  8) | ((bits2.s0 & 0x30)     )) - 32.f) * scale_s.s1 * scale_d.s0 * shared_y; \
)"
R"(    total_sum.s1 += ((float)(((bits4.s1 & 0x0F00) >>  8) | ((bits2.s1 & 0x30)     )) - 32.f) * scale_s.s3 * scale_d.s1 * shared_y; \
)"
R"(    shared_y = sub_group_broadcast(y.s3, 2); \
)"
R"(    total_sum.s0 += ((float)(((bits4.s0 & 0xF000) >> 12) | ((bits2.s0 & 0xC0) >> 2)) - 32.f) * scale_s.s1 * scale_d.s0 * shared_y; \
)"
R"(    total_sum.s1 += ((float)(((bits4.s1 & 0xF000) >> 12) | ((bits2.s1 & 0xC0) >> 2)) - 32.f) * scale_s.s3 * scale_d.s1 * shared_y; \
)"
R"(    shared_y = sub_group_broadcast(y.s4, 2); \
)"
R"(    total_sum.s0 += ((float)(((bits4.s2 & 0x000F)      ) | ((bits2.s2 & 0x03) << 4)) - 32.f) * scale_s.s1 * scale_d.s0 * shared_y; \
)"
R"(    total_sum.s1 += ((float)(((bits4.s3 & 0x000F)      ) | ((bits2.s3 & 0x03) << 4)) - 32.f) * scale_s.s3 * scale_d.s1 * shared_y; \
)"
R"(    shared_y = sub_group_broadcast(y.s5, 2); \
)"
R"(    total_sum.s0 += ((float)(((bits4.s2 & 0x00F0) >>  4) | ((bits2.s2 & 0x0C) << 2)) - 32.f) * scale_s.s1 * scale_d.s0 * shared_y; \
)"
R"(    total_sum.s1 += ((float)(((bits4.s3 & 0x00F0) >>  4) | ((bits2.s3 & 0x0C) << 2)) - 32.f) * scale_s.s3 * scale_d.s1 * shared_y; \
)"
R"(    shared_y = sub_group_broadcast(y.s6, 2); \
)"
R"(    total_sum.s0 += ((float)(((bits4.s2 & 0x0F00) >>  8) | ((bits2.s2 & 0x30)     )) - 32.f) * scale_s.s1 * scale_d.s0 * shared_y; \
)"
R"(    total_sum.s1 += ((float)(((bits4.s3 & 0x0F00) >>  8) | ((bits2.s3 & 0x30)     )) - 32.f) * scale_s.s3 * scale_d.s1 * shared_y; \
)"
R"(    shared_y = sub_group_broadcast(y.s7, 2); \
)"
R"(    total_sum.s0 += ((float)(((bits4.s2 & 0xF000) >> 12) | ((bits2.s2 & 0xC0) >> 2)) - 32.f) * scale_s.s1 * scale_d.s0 * shared_y; \
)"
R"(    total_sum.s1 += ((float)(((bits4.s3 & 0xF000) >> 12) | ((bits2.s3 & 0xC0) >> 2)) - 32.f) * scale_s.s3 * scale_d.s1 * shared_y; \
)"
R"(    shared_y = sub_group_broadcast(y.s0, 3); \
)"
R"(    total_sum.s0 += ((float)(((bits4.s4 & 0x000F)      ) | ((bits2.s4 & 0x03) << 4)) - 32.f) * scale_s.s1 * scale_d.s0 * shared_y; \
)"
R"(    total_sum.s1 += ((float)(((bits4.s5 & 0x000F)      ) | ((bits2.s5 & 0x03) << 4)) - 32.f) * scale_s.s3 * scale_d.s1 * shared_y; \
)"
R"(    shared_y = sub_group_broadcast(y.s1, 3); \
)"
R"(    total_sum.s0 += ((float)(((bits4.s4 & 0x00F0) >>  4) | ((bits2.s4 & 0x0C) << 2)) - 32.f) * scale_s.s1 * scale_d.s0 * shared_y; \
)"
R"(    total_sum.s1 += ((float)(((bits4.s5 & 0x00F0) >>  4) | ((bits2.s5 & 0x0C) << 2)) - 32.f) * scale_s.s3 * scale_d.s1 * shared_y; \
)"
R"(    shared_y = sub_group_broadcast(y.s2, 3); \
)"
R"(    total_sum.s0 += ((float)(((bits4.s4 & 0x0F00) >>  8) | ((bits2.s4 & 0x30)     )) - 32.f) * scale_s.s1 * scale_d.s0 * shared_y; \
)"
R"(    total_sum.s1 += ((float)(((bits4.s5 & 0x0F00) >>  8) | ((bits2.s5 & 0x30)     )) - 32.f) * scale_s.s3 * scale_d.s1 * shared_y; \
)"
R"(    shared_y = sub_group_broadcast(y.s3, 3); \
)"
R"(    total_sum.s0 += ((float)(((bits4.s4 & 0xF000) >> 12) | ((bits2.s4 & 0xC0) >> 2)) - 32.f) * scale_s.s1 * scale_d.s0 * shared_y; \
)"
R"(    total_sum.s1 += ((float)(((bits4.s5 & 0xF000) >> 12) | ((bits2.s5 & 0xC0) >> 2)) - 32.f) * scale_s.s3 * scale_d.s1 * shared_y; \
)"
R"(    shared_y = sub_group_broadcast(y.s4, 3); \
)"
R"(    total_sum.s0 += ((float)(((bits4.s6 & 0x000F)      ) | ((bits2.s6 & 0x03) << 4)) - 32.f) * scale_s.s1 * scale_d.s0 * shared_y; \
)"
R"(    total_sum.s1 += ((float)(((bits4.s7 & 0x000F)      ) | ((bits2.s7 & 0x03) << 4)) - 32.f) * scale_s.s3 * scale_d.s1 * shared_y; \
)"
R"(    shared_y = sub_group_broadcast(y.s5, 3); \
)"
R"(    total_sum.s0 += ((float)(((bits4.s6 & 0x00F0) >>  4) | ((bits2.s6 & 0x0C) << 2)) - 32.f) * scale_s.s1 * scale_d.s0 * shared_y; \
)"
R"(    total_sum.s1 += ((float)(((bits4.s7 & 0x00F0) >>  4) | ((bits2.s7 & 0x0C) << 2)) - 32.f) * scale_s.s3 * scale_d.s1 * shared_y; \
)"
R"(    shared_y = sub_group_broadcast(y.s6, 3); \
)"
R"(    total_sum.s0 += ((float)(((bits4.s6 & 0x0F00) >>  8) | ((bits2.s6 & 0x30)     )) - 32.f) * scale_s.s1 * scale_d.s0 * shared_y; \
)"
R"(    total_sum.s1 += ((float)(((bits4.s7 & 0x0F00) >>  8) | ((bits2.s7 & 0x30)     )) - 32.f) * scale_s.s3 * scale_d.s1 * shared_y; \
)"
R"(    shared_y = sub_group_broadcast(y.s7, 3); \
)"
R"(    total_sum.s0 += ((float)(((bits4.s6 & 0xF000) >> 12) | ((bits2.s6 & 0xC0) >> 2)) - 32.f) * scale_s.s1 * scale_d.s0 * shared_y; \
)"
R"(    total_sum.s1 += ((float)(((bits4.s7 & 0xF000) >> 12) | ((bits2.s7 & 0xC0) >> 2)) - 32.f) * scale_s.s3 * scale_d.s1 * shared_y; \
)"
R"(
)"
R"(#if defined(ADRENO_GPU)
)"
R"(REQD_SUBGROUP_SIZE_64
)"
R"(#endif
)"
R"(kernel void kernel_gemv_noshuffle_q6_K_f32(
)"
R"(    read_only image1d_buffer_t src0_ql,
)"
R"(    read_only image1d_buffer_t src0_qh,
)"
R"(    global half2 * src0_s,
)"
R"(    global half2 * src0_d,
)"
R"(    read_only image1d_buffer_t src1,
)"
R"(    global float * dst,
)"
R"(    ulong offsetd,
)"
R"(    int ne00,
)"
R"(    int ne01
)"
R"() {
)"
R"(    int grp = get_local_id(1);
)"
R"(    int gid = get_global_id(0);
)"
R"(    ushort slid = get_sub_group_local_id();
)"
R"(
)"
R"(    int nb = ne00 / 32;
)"
R"(
)"
R"(    uint4    reg_a_l;
)"
R"(    ushort4  reg_a_h;
)"
R"(    half2    reg_d;
)"
R"(    char4    reg_s;
)"
R"(    float8   reg_b;
)"
R"(
)"
R"(    float2  total_sum = 0.0f;
)"
R"(
)"
R"(    int line_stride_a = ne01 / 2;
)"
R"(    int block_stride_a = NSUBGROUPS * ne01;
)"
R"(
)"
R"(    for (int k = grp; k < nb; k += NSUBGROUPS) {
)"
R"(        reg_d = src0_d[gid + k/8 * line_stride_a];
)"
R"(        reg_s = as_char4(src0_s[gid + k * line_stride_a]);
)"
R"(
)"
R"(        if (slid < 4) {
)"
R"(            reg_b.s0123 = read_imagef(src1, 0 + slid*2 + k*8);
)"
R"(            reg_b.s4567 = read_imagef(src1, 1 + slid*2 + k*8);
)"
R"(        }
)"
R"(
)"
R"(        reg_a_l.s0 = read_imageui(src0_ql, gid + k*block_stride_a + line_stride_a*0).x;
)"
R"(        reg_a_l.s1 = read_imageui(src0_ql, gid + k*block_stride_a + line_stride_a*1).x;
)"
R"(        reg_a_l.s2 = read_imageui(src0_ql, gid + k*block_stride_a + line_stride_a*2).x;
)"
R"(        reg_a_l.s3 = read_imageui(src0_ql, gid + k*block_stride_a + line_stride_a*3).x;
)"
R"(
)"
R"(        reg_a_h.s0 = as_ushort(read_imageh(src0_qh, gid + k*block_stride_a + line_stride_a*0).x);
)"
R"(        reg_a_h.s1 = as_ushort(read_imageh(src0_qh, gid + k*block_stride_a + line_stride_a*1).x);
)"
R"(        reg_a_h.s2 = as_ushort(read_imageh(src0_qh, gid + k*block_stride_a + line_stride_a*2).x);
)"
R"(        reg_a_h.s3 = as_ushort(read_imageh(src0_qh, gid + k*block_stride_a + line_stride_a*3).x);
)"
R"(
)"
R"(#ifdef VECTOR_SUB_GROUP_BROADCAT
)"
R"(        dequantize_block_acc_bcast_8_hi(total_sum, as_ushort8(reg_a_l), as_uchar8(reg_a_h), reg_d, reg_s, reg_b);
)"
R"(#else
)"
R"(        dequantize_block_acc_bcast_1_hi(total_sum, as_ushort8(reg_a_l), as_uchar8(reg_a_h), reg_d, reg_s, reg_b);
)"
R"(#endif // VECTOR_SUB_GROUP_BROADCAT
)"
R"(
)"
R"(        reg_a_l.s0 = read_imageui(src0_ql, gid + k*block_stride_a + line_stride_a*4).x;
)"
R"(        reg_a_l.s1 = read_imageui(src0_ql, gid + k*block_stride_a + line_stride_a*5).x;
)"
R"(        reg_a_l.s2 = read_imageui(src0_ql, gid + k*block_stride_a + line_stride_a*6).x;
)"
R"(        reg_a_l.s3 = read_imageui(src0_ql, gid + k*block_stride_a + line_stride_a*7).x;
)"
R"(
)"
R"(        reg_a_h.s0 = as_ushort(read_imageh(src0_qh, gid + k*block_stride_a + line_stride_a*4).x);
)"
R"(        reg_a_h.s1 = as_ushort(read_imageh(src0_qh, gid + k*block_stride_a + line_stride_a*5).x);
)"
R"(        reg_a_h.s2 = as_ushort(read_imageh(src0_qh, gid + k*block_stride_a + line_stride_a*6).x);
)"
R"(        reg_a_h.s3 = as_ushort(read_imageh(src0_qh, gid + k*block_stride_a + line_stride_a*7).x);
)"
R"(
)"
R"(#ifdef VECTOR_SUB_GROUP_BROADCAT
)"
R"(        dequantize_block_acc_bcast_8_lo(total_sum, as_ushort8(reg_a_l), as_uchar8(reg_a_h), reg_d, reg_s, reg_b);
)"
R"(#else
)"
R"(        dequantize_block_acc_bcast_1_lo(total_sum, as_ushort8(reg_a_l), as_uchar8(reg_a_h), reg_d, reg_s, reg_b);
)"
R"(#endif // VECTOR_SUB_GROUP_BROADCAT
)"
R"(    }
)"
R"(
)"
R"(    local float2 reduce_lm[SUBGROUP_SIZE * 3];
)"
R"(    if (grp == 1) {
)"
R"(        reduce_lm[SUBGROUP_SIZE*0 + slid] = total_sum;
)"
R"(    }
)"
R"(    if (grp == 2) {
)"
R"(        reduce_lm[SUBGROUP_SIZE*1 + slid] = total_sum;
)"
R"(    }
)"
R"(    if (grp == 3) {
)"
R"(        reduce_lm[SUBGROUP_SIZE*2 + slid] = total_sum;
)"
R"(    }
)"
R"(
)"
R"(    barrier(CLK_LOCAL_MEM_FENCE);
)"
R"(
)"
R"(    if (grp == 0) {
)"
R"(        total_sum += reduce_lm[SUBGROUP_SIZE*0 + slid];
)"
R"(    }
)"
R"(    if (grp == 0) {
)"
R"(        total_sum += reduce_lm[SUBGROUP_SIZE*1 + slid];
)"
R"(    }
)"
R"(    if (grp == 0) {
)"
R"(        total_sum += reduce_lm[SUBGROUP_SIZE*2 + slid];
)"
R"(    }
)"
R"(
)"
R"(    if (grp == 0) {
)"
R"(        dst = (global float*)((global char*)dst + offsetd);
)"
R"(        vstore2(total_sum, 0, &(dst[gid * 2]));
)"
R"(    }
)"
R"(}
)"
