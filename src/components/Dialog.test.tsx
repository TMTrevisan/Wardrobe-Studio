// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Dialog, ConfirmDialog } from './Dialog';

describe('<Dialog>', () => {
  it('does not render when closed', () => {
    const { container } = render(
      <Dialog open={false} onClose={() => {}} title="Hidden">
        <p>Body</p>
      </Dialog>
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders title, description, and children when open', () => {
    render(
      <Dialog open onClose={() => {}} title="Edit garment" description="Modify details">
        <p>Form here</p>
      </Dialog>
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Edit garment')).toBeInTheDocument();
    expect(screen.getByText('Modify details')).toBeInTheDocument();
    expect(screen.getByText('Form here')).toBeInTheDocument();
  });

  it('calls onClose when Escape is pressed', () => {
    const onClose = vi.fn();
    render(
      <Dialog open onClose={onClose} title="Esc-test">
        <button>Focusable</button>
      </Dialog>
    );
    // Dispatch Escape directly on the dialog element. userEvent.keyboard
    // fires at document.activeElement, which under jsdom isn't always
    // the panel even after .focus() — fireEvent is deterministic.
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('calls onClose when the backdrop is clicked', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <Dialog open onClose={onClose} title="Backdrop">
        <p>Body</p>
      </Dialog>
    );
    // The backdrop is the dialog role itself.
    await user.click(screen.getByRole('dialog'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('does not close when content inside the panel is clicked', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <Dialog open onClose={onClose} title="No bubble">
        <button>Click me</button>
      </Dialog>
    );
    await user.click(screen.getByRole('button', { name: 'Click me' }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('exposes an aria-labelledby and aria-describedby', () => {
    render(
      <Dialog open onClose={() => {}} title="Label" description="Desc">
        <p>x</p>
      </Dialog>
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-labelledby', 'dialog-title');
    expect(dialog).toHaveAttribute('aria-describedby', 'dialog-description');
  });
});

describe('<ConfirmDialog>', () => {
  it('renders confirm and cancel buttons', () => {
    render(
      <ConfirmDialog
        open
        onClose={() => {}}
        onConfirm={() => {}}
        title="Delete?"
        confirmLabel="Delete"
        cancelLabel="Keep"
        destructive
      />
    );
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Keep' })).toBeInTheDocument();
  });

  it('calls onConfirm when the confirm button is clicked', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <ConfirmDialog
        open
        onClose={onClose}
        onConfirm={onConfirm}
        title="Delete?"
        confirmLabel="Yes"
      />
    );
    await user.click(screen.getByRole('button', { name: 'Yes' }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('calls onClose when cancel is clicked', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <ConfirmDialog
        open
        onClose={onClose}
        onConfirm={() => {}}
        title="Delete?"
      />
    );
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});