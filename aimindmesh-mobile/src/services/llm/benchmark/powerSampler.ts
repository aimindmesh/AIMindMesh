import { SystemMonitor } from '../../performance/systemMonitorPlugin';
import type { PowerReading } from './benchmarkMath';

/**
 * Battery power every `intervalMs` until stop(). On devices or platforms without the reading
 * the list stays empty (the benchmark then reports speed only).
 */
export function startPowerSampling(intervalMs = 250): { stop: () => PowerReading[] } {
    const samples: PowerReading[] = [];
    let busy = false;
    const take = async () => {
        if (busy) return;
        busy = true;
        try {
            const s = await SystemMonitor.getPowerSample();
            samples.push({ t: s.timestamp || Date.now(), powerMw: s.powerMw, charging: s.charging });
        } catch {
            // Not available (web, desktop)
        } finally {
            busy = false;
        }
    };
    void take();
    const timer = setInterval(() => { void take(); }, intervalMs);
    return {
        stop: () => {
            clearInterval(timer);
            return samples.slice();
        },
    };
}

export async function samplePowerFor(ms: number, intervalMs = 250): Promise<PowerReading[]> {
    const sampler = startPowerSampling(intervalMs);
    await new Promise(resolve => setTimeout(resolve, ms));
    return sampler.stop();
}
