import {
  getDictationAgentName,
  runsDictationCommands,
  isDictationAgentEnabled,
  isKeyboardComposeApplicable,
  isNoteChatEnabled,
  detectAgentMention,
} from '@/lib/dictationAgent';
import type { UserConfig } from '@/types';

let mockPolicy: Record<string, unknown> = { status: 'unmanaged' };
const mockReadiness = jest.fn();
jest.mock('@/services/providers/ProviderPolicy', () => ({
  getCachedProviderPolicy: () => mockPolicy,
}));
jest.mock('@/lib/localReasoning', () => ({
  ...jest.requireActual('@/lib/localReasoning'),
  getLocalReasoningReadiness: () => mockReadiness(),
}));

const baseConfig: UserConfig = { defaultMode: 'cloud' };

describe('getDictationAgentName', () => {
  it('returns the default name when dictationAgentName is unset', () => {
    expect(getDictationAgentName(baseConfig)).toBe('OpenWhispr');
  });

  it('returns the default name when dictationAgentName is blank', () => {
    expect(getDictationAgentName({ ...baseConfig, dictationAgentName: '   ' })).toBe('OpenWhispr');
  });

  it('returns the configured name trimmed', () => {
    expect(getDictationAgentName({ ...baseConfig, dictationAgentName: '  Aria  ' })).toBe('Aria');
  });

  it('returns the configured name as-is when already trimmed', () => {
    expect(getDictationAgentName({ ...baseConfig, dictationAgentName: 'Aria' })).toBe('Aria');
  });
});

// Where commands run in each mode is runsDictationCommands' call, below.
describe('isDictationAgentEnabled', () => {
  it('is on by default', () => {
    expect(isDictationAgentEnabled(baseConfig)).toBe(true);
  });

  it('follows its switch', () => {
    expect(isDictationAgentEnabled({ ...baseConfig, dictationAgentEnabled: false })).toBe(false);
    expect(isDictationAgentEnabled({ ...baseConfig, dictationAgentEnabled: true })).toBe(true);
  });
});

describe('runsDictationCommands', () => {
  const orgOff = {
    status: 'managed',
    transcription: { allowedModes: ['local'], allowedByokProviders: [] },
    llm: { allowedModes: ['local'], allowedByokProviders: [] },
    agentEnabled: false,
  };

  beforeEach(() => {
    mockPolicy = { status: 'unmanaged' };
    mockReadiness.mockResolvedValue({ status: 'ready', tokenCounting: false });
  });

  it('runs none with the voice assistant switched off', async () => {
    const off = { ...baseConfig, dictationAgentEnabled: false };
    await expect(runsDictationCommands(off, 'cloud', 'openwhispr')).resolves.toBe(false);
    await expect(runsDictationCommands(off, 'private', 'local')).resolves.toBe(false);
  });

  it.each(['openwhispr', 'providers', 'local', undefined] as const)(
    'runs them outside Local Mode on a %s route',
    async (route) => {
      await expect(runsDictationCommands(baseConfig, 'cloud', route)).resolves.toBe(true);
    },
  );

  it('runs them in Local Mode only on this iPhone', async () => {
    await expect(runsDictationCommands(baseConfig, 'private', 'local')).resolves.toBe(true);
    await expect(runsDictationCommands(baseConfig, 'private', 'openwhispr')).resolves.toBe(false);
    await expect(runsDictationCommands(baseConfig, 'private', 'providers')).resolves.toBe(false);
    await expect(runsDictationCommands(baseConfig, 'private', undefined)).resolves.toBe(false);
  });

  it('runs none in Local Mode on an iPhone that can never run Apple Intelligence', async () => {
    mockReadiness.mockResolvedValue({ status: 'unsupportedDevice', tokenCounting: false });
    await expect(runsDictationCommands(baseConfig, 'private', 'local')).resolves.toBe(false);
  });

  // Off or still downloading can be fixed, so the command runs into a reason the user can act on.
  it('still runs them in Local Mode while Apple Intelligence is only off', async () => {
    mockReadiness.mockResolvedValue({ status: 'appleIntelligenceOff', tokenCounting: false });
    await expect(runsDictationCommands(baseConfig, 'private', 'local')).resolves.toBe(true);
  });

  it('honours an org that turned the voice assistant off, on this iPhone', async () => {
    mockPolicy = orgOff;
    await expect(runsDictationCommands(baseConfig, 'private', 'local')).resolves.toBe(false);
    await expect(runsDictationCommands(baseConfig, 'cloud', 'local')).resolves.toBe(false);
  });
});

// The keyboard's compose has no on-device version yet, so Local Mode keeps it off.
describe('isKeyboardComposeApplicable', () => {
  it.each(['cloud', 'providers'] as const)('is on in %s mode', (mode) => {
    expect(isKeyboardComposeApplicable(mode, baseConfig)).toBe(true);
  });

  it('is off in Local Mode', () => {
    expect(isKeyboardComposeApplicable('private', baseConfig)).toBe(false);
  });

  it('is off when the voice assistant is switched off', () => {
    expect(
      isKeyboardComposeApplicable('cloud', { ...baseConfig, dictationAgentEnabled: false }),
    ).toBe(false);
  });
});

