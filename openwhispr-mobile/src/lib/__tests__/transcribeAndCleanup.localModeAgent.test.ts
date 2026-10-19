/**
 * Local Mode runs the voice assistant's dictation commands on Apple Intelligence. A spoken command
 * reaches the assistant even where Local Mode would skip cleanup, and when Apple Intelligence can't
 * run it the user is told why, never left with a silent raw transcript.
 */
import { TranscriptionService } from '@/services/transcription/TranscriptionService';
import { transcribeAndCleanup } from '@/lib/transcribeAndCleanup';
import { ReasoningService } from '@/services/reasoning/ReasoningService';
import { countLocalReasoningTokens, getLocalReasoningReadiness } from '@/lib/localReasoning';

let mockConfig: Record<string, unknown> = {};
let mockActiveMode = 'private';
let mockCustomPrompt: string | undefined;

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/services/transcription/TranscriptionService', () => ({
  TranscriptionService: {
    transcribe: jest.fn(),
    transcribeWithCloudCleanup: jest.fn(),
    canAttemptFusedCloudCleanup: jest.fn(() => false),
    requestNeedsChunking: jest.fn(async () => false),
    isFusedCleanupUnavailableError: jest.fn(() => false),
  },
  isLocalModelMissingError: jest.fn(() => false),
}));
jest.mock('@/services/reasoning/ReasoningService', () => ({
  ReasoningService: {
    processText: jest.fn(async (req: { text: string }) => ({
      text: `cleaned:${req.text}`,
      model: 'm',
    })),
  },
}));
jest.mock('@/lib/localReasoning', () => ({
  ...jest.requireActual('@/lib/localReasoning'),
  getLocalReasoningReadiness: jest.fn(),
  countLocalReasoningTokens: jest.fn(),
}));
jest.mock('@/lib/permissions', () => ({
  isNoSpeechError: jest.fn(() => false),
}));
let mockUser: { id: string; isAnonymous: boolean } | null = { id: 'u', isAnonymous: false };
jest.mock('@/store/useAuthStore', () => ({
  useAuthStore: { getState: () => ({ user: mockUser }) },
}));
jest.mock('@/store/useConfigStore', () => ({
  useConfigStore: { getState: () => ({ config: mockConfig }) },
}));
jest.mock('@/store/useProcessingModeStore', () => ({
  useProcessingModeStore: { getState: () => ({ activeMode: mockActiveMode }) },
}));
jest.mock('@/store/useSnippetsStore', () => ({
  useSnippetsStore: { getState: () => ({ isLoaded: true, entries: [] }) },
}));
jest.mock('@/store/useDictionaryStore', () => ({
  useDictionaryStore: { getState: () => ({ isLoaded: true, entries: [] }) },
}));
jest.mock('@/store/useCustomPromptsStore', () => ({
  getActiveCustomCleanupPrompt: () => mockCustomPrompt,
}));

const mockTranscribe = TranscriptionService.transcribe as jest.Mock;
const mockReason = ReasoningService.processText as jest.Mock;
const mockReadiness = getLocalReasoningReadiness as jest.Mock;
const mockCountTokens = countLocalReasoningTokens as jest.Mock;

function dictateOnDevice(text: string): ReturnType<typeof transcribeAndCleanup> {
  mockTranscribe.mockResolvedValue({ text, provider: 'local', duration: 1 });
  return transcribeAndCleanup({
    audioUri: 'file://a.wav',
    provider: 'local',
    requestContext: 'recording',
    cleanupRoute: { mode: 'local', scope: 'cleanup' },
    agentRoute: { mode: 'local', scope: 'agent' },
  });
}

function scopesCalled(): unknown[] {
  return mockReason.mock.calls.map((call) => (call[0] as Record<string, unknown>).inferenceScope);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockActiveMode = 'private';
  mockUser = { id: 'a', isAnonymous: true };
  mockConfig = {
    cleanupEnabled: true,
    defaultMode: 'private',
    inference: { dictation: { mode: 'local' }, cleanup: { mode: 'local' } },
  };
  mockReadiness.mockResolvedValue({ status: 'ready', tokenCounting: true });
  mockCountTokens.mockResolvedValue(null);
  mockCustomPrompt = undefined;
});

it('runs a command when Local Mode saves Cloud cleanup without an account', async () => {
  mockConfig = {
    ...mockConfig,
    inference: { dictation: { mode: 'local' }, cleanup: { mode: 'openwhispr' } },
  };

  await dictateOnDevice('Hey OpenWhispr write a haiku');

  expect(scopesCalled()).toEqual(['agent']);
});

it("says why a command can't run while Apple Intelligence is off", async () => {
  mockConfig = { ...mockConfig, pinnedInference: ['cleanup'] };
  mockReadiness.mockResolvedValue({ status: 'appleIntelligenceOff', tokenCounting: false });

  const result = await dictateOnDevice('Hey OpenWhispr write a haiku');

  expect(mockReason).not.toHaveBeenCalled();
  expect(result.text).toBe('Hey OpenWhispr write a haiku');
  expect(result.transcription.cleanupWarning).toContain('Your raw transcript is saved.');
});

it('cleans a dictation that only mentions the name', async () => {
  await dictateOnDevice('I showed OpenWhispr to a friend');

  expect(scopesCalled()).not.toContain('agent');
  expect(mockReason).toHaveBeenCalledTimes(1);
});

it('cleans an addressed dictation when the voice assistant is off', async () => {
  mockConfig = { ...mockConfig, dictationAgentEnabled: false };

  await dictateOnDevice('Hey OpenWhispr write a haiku');

  expect(scopesCalled()).not.toContain('agent');
  expect(mockReason).toHaveBeenCalledTimes(1);
});

it('keeps the transcript raw when cleanup is switched off', async () => {
  mockConfig = { ...mockConfig, cleanupEnabled: false };

  const result = await dictateOnDevice('Hey OpenWhispr write a haiku');

  expect(mockReason).not.toHaveBeenCalled();
  expect(result.text).toBe('Hey OpenWhispr write a haiku');
});

// Outside Local Mode an on-device dictation keeps today's behaviour: where cleanup is skipped, the
// transcript stays raw, and AI Models says why.
it('keeps an addressed on-device dictation raw outside Local Mode when cleanup is skipped', async () => {
  mockActiveMode = 'providers';
  mockConfig = {
    cleanupEnabled: true,
    defaultMode: 'providers',
    inference: { dictation: { mode: 'local' } },
  };

  const result = await dictateOnDevice('Hey OpenWhispr write a haiku');

  expect(mockReason).not.toHaveBeenCalled();
  expect(result.text).toBe('Hey OpenWhispr write a haiku');
});
