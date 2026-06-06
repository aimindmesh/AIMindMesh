import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { logger } from './logger';

/**
 * Triggers haptic feedback on native devices.
 * @param style - The intensity of the feedback. Defaults to 'LIGHT'.
 */
export const triggerHaptic = (style: 'LIGHT' | 'MEDIUM' | 'HEAVY' = 'LIGHT') => {
  if (Capacitor.isNativePlatform()) {
    // Map the string literal to the corresponding enum member to satisfy the API's type requirement.
    const impactStyle = style === 'HEAVY' ? ImpactStyle.Heavy : style === 'MEDIUM' ? ImpactStyle.Medium : ImpactStyle.Light;
    Haptics.impact({ style: impactStyle }).catch((err: any) => {
      logger.log('warn', 'Haptic feedback failed', err);
    });
  }
};