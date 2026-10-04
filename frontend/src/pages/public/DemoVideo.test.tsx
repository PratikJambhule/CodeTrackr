import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DemoVideo } from './DemoVideo';

afterEach(() => vi.restoreAllMocks());

describe('DemoVideo', () => {
  it('downloads nothing until someone presses play, then plays with controls', () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    const { container } = render(<DemoVideo />);
    expect(container.querySelector('video')).toBeNull();
    expect(container.querySelector('img')?.getAttribute('loading')).toBe('lazy');

    fireEvent.click(screen.getByRole('button', { name: /play the one-minute demo/i }));
    const video = container.querySelector('video')!;
    expect(video).not.toBeNull();
    expect(video.getAttribute('src')).toBe('/demo/codetrackr-1min.mp4');
    expect(video.hasAttribute('controls')).toBe(true);
    expect(play).toHaveBeenCalled();
  });
});
