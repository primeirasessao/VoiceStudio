import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { apiJson } from '@/lib/api/client';
import type { Mode } from './longform-session';

export interface Recovery {
  job_id: string;
  type: string;
  title: string;
  chapters_done: number;
  total_chapters: number;
}

/** The backend job type each page renders as (`_render_longform_sse(job_type=…)`). */
export const RECOVERY_JOB_TYPE: Record<Mode, string> = {
  stories: 'story',
  audiobook: 'audiobook',
};

export function recoveriesFor(mode: Mode, jobs: readonly Recovery[] | undefined): Recovery[] {
  return (jobs ?? []).filter((job) => job.type === RECOVERY_JOB_TYPE[mode]);
}

/**
 * Renders that stopped before finishing (the app reloaded or quit, or the user
 * pressed Stop), read from the backend's resume manifests, so a render lost
 * with the page is picked up again next to Generate instead of starting over.
 */
export function RenderRecovery({
  mode,
  active,
  disabled,
  onResume,
}: {
  mode: Mode;
  /** A render is running now; its own manifest is not an interrupted render. */
  active: boolean;
  disabled: boolean;
  onResume: (jobId: string) => void;
}) {
  const { t } = useTranslation();
  const query = useQuery({
    queryKey: ['longform-recovery'],
    queryFn: ({ signal }) => apiJson<{ jobs: Recovery[] }>('/audiobook/jobs', { signal }),
  });
  const { refetch } = query;
  useEffect(() => {
    if (!active) void refetch();
  }, [active, refetch]);
  const jobs = active ? [] : recoveriesFor(mode, query.data?.jobs);
  if (!jobs.length) return null;
  return (
    <div className="max-h-[24vh] shrink-0 space-y-2 overflow-y-auto">
      {jobs.map((job) => (
        <section
          key={job.job_id}
          aria-label={t('audiobook.recovery_title')}
          className="space-y-1 rounded-lg border border-border/60 bg-muted/20 p-2.5 text-xs"
        >
          <h2 className="font-medium">{t('audiobook.recovery_title')}</h2>
          <p className="truncate">
            {job.title || t(mode === 'stories' ? 'stories.untitled' : 'audiobook.untitled')}
          </p>
          <p className="text-muted-foreground">
            {t('audiobook.recovery_progress', {
              done: job.chapters_done,
              total: job.total_chapters,
            })}
          </p>
          <Button
            size="sm"
            variant="outline"
            className="w-full"
            disabled={disabled}
            onClick={() => onResume(job.job_id)}
          >
            {t('common.resume')}
          </Button>
        </section>
      ))}
    </div>
  );
}
