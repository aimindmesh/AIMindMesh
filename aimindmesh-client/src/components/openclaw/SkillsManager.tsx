import React, { useEffect } from 'react';
import { agentApi } from '../../services/serverApi';
import { useOpenClawStore } from '../../store/openclawStore';

const TRIGGER_COLORS: Record<string, string> = {
  explicit: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
  cron: 'bg-amber-500/10 text-amber-500 border-amber-500/20',
  webhook: 'bg-purple-500/10 text-purple-500 border-purple-500/20',
};

export const SkillsManager: React.FC = () => {
  const { skills, setSkills } = useOpenClawStore();

  useEffect(() => {
    const fetchSkills = async () => {
      try {
        const { data } = await agentApi.listSkills();
        setSkills(data.skills);
      } catch (e) {
        console.error('Failed to fetch skills', e);
      }
    };
    fetchSkills();
  }, [setSkills]);

  return (
    <div className="flex flex-col gap-6 animate-in fade-in duration-500">
      <div className="flex justify-between items-end border-b border-border pb-4">
        <div>
          <h3 className="text-xl font-bold tracking-tight">Agent Capabilities</h3>
          <p className="text-sm text-muted-foreground mt-1">Modular skills currently installed in the sidecar volume.</p>
        </div>
        <div className="px-3 py-1 bg-surface-2 rounded-lg border border-border text-xs font-mono">
          {skills.length} Loaded
        </div>
      </div>

      {skills.length === 0 && (
        <div className="flex flex-col items-center justify-center p-12 border-2 border-dashed border-border rounded-xl opacity-50">
          <p className="text-sm">No skill manifests found in the agent's volume.</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {skills.map((skill) => (
          <div
            key={skill.name}
            className="group relative rounded-xl p-5 bg-surface border border-border hover:border-primary/40 hover:shadow-xl hover:shadow-primary/5 transition-all duration-300 flex flex-col gap-4"
          >
            <div className="flex justify-between items-start">
              <div className="font-bold text-base group-hover:text-primary transition-colors">{skill.name}</div>
              <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold border ${TRIGGER_COLORS[skill.trigger] ?? 'bg-muted text-muted-foreground'}`}>
                {skill.trigger}
              </span>
            </div>
            
            <p className="text-sm text-muted-foreground leading-relaxed flex-1">
              {skill.description}
            </p>
            
            <div className="flex items-center justify-between mt-2 pt-3 border-t border-border/50">
              <span className="text-[10px] font-mono text-faint uppercase">Version {skill.version}</span>
              <button className="text-[10px] font-bold text-primary hover:underline uppercase tracking-widest">
                Manifest Details
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
