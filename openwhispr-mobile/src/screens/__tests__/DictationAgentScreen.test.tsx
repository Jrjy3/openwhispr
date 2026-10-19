import React from 'react';
import { Switch } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { DictationAgentScreen } from '../DictationAgentScreen';

let mockActiveMode = 'providers';
let mockConfig: Record<string, unknown> = { defaultMode: 'providers' };
const mockUpdateConfig = jest.fn();

jest.mock('@/components/ui/Text', () => ({ Text: require('react-native').Text }));
jest.mock('@/components/ui/SystemIcon', () => ({ SystemIcon: () => null }));
jest.mock('@/hooks/useConfigToggle', () => ({ useConfigToggle: () => jest.fn() }));
jest.mock('@/store/useConfigStore', () => ({
  useConfigStore: (selector: (state: unknown) => unknown) =>
    selector({ config: mockConfig, updateConfig: mockUpdateConfig }),
}));
jest.mock('@/store/useProcessingModeStore', () => ({
  useProcessingModeStore: (selector: (state: unknown) => unknown) =>
    selector({ activeMode: mockActiveMode }),
}));

const NOTICE = /skips the voice assistant until you choose a provider for it in AI Models/;

beforeEach(() => {
  jest.clearAllMocks();
  mockActiveMode = 'providers';
  mockConfig = { defaultMode: 'providers' };
});

it('does not look enabled while Bring Your Own Key skips the voice assistant', () => {
  render(<DictationAgentScreen />);
  expect(screen.getByText(NOTICE)).toBeTruthy();
  expect(screen.UNSAFE_getAllByType(Switch).every((toggle) => toggle.props.disabled)).toBe(true);
});

it('is enabled once the voice assistant has a Bring Your Own Key selection', () => {
  mockConfig = {
    defaultMode: 'providers',
    inference: { agent: { mode: 'providers', providerId: 'groq', modelId: 'llama' } },
  };
  render(<DictationAgentScreen />);
  expect(screen.queryByText(NOTICE)).not.toBeOnTheScreen();
  expect(screen.UNSAFE_getAllByType(Switch).some((toggle) => toggle.props.disabled)).toBe(false);
});

// Local Mode runs dictation commands on Apple Intelligence, so nothing here is locked.
it('keeps the voice assistant settings available in Local Mode', () => {
  mockActiveMode = 'private';
  mockConfig = { defaultMode: 'private', dictationAgentEnabled: true };
  render(<DictationAgentScreen />);
  expect(screen.queryByText(/Off while Local Mode is on/)).toBeNull();
  const [enable] = screen.UNSAFE_getAllByType(Switch);
  expect(enable.props.value).toBe(true);
  expect(screen.UNSAFE_getAllByType(Switch).some((toggle) => toggle.props.disabled)).toBe(false);
});

it('switches only the voice assistant, keeping note chat as it was', () => {
  mockConfig = {
    defaultMode: 'providers',
    inference: { agent: { mode: 'providers', providerId: 'groq', modelId: 'llama' } },
  };
  render(<DictationAgentScreen />);
  expect(screen.queryByText(/Also turns note chat/)).toBeNull();
  fireEvent(screen.UNSAFE_getAllByType(Switch)[0], 'valueChange', false);
  expect(mockUpdateConfig).toHaveBeenCalledWith({ dictationAgentEnabled: false });
});
