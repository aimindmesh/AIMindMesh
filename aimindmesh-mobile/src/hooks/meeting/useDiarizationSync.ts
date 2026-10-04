import { useEffect } from 'react';
import { SpeakerDiarization } from '../../services/speaker/speakerDiarization';
import { MeetingSettingsState } from './useMeetingSettings';

/** Keeps the live speaker recognizer in step with the speaker settings. */
export function useDiarizationSync(
    diarizationRef: React.MutableRefObject<SpeakerDiarization>,
    settings: MeetingSettingsState
) {
    useEffect(() => {
        diarizationRef.current.setSimilarityThreshold(settings.diarizationSensitivity);
    }, [diarizationRef, settings.diarizationSensitivity]);

    useEffect(() => {
        diarizationRef.current.setMinTimeBetweenSwitches(settings.temporalSmoothing);
    }, [diarizationRef, settings.temporalSmoothing]);

    useEffect(() => {
        diarizationRef.current.setEmbeddingThreshold(settings.embeddingThreshold);
    }, [diarizationRef, settings.embeddingThreshold]);

    useEffect(() => {
        diarizationRef.current.setRejectionThreshold(settings.embeddingRejectionThreshold);
    }, [diarizationRef, settings.embeddingRejectionThreshold]);

    useEffect(() => {
        diarizationRef.current.setAdaptationRate(settings.embeddingAdaptationRate);
    }, [diarizationRef, settings.embeddingAdaptationRate]);

    useEffect(() => {
        diarizationRef.current.setMinEmbeddingMagnitude(settings.minEmbeddingMagnitude);
    }, [diarizationRef, settings.minEmbeddingMagnitude]);
}
