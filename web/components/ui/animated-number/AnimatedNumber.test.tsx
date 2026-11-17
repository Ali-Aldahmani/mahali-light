// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import AnimatedNumber from './AnimatedNumber';

describe('AnimatedNumber', () => {
  it('exposes the plain formatted amount and follows value changes', () => {
    const { rerender } = render(<AnimatedNumber value={525} />);
    expect(screen.getByText('AED 525.00')).toBeTruthy();
    rerender(<AnimatedNumber value={1050.5} />);
    expect(screen.getByText('AED 1,050.50')).toBeTruthy();
  });

  it('uses a custom format', () => {
    render(<AnimatedNumber value={15} format={(n) => `- AED ${n.toFixed(2)}`} />);
    expect(screen.getByText('- AED 15.00')).toBeTruthy();
  });
});
