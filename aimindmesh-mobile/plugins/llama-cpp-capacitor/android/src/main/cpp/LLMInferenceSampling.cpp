/*
 * LLMInferenceSampling.cpp - Per-request sampling options and interrupt support for LLMInference
 * (kept apart from LLMInference.cpp so that file does not keep growing).
 */

#include "LLMInference.h"
#include "common/sampling.h"
#include <android/log.h>
#include <cmath>

#define TAG "[LLMInference-Sampling]"
#define LOGi(...) __android_log_print(ANDROID_LOG_INFO, TAG, __VA_ARGS__)
#define LOGe(...) __android_log_print(ANDROID_LOG_ERROR, TAG, __VA_ARGS__)

bool LLMInference::abortCallback(void* data) {
    auto* self = static_cast<LLMInference*>(data);
    return self != nullptr && self->_interrupted.load();
}

void LLMInference::setSamplingOverrides(float temperature, float topP, int nPredict) {
    _nPredict = nPredict > 0 ? nPredict : 0;
    if (!_model) return;

    const float temp = (temperature >= 0.0f && std::isfinite(temperature)) ? temperature : _defaultTemp;
    const float top_p = (topP > 0.0f && topP <= 1.0f) ? topP : _defaultTopP;
    if (_sampler && temp == _activeTemp && top_p == _activeTopP) {
        return;
    }

    common_params_sampling sparams;
    sparams.temp = temp;
    sparams.top_p = top_p;
    sparams.min_p = _minP;
    sparams.seed = LLAMA_DEFAULT_SEED;
    common_sampler* fresh = common_sampler_init(_model, sparams);
    if (!fresh) {
        LOGe("common_sampler_init failed; keeping the current sampler");
        return;
    }
    if (_sampler) {
        common_sampler_free(_sampler);
    }
    _sampler = fresh;
    _activeTemp = temp;
    _activeTopP = top_p;
    LOGi("Sampler set: temp=%.2f top_p=%.2f min_p=%.2f n_predict=%d", temp, top_p, _minP, _nPredict);
}
