// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Sidebar from './Sidebar';

describe('<Sidebar>', () => {
  const baseCounts = { snapPending: 0, closet: 113, outfits: 8, wearLogs: 47 };

  it('renders all 5 tabs', () => {
    render(<Sidebar activeTab="snap" onSelect={() => {}} counts={baseCounts} />);
    expect(screen.getByText('Snap')).toBeInTheDocument();
    expect(screen.getByText('My Closet')).toBeInTheDocument();
    expect(screen.getByText('Spreadsheet')).toBeInTheDocument();
    expect(screen.getByText('AI Stylist')).toBeInTheDocument();
    expect(screen.getByText('Metrics')).toBeInTheDocument();
  });

  it('shows count badges for tabs with non-zero counts', () => {
    render(<Sidebar activeTab="snap" onSelect={() => {}} counts={baseCounts} />);
    // closet = 113
    expect(screen.getByText('113')).toBeInTheDocument();
    // metrics = 47
    expect(screen.getByText('47')).toBeInTheDocument();
  });

  it('omits count badge when count is 0', () => {
    render(<Sidebar activeTab="snap" onSelect={() => {}} counts={{ ...baseCounts, snapPending: 0 }} />);
    // snapPending = 0 → no badge should appear next to "Snap"
    const snapButton = screen.getByText('Snap').closest('button');
    // The button contains: the SVG icon, the "Snap" label, and (no count badge).
    // No span with rounded-full class (the badge style) should exist in this button.
    const badge = snapButton?.querySelector('span.rounded-full');
    expect(badge).toBeNull();
  });

  it('highlights the active tab', () => {
    render(<Sidebar activeTab="closet" onSelect={() => {}} counts={baseCounts} />);
    const closetBtn = screen.getByText('My Closet').closest('button');
    expect(closetBtn?.className).toMatch(/bg-\[var\(--accent-terracotta\)\]/);
  });

  it('calls onSelect with the new tab when clicked', async () => {
    const onSelect = vi.fn();
    render(<Sidebar activeTab="snap" onSelect={onSelect} counts={baseCounts} />);
    await userEvent.click(screen.getByText('AI Stylist'));
    expect(onSelect).toHaveBeenCalledWith('stylist');
  });
});