// Note chat's switch is its own; configs from before it was are saved apart at launch.
describe('note chat', () => {
  it('is on by default', () => {
    expect(isNoteChatEnabled(baseConfig)).toBe(true);
  });

  it('ignores the voice assistant switch', () => {
    expect(isNoteChatEnabled({ ...baseConfig, dictationAgentEnabled: false })).toBe(true);
    expect(isNoteChatEnabled({ ...baseConfig, noteChatEnabled: false })).toBe(false);
  });
});

describe('detectAgentMention — Layer 1: word-boundary exact match', () => {
  it('detects the name at word boundaries', () => {
    expect(detectAgentMention('Hey OpenWhispr write a follow-up email', 'OpenWhispr')).toBe(true);
  });

  it('detects the name case-insensitively', () => {
    expect(detectAgentMention('hey openwhispr do this', 'OpenWhispr')).toBe(true);
    expect(detectAgentMention('hey OPENWHISPR do this', 'OpenWhispr')).toBe(true);
  });

  it('does not match when name appears only as a substring of another word', () => {
    expect(detectAgentMention('this is OpenWhisprPro not the agent', 'OpenWhispr')).toBe(false);
  });

  it('does not match when transcript does not contain the name', () => {
    expect(detectAgentMention('write a follow-up email for the client', 'OpenWhispr')).toBe(false);
  });

  it('detects name with punctuation adjacent (word boundary)', () => {
    expect(detectAgentMention('okay, OpenWhispr, please help', 'OpenWhispr')).toBe(true);
  });
});

describe('detectAgentMention — the name must address the agent', () => {
  it('treats a mere mention mid-sentence as dictated content', () => {
    expect(
      detectAgentMention('What time does the OpenWhispr meeting start tomorrow?', 'OpenWhispr'),
    ).toBe(false);
    expect(detectAgentMention('I showed Open Whispr to a friend', 'OpenWhispr')).toBe(false);
  });

  it('detects the name at the start or after a sentence ends', () => {
    expect(detectAgentMention('OpenWhispr, write an email to Bob', 'OpenWhispr')).toBe(true);
    expect(detectAgentMention('Thanks for that. OpenWhispr draft a reply', 'OpenWhispr')).toBe(
      true,
    );
  });
});

describe('detectAgentMention — Layer 2: space-normalized join', () => {
  it('detects compound name spoken with a space', () => {
    // STT splits "OpenWhispr" into "Open Whispr"
    expect(detectAgentMention('hey Open Whispr write this', 'OpenWhispr')).toBe(true);
  });

  it('is case-insensitive on space-normalized match', () => {
    expect(detectAgentMention('hey open whispr write this', 'OpenWhispr')).toBe(true);
  });

  it('matches a two-word configured name', () => {
    // Name is "My Agent", transcript says "My Agent" (exact)
    expect(detectAgentMention('hey my agent do the thing', 'My Agent')).toBe(true);
  });
});

describe('detectAgentMention — Layer 3: Levenshtein fuzzy match', () => {
  it('returns false for names of 4 chars or fewer (zero edits allowed)', () => {
    expect(detectAgentMention('hey Arua write this', 'Aria')).toBe(false);
  });

  it('tolerates 1 edit for a 5–6 char name', () => {
    expect(detectAgentMention('hey Jarwis write this', 'Jarvis')).toBe(true);
  });

  it('tolerates 2 edits for names longer than 6 chars', () => {
    // "openwhizer" is 2 edits from "openwhispr" (len 10)
    expect(detectAgentMention('hey openwhizer write this', 'OpenWhispr')).toBe(true);
  });

  it('does not match when edits exceed the threshold', () => {
    expect(detectAgentMention('hey openwhizzler write this', 'OpenWhispr')).toBe(false);
  });

  it('tolerates 1 edit on a combined two-word mishearing', () => {
    // "open whisper" combined → "openwhisper" is 1 edit from "openwhispr"
    expect(detectAgentMention('okay open whisper please help', 'OpenWhispr')).toBe(true);
  });
});

describe('detectAgentMention — edge cases', () => {
  it('returns false for empty transcript', () => {
    expect(detectAgentMention('', 'OpenWhispr')).toBe(false);
  });

  it('returns false when name is too short (< 2 chars)', () => {
    expect(detectAgentMention('hey A do this', 'A')).toBe(false);
  });

  it('returns false when name is blank/empty', () => {
    expect(detectAgentMention('hey do this', '')).toBe(false);
  });
});

it('supports Providers mode', () => {
  expect(isKeyboardComposeApplicable('providers', { defaultMode: 'providers' })).toBe(true);
});
