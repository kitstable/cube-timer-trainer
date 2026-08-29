import React, { useEffect, useRef } from 'react';
import { TwistyPlayer } from 'cubing/twisty';

interface TwistyPlayerWrapperProps {
  setupAlg?: string;
  alg?: string;
  tempoScale?: number;
  visualization?: '3D' | '2D';
  controlPanel?: 'none' | 'bottom-row' | 'auto';
  background?: string;
  className?: string;
  height?: number | string;
}

export const TwistyPlayerWrapper: React.FC<TwistyPlayerWrapperProps> = ({
  setupAlg = '',
  alg = '',
  tempoScale = 2.5,
  visualization = '3D',
  controlPanel = 'none',
  background = 'none',
  className = '',
  height = 260,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<TwistyPlayer | null>(null);
  const prevAlgRef = useRef<string>(alg);
  const prevSetupAlgRef = useRef<string>(setupAlg);
  const heightPx = typeof height === 'number' ? `${height}px` : height;

  useEffect(() => {
    if (!containerRef.current) return;
    containerRef.current.innerHTML = '';

    try {
      const player = new TwistyPlayer({
        puzzle: '3x3x3',
        experimentalSetupAlg: setupAlg,
        alg: alg,
        tempoScale: tempoScale,
        visualization: visualization as any,
        controlPanel: controlPanel as any,
        background: background as any,
      });

      // Give the player an explicit *pixel* height, not `height: 100%`. `<twisty-player>`
      // gates its WebGL canvas init on an IntersectionObserver seeing a non-zero paint area;
      // `100%` against an auto-height parent collapses the internal grid to 0px and the cube
      // silently never renders. Keep cubing's native `:host { display: grid }` — don't set
      // `display` here.
      player.style.width = '100%';
      player.style.height = heightPx;
      player.style.minHeight = heightPx;
      player.style.maxWidth = heightPx;

      containerRef.current.appendChild(player);
      playerRef.current = player;
      prevAlgRef.current = alg;
      prevSetupAlgRef.current = setupAlg;
    } catch (err) {
      console.warn('TwistyPlayer initialization error:', err);
    }

    return () => {
      if (containerRef.current) {
        containerRef.current.innerHTML = '';
      }
      playerRef.current = null;
    };
  }, [heightPx]);

  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;

    try {
      const prevAlg = prevAlgRef.current.trim();
      const nextAlg = alg.trim();
      const setupChanged = prevSetupAlgRef.current !== setupAlg;

      prevAlgRef.current = alg;
      prevSetupAlgRef.current = setupAlg;

      player.tempoScale = tempoScale;

      if (setupChanged) {
        player.experimentalSetupAlg = setupAlg;
        player.alg = alg;
        player.jumpToEnd();
        return;
      }

      // Check if nextAlg is exactly prevAlg with one move appended
      const prevTokens = prevAlg ? prevAlg.split(/\s+/) : [];
      const nextTokens = nextAlg ? nextAlg.split(/\s+/) : [];

      if (
        nextTokens.length === prevTokens.length + 1 &&
        prevTokens.every((token, i) => token === nextTokens[i])
      ) {
        // Single move appended: animate the forward turn with experimentalAddMove!
        const addedMove = nextTokens[nextTokens.length - 1];
        if (typeof player.experimentalAddMove === 'function') {
          player.experimentalAddMove(addedMove);
        } else {
          player.alg = alg;
          player.jumpToEnd();
        }
      } else if (
        nextTokens.length === prevTokens.length - 1 &&
        nextTokens.every((token, i) => token === prevTokens[i])
      ) {
        // Single move undone: animate the reverse turn with experimentalRemoveFinalChild!
        if (typeof player.experimentalRemoveFinalChild === 'function') {
          player.experimentalRemoveFinalChild();
        } else {
          player.alg = alg;
          player.jumpToEnd();
        }
      } else {
        // Non-incremental change (reset or jump): update state immediately
        player.alg = alg;
        player.jumpToEnd();
      }

    } catch (err) {
      console.warn('TwistyPlayer prop update error:', err);
      try {
        player.alg = alg;
        player.jumpToEnd();
      } catch {}
    }
  }, [setupAlg, alg, tempoScale]);


  return (
    <div
      ref={containerRef}
      style={{ height: heightPx, minHeight: heightPx }}
      className={`w-full flex items-center justify-center overflow-hidden ${className}`}
    />
  );
};

