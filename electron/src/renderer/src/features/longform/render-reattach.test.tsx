import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/i18n';

const fetchMock = vi.hoisted(() => vi.fn());
const apiJsonMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api/client', () => ({ apiFetch: fetchMock, apiJson: apiJsonMock }));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, className }: { to: string; children: unknown; className?: string }) => (
    <a href={to} className={className}>
      {children as never}
    </a>
  ),
}));

import {
  editLongform,
  longformSession,
  renderLongform,
  stopLongform,
  useLongformSession,
} from './longform-session';
import { GeneratePanel } from './generate-panel';
import { RenderRecovery, recoveriesFor } from './render-recovery';
import { longformActivity } from '@/lib/longform-activity';

function Panel({ mode }: { mode: 'stories' | 'audiobook' }) {
  const session = useLongformSession();
  return (
    <GeneratePanel
      mode={mode}
      session={session}
      blocker={session.active && session.active !== mode ? 'busy' : null}
      onGenerate={vi.fn()}
      onStop={stopLongform}
    />
  );
}

/** A render that stays mid-book until the test stops it. */
function startHangingRender() {
  const encoder = new TextEncoder();
  fetchMock.mockImplementation(
    (_url: string, options: { signal: AbortSignal }) =>
      new Response(
        new ReadableStream({
          start(stream) {
            for (const event of [
              { type: 'started', job_id: 'job1', chapters: 4 },
              { type: 'chapter', index: 0, title: 'One', duration_s: 1 },
              { type: 'chapter', index: 1, title: 'Two', duration_s: 1 },
            ])
              stream.enqueue(encoder.encode('data: ' + JSON.stringify(event) + '\n\n'));
            options.signal.addEventListener('abort', () =>
              stream.error(new DOMException('Stopped', 'AbortError')),
            );
          },
        }),
      ),
  );
  editLongform('stories', {
    title: 'My tale',
    voice: 'v',
    lines: [{ id: 'a', text: 'Hello', profileId: null }],
  });
  return renderLongform('stories');
}

beforeEach(() => {
  fetchMock.mockReset();
  apiJsonMock.mockReset();
});
afterEach(() => {
  cleanup();
  stopLongform();
});

it('shows the live render again after its page unmounts and remounts', async () => {
  const running = startHangingRender();
  await waitFor(() => expect(longformSession.state.completed).toBe(2));
  const first = render(<Panel mode="stories" />);
  expect(screen.getByText('Chapter 3')).toBeVisible();
  first.unmount(); // the user opens Settings…
  render(<Panel mode="stories" />); // …and comes back
  expect(screen.getByText('Synthesizing 3 of 4 chapters')).toBeVisible();
  expect(screen.getByText('Two')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
  await running;
});

it('turns the other page refusal into the running render with Show progress and Stop', async () => {
  const running = startHangingRender();
  await waitFor(() => expect(longformSession.state.completed).toBe(2));
  expect(longformActivity.state).toMatchObject({
    mode: 'stories',
    title: 'My tale',
    completed: 2,
    total: 4,
    percent: 50,
  });
  render(<Panel mode="audiobook" />);
  expect(screen.getByText(/already rendering/i)).toBeVisible();
  expect(screen.getByRole('button', { name: 'Create audiobook' })).toBeDisabled();
  expect(screen.getByRole('link', { name: /Show progress/ })).toHaveAttribute('href', '/stories');
  expect(screen.getByText(/My tale/)).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
  await running;
  expect(longformSession.state.active).toBeNull();
  expect(longformSession.state.stopped).toBe(true);
  expect(longformActivity.state).toBeNull();
});

it('offers interrupted Stories renders, which the backend files as "story"', async () => {
  const jobs = [
    { job_id: 's1', type: 'story', title: 'Tale', chapters_done: 3, total_chapters: 8 },
    { job_id: 'a1', type: 'audiobook', title: 'Book', chapters_done: 1, total_chapters: 2 },
  ];
  expect(recoveriesFor('stories', jobs).map((job) => job.job_id)).toEqual(['s1']);
  expect(recoveriesFor('audiobook', jobs).map((job) => job.job_id)).toEqual(['a1']);

  apiJsonMock.mockResolvedValue({ jobs });
  const onResume = vi.fn();
  const view = render(
    <QueryClientProvider client={new QueryClient()}>
      <RenderRecovery mode="stories" active={false} disabled={false} onResume={onResume} />
    </QueryClientProvider>,
  );
  expect(await screen.findByText('Tale')).toBeVisible();
  expect(screen.queryByText('Book')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
  expect(onResume).toHaveBeenCalledWith('s1');
  // While a render runs its own manifest is not "interrupted".
  view.rerender(
    <QueryClientProvider client={new QueryClient()}>
      <RenderRecovery mode="stories" active disabled onResume={onResume} />
    </QueryClientProvider>,
  );
  expect(screen.queryByText('Tale')).toBeNull();
});
