import { useState, useEffect, useRef, useCallback } from 'react';

export interface SimulationEvent {
  id: string;
  type: string;
  timestamp: number;    // ms offset from start
  duration: number;     // how long this step "takes"
  data: Record<string, unknown>;
  educationNote?: string;
}

interface SimulationState {
  currentTime: number;
  isPlaying: boolean;
  speed: number;
  visibleEvents: SimulationEvent[];
  isComplete: boolean;
}

export function useSimulation(events: SimulationEvent[]) {
  const [state, setState] = useState<SimulationState>({
    currentTime: 0,
    isPlaying: false,
    speed: 1,
    visibleEvents: [],
    isComplete: false,
  });

  const rafRef = useRef<number>(0);
  const lastFrameRef = useRef(0);
  const totalDuration = events.length > 0
    ? Math.max(...events.map((e) => e.timestamp + e.duration))
    : 0;

  const updateVisibleEvents = useCallback(
    (time: number) => {
      return events.filter((e) => e.timestamp <= time);
    },
    [events],
  );

  const completedRef = useRef(false);

  useEffect(() => {
    if (!state.isPlaying) return;
    completedRef.current = false;

    const step = (now: number) => {
      if (!lastFrameRef.current) lastFrameRef.current = now;
      const delta = (now - lastFrameRef.current) * state.speed;
      lastFrameRef.current = now;

      setState((prev) => {
        const nextTime = Math.min(prev.currentTime + delta, totalDuration);
        const visible = updateVisibleEvents(nextTime);
        const complete = nextTime >= totalDuration;
        if (complete) completedRef.current = true;
        return {
          ...prev,
          currentTime: nextTime,
          visibleEvents: visible,
          isComplete: complete,
          isPlaying: complete ? false : prev.isPlaying,
        };
      });

      // Only schedule next frame if simulation hasn't completed
      if (!completedRef.current) {
        rafRef.current = requestAnimationFrame(step);
      }
    };

    rafRef.current = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(rafRef.current);
      lastFrameRef.current = 0;
    };
  }, [state.isPlaying, state.speed, totalDuration, updateVisibleEvents]);

  const play = useCallback(() => {
    lastFrameRef.current = 0;
    setState((prev) => ({
      ...prev,
      isPlaying: true,
      // If complete, restart from beginning
      ...(prev.isComplete ? { currentTime: 0, visibleEvents: [], isComplete: false } : {}),
    }));
  }, []);

  const pause = useCallback(() => {
    setState((prev) => ({ ...prev, isPlaying: false }));
  }, []);

  const restart = useCallback(() => {
    lastFrameRef.current = 0;
    setState((prev) => ({
      currentTime: 0,
      isPlaying: true,
      speed: prev.speed,
      visibleEvents: [],
      isComplete: false,
    }));
  }, []);

  const setSpeed = useCallback((speed: number) => {
    setState((prev) => ({ ...prev, speed }));
  }, []);

  return {
    ...state,
    totalDuration,
    play,
    pause,
    restart,
    setSpeed,
  };
}
