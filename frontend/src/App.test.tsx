import React from 'react';
import { render, screen } from '@testing-library/react';
import axios from 'axios';
import App from './App';

jest.mock('axios');

const mockedAxios = axios as jest.Mocked<typeof axios>;

beforeEach(() => {
  mockedAxios.create.mockReturnValue({
    get: jest.fn().mockResolvedValue({ data: {} })
  } as any);
});

test('renders subscription dapp title', () => {
  render(<App />);
  const title = screen.getByText(/subscription dapp/i);
  expect(title).toBeInTheDocument();
});
