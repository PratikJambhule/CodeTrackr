import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { StandingsTower, type TowerRow } from './StandingsTower';
import { YearHeatmap } from './YearHeatmap';
import { RaceChart } from './RaceChart';
import { Bars } from './Bars';

describe('StandingsTower', () => {
  const rows: TowerRow[] = [
    { id: 'diya', name: 'Diya', value: '14h 30m', cells: ['best', 'coded', 'off'], summary: '14h 30m this week' },
    { id: 'you', name: 'Soham', value: '+30m', isMe: true, move: 2, cells: ['coded', 'pb', 'best'] },
    { id: 'rohan', name: 'Rohan', value: '+2h 00m', move: -1 },
  ];

  it('is an ordered list in rank order, readable without the visuals', () => {
    render(<StandingsTower rows={rows} label="Test standings" />);
    const list = screen.getByRole('list', { name: 'Test standings' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent('1st, Diya, 14h 30m this week');
    expect(items[1]).toHaveTextContent('2nd, Soham (you), +30m');
    expect(items[2]).toHaveTextContent('3rd, Rohan, +2h 00m');
  });

  it('marks movement and the signed-in row', () => {
    render(<StandingsTower rows={rows} />);
    expect(screen.getByText('▲2')).toBeInTheDocument();
    expect(screen.getByText('▼1')).toBeInTheDocument();
    expect(screen.getByText('you')).toBeInTheDocument();
  });

  it('keeps rows in place when re-rendered in a new order (FLIP does not need animate in jsdom)', () => {
    const { rerender } = render(<StandingsTower rows={rows} />);
    rerender(<StandingsTower rows={[rows[1], rows[0], rows[2]]} />);
    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('1st, Soham (you)');
  });
});

describe('YearHeatmap', () => {
  it('draws 53 weeks of 7 days and reads out a summary', () => {
    const { container } = render(<YearHeatmap days={[{ date: '2026-10-01', seconds: 3600 }]} today={new Date(2026, 9, 4)} summary="1 day coded in the last year" />);
    expect(screen.getByRole('img', { name: '1 day coded in the last year' })).toBeInTheDocument();
    expect(container.querySelectorAll('[role="img"] span').length).toBe(53 * 7);
    expect(screen.getByTitle('Thu 1 Oct: 1h 00m')).toBeInTheDocument();
  });
});

describe('RaceChart', () => {
  it('labels each line with its name and final total, and has a data table', () => {
    render(
      <RaceChart
        dates={['2026-09-28', '2026-09-29']}
        series={[
          { id: 'a', name: 'Diya', values: [3600, 1800] },
          { id: 'b', name: 'Soham', values: [1800, 1800], isMe: true },
        ]}
      />,
    );
    expect(screen.getByText(/Diya 1h30m/)).toBeInTheDocument();
    expect(screen.getByText(/Soham 1h00m/)).toBeInTheDocument();
    const table = screen.getByRole('table');
    expect(within(table).getByRole('rowheader', { name: 'Diya' })).toBeInTheDocument();
  });
});

describe('Bars', () => {
  it('turns bars into labelled buttons when they do something', () => {
    let picked = -1;
    render(
      <Bars
        label="Today"
        onSelect={(i) => (picked = i)}
        items={[
          { key: 'a', label: '00', value: 0, title: '00:00, no coding' },
          { key: 'b', label: '01', value: 600, title: '01:00, 10m' },
        ]}
      />,
    );
    screen.getByRole('button', { name: '01:00, 10m' }).click();
    expect(picked).toBe(1);
  });
});
