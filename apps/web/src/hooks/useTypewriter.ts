import { useState, useEffect, useCallback, useMemo } from 'react';

/**
 * Character-by-character text reveal hook.
 * Returns the revealed portion of the text.
 *
 * Uses a generation counter derived from the text to
 * reset the index without calling setState in an effect body.
 */
export function useTypewriter(text: string, speed = 30, enabled = true): string {
  // Create a stable generation token per text value — when text changes,
  // we get a new token, which resets the counter in the interval callback.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- text is intentional: new symbol per text value
  const generation = useMemo(() => Symbol('gen'), [text]);
  const [state, setState] = useState<{ gen: symbol; index: number }>({
    gen: generation,
    index: 0,
  });

  // Derive index from state, resetting if generation changed
  const index = state.gen === generation ? state.index : 0;

  const tick = useCallback(() => {
    setState((prev) => {
      // If generation changed, restart from 0
      if (prev.gen !== generation) {
        return { gen: generation, index: 1 };
      }
      if (prev.index >= text.length) return prev;
      return { gen: generation, index: prev.index + 1 };
    });
  }, [generation, text.length]);

  useEffect(() => {
    if (!enabled || index >= text.length) return;

    const timer = setInterval(tick, speed);
    return () => clearInterval(timer);
  }, [enabled, index, text.length, speed, tick]);

  return enabled ? text.slice(0, index) : text;
}
