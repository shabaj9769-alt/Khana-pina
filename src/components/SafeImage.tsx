import React, { useState } from 'react';
import { UtensilsCrossed } from 'lucide-react';
import { normalizeImageUrl } from '../utils/themeTokens.ts';

interface SafeImageProps extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  src?: string | null;
  containerClassName?: string;
}

export function SafeImage({
  src,
  alt = '',
  className = '',
  containerClassName = '',
  style,
  ...props
}: SafeImageProps) {
  const [hasError, setHasError] = useState(false);
  const normalized = normalizeImageUrl(src);

  if (hasError || !normalized) {
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

  return (
    <img
      src={normalized}
      alt={alt}
      className={className}
      style={style}
      onError={() => setHasError(true)}
      {...props}
    />
  );
}
