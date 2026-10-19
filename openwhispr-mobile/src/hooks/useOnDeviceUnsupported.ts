import { useEffect, useState } from 'react';
import {
  getLocalReasoningReadiness,
  getLocalReasoningUnavailableMessage,
  isLocalReasoningUnsupported,
} from '@/lib/localReasoning';

// Why this iPhone can never run Apple Intelligence, null when it can, and undefined until known.
export function useOnDeviceUnsupported(skip = false): string | null | undefined {
  const [reason, setReason] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (skip) return undefined;
    let cancelled = false;
    getLocalReasoningReadiness()
      .then((readiness) => {
        if (cancelled) return;
        setReason(
          isLocalReasoningUnsupported(readiness)
            ? getLocalReasoningUnavailableMessage(readiness)
            : null,
        );
      })
      .catch(() => {
        if (!cancelled) setReason(null);
      });
    return (): void => {
      cancelled = true;
    };
  }, [skip]);
  return reason;
}
