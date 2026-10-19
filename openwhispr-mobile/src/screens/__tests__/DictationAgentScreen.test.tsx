import React from 'react';
import { Switch } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { DictationAgentScreen } from '../DictationAgentScreen';

let mockActiveMode = 'providers';
let mockConfig: Record<string, unknown> = { defaultMode: 'providers' };
const mockUpdateConfig = jest.fn();
let mockOnDeviceUnsupported: string | null | undefined = null;

jest.mock('@/components/ui/Text', () => ({ Text: require('react-native').Text }));
jest.mock('@/components/ui/SystemIcon', () => ({ SystemIcon: () => null }));
jest.mock('@/hooks/useConfigToggle', () => ({ useConfigToggle: () => jest.fn() }));
jest.mock('@/hooks/useOnDeviceUnsupported', () => ({
  useOnDeviceUnsupported: () => mockOnDeviceUnsupported,
}));
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
  mockOnDeviceUnsupported = null;
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

// Local Mode runs dictation commands on Apple Intelligence; only the keyboard's compose, which
// Share Cursor Context feeds, is off there.
it('keeps the voice assistant settings available in Local Mode', () => {
  mockActiveMode = 'private';
  mockConfig = { defaultMode: 'private', dictationAgentEnabled: true };
  render(<DictationAgentScreen />);
  const [enable, shareContext] = screen.UNSAFE_getAllByType(Switch);
  expect(enable.props.value).toBe(true);
  expect(enable.props.disabled).toBe(false);
  expect(shareContext.props.disabled).toBe(true);
  expect(
    screen.getByText('Used by the keyboard’s compose, which is off in Local Mode.'),
  ).toBeTruthy();
});

it('locks the voice assistant in Local Mode on an iPhone that can never run Apple Intelligence', () => {
  mockActiveMode = 'private';
  mockConfig = { defaultMode: 'private', dictationAgentEnabled: true };
  mockOnDeviceUnsupported = 'On-Device AI needs an iPhone with Apple Intelligence.';
  render(<DictationAgentScreen />);
  expect(
    screen.getByText(
      'On-Device AI needs an iPhone with Apple Intelligence. Your settings are saved and apply once Local Mode is off.',
    ),
  ).toBeTruthy();
  const [enable] = screen.UNSAFE_getAllByType(Switch);
  expect(enable.props.value).toBe(false);
  expect(enable.props.disabled).toBe(true);
});

it('keeps the switch still in Local Mode until it knows whether this iPhone can run it', () => {
  mockActiveMode = 'private';
  mockConfig = { defaultMode: 'private', dictationAgentEnabled: true };
  mockOnDeviceUnsupported = undefined;
  render(<DictationAgentScreen />);
  expect(screen.UNSAFE_getAllByType(Switch)[0].props.disabled).toBe(true);
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
