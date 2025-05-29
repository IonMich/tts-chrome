import { cn } from '@/lib/utils';
import { Loader2 } from 'lucide-react';
import { useEffect } from 'react';

const Loader = ({ className }: { className?: string }) => {
  useEffect(() => {
    // Monitor animation performance
    const startTime = performance.now();
    console.log('Loader mounted at:', startTime);

    // Check if browser supports animation frame monitoring
    if (typeof window !== 'undefined') {
      let frameCount = 0;
      let lastTime = startTime;
      let isActive = true; // Track if monitoring should continue
      let animationId: number;

      const countFrames = () => {
        if (!isActive) return; // Stop if component unmounted
        
        frameCount++;
        const currentTime = performance.now();

        // Log FPS every 2 seconds to reduce console spam
        if (currentTime - lastTime >= 2000) {
          console.log(
            `Loader FPS: ${frameCount} frames in ${(currentTime - lastTime).toFixed(
              2
            )}ms`
          );
          frameCount = 0;
          lastTime = currentTime;
        }

        if (isActive) {
          animationId = requestAnimationFrame(countFrames);
        }
      };

      animationId = requestAnimationFrame(countFrames);

      return () => {
        isActive = false; // Stop monitoring first
        if (animationId) {
          cancelAnimationFrame(animationId);
        }
        console.log('Loader unmounted after:', performance.now() - startTime, 'ms');
      };
    }
  }, []);

  return (
    <Loader2
      className={cn('my-28 h-16 w-16 text-primary/60 animate-spin', className)}
    />
  );
};

export default Loader;
