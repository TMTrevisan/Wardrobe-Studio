// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import EmptyState from './EmptyState';
import LoadingSkeleton from './LoadingSkeleton';
import PageHeader from './PageHeader';

describe('<EmptyState>', () => {
  it('renders icon, title, and optional description', () => {
    render(<EmptyState icon="📭" title="Nothing here" description="Try again later" />);
    expect(screen.getByText('📭')).toBeInTheDocument();
    expect(screen.getByText('Nothing here')).toBeInTheDocument();
    expect(screen.getByText('Try again later')).toBeInTheDocument();
  });

  it('renders action when provided', () => {
    render(
      <EmptyState
        title="No items"
        action={<button>Add one</button>}
      />
    );
    expect(screen.getByRole('button', { name: 'Add one' })).toBeInTheDocument();
  });
});

describe('<LoadingSkeleton>', () => {
  it('renders N skeleton blocks', () => {
    const { container } = render(<LoadingSkeleton count={4} />);
    // Each skeleton is a div with `animate-pulse`. There are 4 of them
    // plus the wrapper = 5.
    expect(container.querySelectorAll('.animate-pulse').length).toBe(4);
  });

  it('respects variant=card vs variant=row', () => {
    const { container: cardContainer } = render(<LoadingSkeleton variant="card" count={1} />);
    expect(cardContainer.querySelector('.aspect-square')).toBeInTheDocument();

    const { container: rowContainer } = render(<LoadingSkeleton variant="row" count={1} />);
    expect(rowContainer.querySelector('.aspect-square')).toBeNull();
  });
});

describe('<PageHeader>', () => {
  it('renders title, description, icon, badge', () => {
    render(
      <PageHeader
        icon="📊"
        title="My Closet"
        description="Your wardrobe"
        badge="113"
      />
    );
    expect(screen.getByText('📊')).toBeInTheDocument();
    expect(screen.getByText('My Closet')).toBeInTheDocument();
    expect(screen.getByText('Your wardrobe')).toBeInTheDocument();
    expect(screen.getByText('113')).toBeInTheDocument();
  });
});