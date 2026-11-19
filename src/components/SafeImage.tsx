import React, { useEffect, useRef, useState } from 'react';
import { UtensilsCrossed } from 'lucide-react';
import { isValidPhotoUrl, normalizeImageUrl } from '../utils/themeTokens.ts';

interface SafeImageProps extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  src?: string | null;
  containerClassName?: string;
  onImageError?: () => void;
}

export function SafeImage({
  src,
  alt = '',
  className = '',
  containerClassName = '',
  style,
  loading = 'lazy',
  decoding = 'async',
  onLoad,
  onError,
  onImageError,
  ...props
}: SafeImageProps) {
  const trimmedSrc = typeof src === 'string' ? src.trim() : '';
  const normalized = trimmedSrc ? normalizeImageUrl(trimmedSrc) : '';
  const isSafe = Boolean(normalized) && isValidPhotoUrl(normalized);

  const [hasError, setHasError] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const prevSrcRef = useRef(normalized);

  useEffect(() => {
    if (prevSrcRef.current !== normalized) {
      prevSrcRef.current = normalized;
      setHasError(false);
      setIsLoaded(false);
    }
    const img = imgRef.current;
    if (img && img.complete) {
      if (img.naturalWidth > 0) {
        setIsLoaded(true);
        setHasError(false);
      } else if (normalized && isSafe) {
        setHasError(true);
        onImageError?.();
      }
    }
  }, [normalized, isSafe]);

  if (hasError || !isSafe) {
    return (
      <div
        className={`flex items-center justify-center bg-gray-100 dark:bg-gray-800 text-gray-400 select-none ${
          containerClassName || className || 'w-full h-full'
        }`}
        style={style}
      >
        <UtensilsCrossed className="w-5 h-5 opacity-50" />
      </div>
    );
  }

  const baseWrapper = containerClassName || className || 'w-full h-full';
  const positionClass = /\b(absolute|fixed|sticky|relative)\b/.test(baseWrapper) ? '' : 'relative';

  return (
    <div
      className={`${positionClass} overflow-hidden bg-gray-100 dark:bg-gray-800 ${baseWrapper}`.trim()}
      style={style}
    >
      {!isLoaded && (
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-gray-200 dark:bg-gray-800 animate-pulse pointer-events-none"
        />
      )}
      <img
        ref={imgRef}
        src={normalized}
        alt={alt}
        loading={loading}
        decoding={decoding}
        className={`${className || 'w-full h-full object-cover'} transition-opacity duration-200 ${
          isLoaded ? 'opacity-100' : 'opacity-0'
        }`.trim()}
        onLoad={(e) => {
          setIsLoaded(true);
          onLoad?.(e);
        }}
        onError={(e) => {
          setHasError(true);
          onImageError?.();
          onError?.(e);
        }}
        {...props}
      />
    </div>
  );
}
